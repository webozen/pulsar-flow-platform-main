/**
 * Unit tests for tenant-sync's pure helpers.
 *
 * The two pieces this file pins down are:
 *   1. `namespaceFor(slug)` — single source of truth for Kestra
 *      namespace shape (`dental.<slug>`).
 *   2. `loadDentalFlows(slug)` — file-system read + namespace rewrite
 *      regex. The regex is load-bearing for the subflow architecture
 *      because it has to rewrite BOTH the top-level `namespace:` and
 *      the inner Subflow `namespace:` reference. A drift here means
 *      apt-reminder-demo's spawned subflows point at the wrong
 *      namespace and the whole approval queue empties out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// `FLOWS_DIR` is captured at module-load time inside tenant-sync. Each
// test overrides PULSAR_FLOWS_DIR and dynamically imports the module
// so the constant binds to the test-owned tmp directory.
async function importFresh(): Promise<typeof import("../tenant-sync")> {
  vi.resetModules();
  return await import("../tenant-sync");
}

describe("namespaceFor", () => {
  it("prefixes the slug with dental.", async () => {
    const { namespaceFor } = await importFresh();
    expect(namespaceFor("acme-dental")).toBe("dental.acme-dental");
  });
  it("preserves URL-safe characters as-is", async () => {
    const { namespaceFor } = await importFresh();
    expect(namespaceFor("growing-smiles_2")).toBe("dental.growing-smiles_2");
  });
});

describe("FLOWS_BY_MODULE", () => {
  it("automation bucket is empty by design (no shipped flows; workflows are runtime via the builder)", async () => {
    const { FLOWS_BY_MODULE } = await importFresh();
    // Empty by design — see the comment on FLOWS_BY_MODULE in
    // tenant-sync.ts. If you re-introduce a code-shipped seed flow,
    // update this assertion AND ship the YAML file together.
    expect(FLOWS_BY_MODULE.automation).toEqual([]);
  });

  it("every subflow parent is paired with its row child in the same bucket", async () => {
    // The parent's Subflow spawns the row — if either is missing from
    // the same module bucket, module activation flips one without the
    // other and the spawn errors with "flow is disabled".
    const pairs: Array<[parent: string, row: string]> = [
      ["apt-reminder-demo", "apt-reminder-row"],
      ["appointment-reminder-test", "appointment-reminder-test-row"],
    ];
    const { FLOWS_BY_MODULE } = await importFresh();
    for (const bucket of Object.values(FLOWS_BY_MODULE)) {
      for (const [parent, row] of pairs) {
        expect(
          bucket.includes(parent),
          `parent "${parent}" present iff row "${row}" present`,
        ).toBe(bucket.includes(row));
      }
    }
  });

  it("every flow listed in FLOWS_BY_MODULE corresponds to a YAML on disk", async () => {
    // Reverse-direction guard: pinning the LIST is brittle if someone
    // renames a YAML and forgets to update the map. Read the shipped
    // flows directory and assert every value in the map is present.
    delete process.env.PULSAR_FLOWS_DIR; // use the default kestra/flows/dental
    const { FLOWS_BY_MODULE, loadDentalFlows } = await importFresh();
    const onDisk = new Set(loadDentalFlows("test-tenant").map((f) => f.id));
    const allMapped = new Set<string>();
    for (const flows of Object.values(FLOWS_BY_MODULE)) flows.forEach((f) => allMapped.add(f));
    for (const id of allMapped) {
      expect(onDisk, `flow id "${id}" mapped in FLOWS_BY_MODULE but no .yml found in kestra/flows/dental/`).toContain(id);
    }
  });
});

describe("loadDentalFlows", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "flows-test-"));
    process.env.PULSAR_FLOWS_DIR = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.PULSAR_FLOWS_DIR;
    vi.unstubAllEnvs();
  });

  function write(name: string, content: string) {
    writeFileSync(path.join(tmp, name), content);
  }

  it("returns one entry per .yml file", async () => {
    write("a.yml", "id: a\nnamespace: dental\n");
    write("b.yaml", "id: b\nnamespace: dental\n");
    write("notes.txt", "ignore me");
    const { loadDentalFlows } = await importFresh(); const out = loadDentalFlows("acme-dental");
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });

  it("rewrites the top-level namespace from `dental` to `dental.<slug>`", async () => {
    write("a.yml", "id: a\nnamespace: dental\ntasks: []\n");
    const { loadDentalFlows } = await importFresh(); const [out] = loadDentalFlows("acme-dental");
    expect(out.yaml).toContain("namespace: dental.acme-dental");
    expect(out.yaml).not.toMatch(/^namespace: dental$/m);
  });

  it("rewrites NESTED `namespace: dental` (e.g. inside a Subflow task) AND preserves indentation", async () => {
    // Mirrors apt-reminder-demo.yml's Subflow block.
    const src = [
      "id: parent",
      "namespace: dental",
      "tasks:",
      "  - id: per_appointment",
      "    type: io.kestra.plugin.core.flow.ForEach",
      "    tasks:",
      "      - id: spawn_row",
      "        type: io.kestra.plugin.core.flow.Subflow",
      "        namespace: dental",
      "        flowId: apt-reminder-row",
      "",
    ].join("\n");
    write("parent.yml", src);
    const { loadDentalFlows } = await importFresh(); const [out] = loadDentalFlows("acme-dental");
    // Both top-level AND inner namespace lines rewritten:
    expect(out.yaml.match(/namespace: dental\.acme-dental/g)?.length).toBe(2);
    expect(out.yaml).not.toMatch(/namespace: dental$/m);
    // Indentation on the inner ref preserved (8 spaces) — drift here
    // produces invalid YAML.
    expect(out.yaml).toContain("        namespace: dental.acme-dental");
  });

  it("does NOT rewrite already-tenanted strings (e.g. `namespace: dental.other-clinic`)", async () => {
    write("a.yml", "id: a\nnamespace: dental.other-clinic\ntasks: []\n");
    const { loadDentalFlows } = await importFresh(); const [out] = loadDentalFlows("acme-dental");
    // The regex anchors on `dental` exactly, so already-tenanted
    // namespaces stay put.
    expect(out.yaml).toContain("namespace: dental.other-clinic");
    expect(out.yaml).not.toContain("namespace: dental.acme-dental");
  });

  it("throws when the flows directory is unreadable", async () => {
    process.env.PULSAR_FLOWS_DIR = "/nonexistent-path-please-xyz";
    const { loadDentalFlows } = await importFresh(); expect(() => loadDentalFlows("acme")).toThrow(/flows_dir_unreadable/);
  });

  it("throws when a flow file has no id line", async () => {
    write("noid.yml", "namespace: dental\ntasks: []\n");
    const { loadDentalFlows } = await importFresh(); expect(() => loadDentalFlows("acme-dental")).toThrow(/flow_missing_id/);
  });
});
