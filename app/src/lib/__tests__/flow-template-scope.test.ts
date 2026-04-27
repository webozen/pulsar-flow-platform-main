/**
 * Static check for Kestra YAML flow templates.
 *
 * Catches the class of bug where a Pebble expression like
 * `{{ outputs.approval_gate.onResume.approved }}` references a task
 * that isn't visible in the current scope. In a parallel ForEach
 * (concurrencyLimit: 0 or > 1), sibling outputs are NOT exposed via
 * `outputs.<taskId>` — the only way to make sibling references work
 * inside parallel iterations is to wrap the per-iteration tasks in a
 * Sequential. This test enforces that.
 *
 * It walks each YAML in `kestra/flows/`, builds a scope tree, and for
 * every `{{ outputs.X. ... }}` reference it asserts that `X` is a
 * task that lives in a scope the reference can actually see.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import yaml from "js-yaml";

const FLOWS_ROOT = path.resolve(__dirname, "../../../../kestra/flows");

interface KestraTask {
  id?: string;
  type?: string;
  tasks?: KestraTask[];
  then?: KestraTask[];
  else?: KestraTask[];
  concurrencyLimit?: number;
  [key: string]: unknown;
}

interface FlowYaml {
  id?: string;
  tasks?: KestraTask[];
}

function listYamls(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listYamls(full));
    else if (name.endsWith(".yml") || name.endsWith(".yaml")) out.push(full);
  }
  return out;
}

/** Pull every `{{ outputs.<taskId>... }}` reference out of a Pebble string. */
function extractOutputRefs(s: string): string[] {
  const re = /\{\{\s*outputs\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) refs.push(m[1]);
  return refs;
}

/** Recursively collect all string fields under a value. */
function collectStrings(v: unknown, out: string[]) {
  if (v == null) return;
  if (typeof v === "string") {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collectStrings(item, out);
    return;
  }
  if (typeof v === "object") {
    for (const k of Object.keys(v as Record<string, unknown>)) {
      collectStrings((v as Record<string, unknown>)[k], out);
    }
  }
}

const FLOWABLE_PARALLEL = new Set([
  "io.kestra.plugin.core.flow.Parallel",
]);
const SEQ_TYPES = new Set([
  "io.kestra.plugin.core.flow.Sequential",
]);
const FOREACH_TYPES = new Set([
  "io.kestra.plugin.core.flow.ForEach",
]);
const IF_TYPES = new Set([
  "io.kestra.plugin.core.flow.If",
]);

interface Issue {
  flow: string;
  taskId: string;
  ref: string;
  reason: string;
}

/**
 * Walk the task tree depth-first. At each task, record which earlier
 * sibling task IDs are reachable via `outputs.<id>`. Push violations
 * for any reference that points outside the visible set.
 *
 * Visibility rules (matching Kestra OSS 0.19 observed behavior):
 *   - top-level tasks: see all earlier top-level siblings.
 *   - inside Sequential/If-then/If-else: see earlier siblings AND
 *     everything visible to the parent.
 *   - inside ForEach (parallel) directly: see ONLY the iteration
 *     value (taskrun.value) and parent context — sibling outputs are
 *     NOT exposed. Reading `outputs.<sibling>` here is a runtime
 *     "Unable to find" error.
 *   - inside ForEach with a Sequential wrapper: the Sequential opens
 *     a fresh scope where sibling outputs DO resolve.
 *   - inside Parallel: same restriction as parallel ForEach.
 */
function checkFlow(flowFile: string): Issue[] {
  const raw = readFileSync(flowFile, "utf8");
  const doc = yaml.load(raw) as FlowYaml;
  if (!doc?.tasks) return [];
  const issues: Issue[] = [];
  const flowName = doc.id ?? path.basename(flowFile);

  function walk(tasks: KestraTask[], visible: Set<string>, scopeKind: string, scopePath: string) {
    const localVisible = new Set(visible);
    for (const t of tasks) {
      if (!t || typeof t !== "object") continue;
      const tid = t.id ?? "(unnamed)";
      const here = `${scopePath}/${tid}`;

      // Check this task's own string fields BEFORE registering its
      // own id (a task can't reference its own outputs).
      const strs: string[] = [];
      for (const k of Object.keys(t)) {
        if (k === "tasks" || k === "then" || k === "else") continue;
        collectStrings(t[k], strs);
      }
      for (const s of strs) {
        for (const ref of extractOutputRefs(s)) {
          if (!localVisible.has(ref)) {
            issues.push({
              flow: flowName,
              taskId: tid,
              ref,
              reason:
                scopeKind === "parallel-foreach" || scopeKind === "parallel"
                  ? `references "outputs.${ref}" from inside a ${scopeKind} scope at ${here}; siblings are not visible without a Sequential wrapper`
                  : `references "outputs.${ref}" but no preceding task with that id is in scope at ${here}`,
            });
          }
        }
      }

      // Register this task's id for *subsequent* siblings — but only
      // in scopes where sibling outputs are mutually visible. In a
      // parallel scope, a later sibling cannot read an earlier
      // sibling's outputs, so we must NOT add it.
      const siblingsCanSee =
        scopeKind !== "parallel-foreach" && scopeKind !== "parallel";
      if (t.id && siblingsCanSee) localVisible.add(t.id);

      const type = t.type ?? "";
      const isForEach = FOREACH_TYPES.has(type);
      const concurrency = (t.concurrencyLimit ?? 1) as number;
      const isParallelForEach = isForEach && (concurrency === 0 || concurrency > 1);
      const isParallel = FLOWABLE_PARALLEL.has(type);
      const isSequential = SEQ_TYPES.has(type);
      const isIf = IF_TYPES.has(type);

      if (Array.isArray(t.tasks) && t.tasks.length > 0) {
        if (isParallelForEach) {
          // Children get a fresh scope: only the iteration's
          // taskrun.value is in scope, not sibling task outputs.
          walk(t.tasks, new Set<string>(), "parallel-foreach", here);
        } else if (isParallel) {
          walk(t.tasks, new Set<string>(), "parallel", here);
        } else if (isSequential || isForEach) {
          // Sequential or sequential ForEach: inherit parent scope so
          // children can see earlier siblings of THEIR parent.
          walk(t.tasks, new Set(localVisible), "sequential", here);
        } else {
          walk(t.tasks, new Set(localVisible), scopeKind, here);
        }
      }
      if (isIf) {
        const branchVisible = new Set(localVisible);
        if (Array.isArray(t.then)) walk(t.then, branchVisible, scopeKind, `${here}/then`);
        if (Array.isArray(t.else)) walk(t.else, branchVisible, scopeKind, `${here}/else`);
      }
    }
  }

  walk(doc.tasks, new Set<string>(), "root", flowName);
  return issues;
}

describe("Kestra flow template scope", () => {
  // Walks every YAML the platform ships under kestra/flows/. Empty by
  // design today (workflows are runtime, built via the in-app builder
  // and stored in flowcore.workflows). When we ship seed/demo flows
  // again, this loop catches Pebble scope errors at PR time.
  const yamls = listYamls(FLOWS_ROOT);

  it("walks the shipped flows directory cleanly (zero or more YAMLs is fine)", () => {
    expect(Array.isArray(yamls)).toBe(true);
  });

  for (const file of yamls) {
    const rel = path.relative(FLOWS_ROOT, file);
    it(`${rel}: every {{ outputs.X. }} reference resolves to a visible task`, () => {
      const issues = checkFlow(file);
      if (issues.length > 0) {
        const lines = issues.map((i) => `  - ${i.taskId}: ${i.reason}`).join("\n");
        throw new Error(`Template scope violations in ${rel}:\n${lines}`);
      }
    });
  }
});

/**
 * Trial-account safety guards. The Twilio account is in trial mode.
 * The platform ships no SMS-firing flows today — workflows are
 * runtime-built via the in-app builder, which routes per-row Twilio
 * sends through `lib/workflow-generator.ts`. The corresponding safety
 * test for the GENERATED YAML lives next to that generator. These
 * suites only kick in if/when a code-shipped seed flow includes a
 * Twilio HTTP task again.
 */
describe.skip("Twilio trial-account safety guards (no shipped SMS flows yet)", () => {
  const TRIAL_RECIPIENT = "%2B15198002773"; // form-encoded "+15198002773"

  it("apt-reminder-row.yml: To= is hardcoded to the trial recipient", () => {
    const file = path.join(FLOWS_ROOT, "dental/apt-reminder-row.yml");
    const yaml = readFileSync(file, "utf8");
    expect(yaml).toContain(`To=${TRIAL_RECIPIENT}`);
    expect(yaml).not.toContain("To={{ fromJson(inputs.row).WirelessPhone }}");
    expect(yaml).not.toContain("To={{ taskrun.value.WirelessPhone }}");
  });

  it("apt-reminder-row.yml: From= resolves from the twilio_from_number KV (not hardcoded)", () => {
    const file = path.join(FLOWS_ROOT, "dental/apt-reminder-row.yml");
    const yaml = readFileSync(file, "utf8");
    expect(yaml).toContain("From={{ kv('twilio_from_number') }}");
  });
});
