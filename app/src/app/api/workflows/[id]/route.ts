import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { queryOne, query } from "@/lib/db";
import { createOrUpdateFlowFromYaml, deleteFlow, getFlow, toggleFlow } from "@/lib/kestra";
import { generateKestraYaml } from "@/lib/workflow-generator";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/{id}
 *
 * `id` is one of:
 *   - a flowcore.workflows row id (UUID) — when the row was created via the
 *     custom builder. We return the structured authoring form so Edit can
 *     load it back into the builder.
 *   - a Kestra flow id (string like "appointment-reminder-test") — when the
 *     flow was provisioned by the Pulsar tenant-sync bridge with no DB row.
 *     We fetch the flow's YAML from Kestra and return a read-only-ish shape
 *     keyed on `editable_in_builder: false` so the UI can route to a YAML
 *     viewer instead of the builder.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug } = requireAuth(req);
    const namespace = namespaceFor(slug);
    const { id } = await params;

    // 1. Try as a flowcore.workflows row id (UUID).
    const dbRow = await queryOne<Record<string, unknown>>(
      "SELECT * FROM flowcore.workflows WHERE id = $1 AND clinic_id = $2",
      [id, slug],
    );
    if (dbRow) {
      return NextResponse.json({
        ...dbRow,
        kestra_namespace: namespace,
        editable_in_builder: true,
      });
    }

    // 2. Treat as a Kestra flow id (platform-managed). Reverse-map the
    //    Kestra task tree into the builder's structured form so Edit looks
    //    identical to Create with the values pre-filled. PUT below
    //    regenerates YAML from the builder shape and pushes to Kestra.
    try {
      const flow = await getFlow(namespace, id);
      const triggerSql = extractSqlFromFlow(flow);
      const { actions, actionMode } = reverseMapFlowToBuilder(flow);
      return NextResponse.json({
        id,
        name: id,
        description: humanizeStoredDescription(flow?.description ?? ""),
        trigger_type: flow?.triggers?.[0]?.cron ? "schedule" : "manual",
        trigger_cron: flow?.triggers?.[0]?.cron ?? "",
        trigger_sql: triggerSql,
        actions,
        action_mode: actionMode,
        is_enabled: !flow?.disabled,
        kestra_flow_id: id,
        kestra_namespace: namespace,
        clinic_id: slug,
        editable_in_builder: true,                        // builder UI renders for both modes now
        platform_managed: true,                            // hint to UI / PUT route
        raw_yaml_url: `http://localhost:8080/ui/flows/edit/${namespace}/${id}`,
        flow_definition: flow,
        flow_json_pretty: JSON.stringify(flow, null, 2),
        flow_yaml: dumpFlowYaml(flow),
      });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (e) {
    return authErrorResponse(e);
  }
}

/** Strip dev/ops notes from a YAML description (paragraphs starting with
 *  "Reads ", "Requirements", "secrets:", "kv:") leaving only the user-
 *  facing summary that the builder UI will round-trip. */
function humanizeStoredDescription(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const cuts = ["\n\nReads ", "\n\nRequirements ", "\nRequirements ", "\n\n#", "\nsecrets:", "\nkv:"];
  let end = trimmed.length;
  for (const c of cuts) {
    const idx = trimmed.indexOf(c);
    if (idx !== -1 && idx < end) end = idx;
  }
  return trimmed.slice(0, end).replace(/\s+/g, " ").trim();
}

/** Walk a Kestra flow's task tree and emit `WorkflowAction[]` matching
 *  the builder's structured form. Recognised patterns:
 *    - top-level HTTP Request to OD ShortQuery → trigger SQL fetch (skipped here, handled by extractSqlFromFlow)
 *    - top-level Log → skipped (logging is implicit in builder generation)
 *    - top-level ForEach → unwrap and parse its `tasks:` as actions
 *    - inside ForEach: Pause → {type:"approval"}
 *    - inside ForEach: If(approved) → unwrap and parse Then
 *    - HTTP Request to twilio /Messages → {type:"sms", to, message}
 *    - HTTP Request to /Calls       → {type:"voice_call"}
 *    - MailSend                     → {type:"email", emailTo, subject, body}
 *  Unknown shapes are dropped — caller can save to overwrite the YAML
 *  with what the builder produces. */
export function reverseMapFlowToBuilder(
  flow: { tasks?: Array<Record<string, unknown>> } | null | undefined,
): { actions: Array<Record<string, unknown>>; actionMode: "on_approval" | "immediate" | "manual" } {
  const out: Array<Record<string, unknown>> = [];
  let sawApproval = false;
  if (!flow?.tasks) return { actions: out, actionMode: "immediate" };
  for (const t of flow.tasks) {
    const type = String(t.type ?? "");
    if (type.endsWith("http.Request") && /ShortQuery/i.test(String((t as { uri?: unknown }).uri ?? ""))) continue;
    if (type.endsWith("log.Log")) continue;
    if (type.endsWith("flow.ForEach")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inner = ((t as any).tasks ?? []) as Array<Record<string, unknown>>;
      for (const child of inner) {
        const r = parseInnerAction(child);
        if (r === "approval") sawApproval = true;
        if (r && r !== "approval") out.push(r as Record<string, unknown>);
      }
      continue;
    }
    const r = parseInnerAction(t);
    if (r === "approval") sawApproval = true;
    if (r && r !== "approval") out.push(r as Record<string, unknown>);
  }
  // Approval gate is expressed via actionMode in the builder, not as an
  // entry in actions[] (the builder wraps each action in a Pause when
  // mode=on_approval). Surface it on the mode field.
  return { actions: out, actionMode: sawApproval ? "on_approval" : "immediate" };
}

function parseInnerAction(t: Record<string, unknown>): "approval" | Record<string, unknown> | null {
  const type = String(t.type ?? "");
  if (type.endsWith("flow.Pause")) return "approval";
  if (type.endsWith("log.Log")) return null;
  if (type.endsWith("flow.If")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const then = ((t as any).then ?? []) as Array<Record<string, unknown>>;
    for (const inner of then) {
      const r = parseInnerAction(inner);
      if (r && r !== "approval") return r;
    }
    return null;
  }
  if (type.endsWith("http.Request")) {
    const uri = String((t as { uri?: unknown }).uri ?? "");
    const body = String((t as { body?: unknown }).body ?? "");
    if (/twilio\.com.*Messages/i.test(uri)) {
      const to = body.match(/(?:^|&)To=([^&]+)/)?.[1];
      const msg = body.match(/(?:^|&)Body=([^&]+)/)?.[1];
      return {
        type: "sms",
        to: to ? decodeURIComponent(to.replace(/\+/g, " ")) : "{{ taskrun.value.WirelessPhone }}",
        message: msg ? decodeURIComponent(msg.replace(/\+/g, " ")) : "",
      };
    }
    if (/twilio\.com.*Calls/i.test(uri)) {
      return { type: "voice_call" };
    }
    return {
      type: "webhook",
      url: uri,
      method: String((t as { method?: unknown }).method ?? "POST"),
      webhookBody: body,
    };
  }
  if (type.includes("MailSend")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = t as any;
    return {
      type: "email",
      emailTo: Array.isArray(m.to) ? m.to[0] : m.to,
      subject: m.subject ?? "",
      body: m.htmlTextContent ?? m.text ?? "",
    };
  }
  return null;
}

/** Round-trip a Kestra flow JSON to YAML so the Edit page can show a
 *  human-readable, editable representation. Strips fields Kestra adds on
 *  read but rejects on write (revision, deleted, source*, …). */
function dumpFlowYaml(flow: unknown): string {
  if (!flow || typeof flow !== "object") return "";
  const READ_ONLY_FIELDS = new Set([
    "revision", "deleted", "sourceCode", "source", "_links", "_embedded",
  ]);
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flow as Record<string, unknown>)) {
    if (!READ_ONLY_FIELDS.has(k)) cleaned[k] = v;
  }
  return yaml.dump(cleaned, { lineWidth: 120, noRefs: true, sortKeys: false });
}

/** Pull the {"SqlCommand":"..."} payload out of an OpenDental Query API
 *  HTTP Request task. Returns the SQL string so the Edit builder's
 *  "Custom SQL" textarea isn't blank for platform-managed flows. */
export function extractSqlFromFlow(flow: { tasks?: Array<Record<string, unknown>> } | null | undefined): string {
  if (!flow?.tasks) return "";
  for (const t of flow.tasks) {
    if (t.type === "io.kestra.plugin.core.http.Request" && typeof t.body === "string") {
      const m = (t.body as string).match(/"SqlCommand"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return "";
}

/** Hand-rolled JSON-to-YAML so we don't pull in js-yaml just to render a
 *  read-only view. Kestra OSS doesn't expose a YAML source endpoint
 *  (`/source` is PATCH-only, JSON is the only Accept type). The output is
 *  not guaranteed round-trip-safe — it's for display only. */
export function stringifyFlowAsYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    // single-line strings: bare; multi-line: block scalar with indent
    if (!/[\n"#:&*?|>!%@`{}\[\],]/.test(value) && value.trim() === value && value !== "") return value;
    if (value.includes("\n")) {
      const lines = value.split("\n").map((l) => `${pad}  ${l}`).join("\n");
      return `|\n${lines}`;
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const rendered = stringifyFlowAsYaml(item, indent + 1);
        if (rendered.startsWith("\n")) return `${pad}-${rendered}`;
        const [first, ...rest] = rendered.split("\n");
        const head = `${pad}- ${first}`;
        const tail = rest.map((r) => `${pad}  ${r.replace(new RegExp("^" + "  ".repeat(indent + 1)), "")}`).join("\n");
        return rest.length ? `${head}\n${tail}` : head;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    return keys
      .map((k) => {
        const v = obj[k];
        const rendered = stringifyFlowAsYaml(v, indent + 1);
        if (rendered.includes("\n")) return `${pad}${k}:\n${rendered}`;
        return `${pad}${k}: ${rendered}`;
      })
      .join("\n");
  }
  return String(value);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug } = requireAuth(req);
    const namespace = namespaceFor(slug);
    const { id } = await params;
    const data = await req.json();

    // ── Toggle enable/disable ────────────────────────────────────────────
    if (data.action === "toggle") {
      // Try DB-row mode first; fall back to flow-id-only mode for tenant-sync flows.
      const wf = await queryOne<Record<string, unknown>>(
        "SELECT * FROM flowcore.workflows WHERE id = $1 AND clinic_id = $2",
        [id, slug],
      );
      if (wf) {
        const newEnabled = !wf.is_enabled;
        await query(
          "UPDATE flowcore.workflows SET is_enabled = $1, updated_at = now() WHERE id = $2",
          [newEnabled, id],
        );
        try {
          const flowId = (wf.kestra_flow_id as string) || (wf.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-");
          await toggleFlow(namespace, flowId, !newEnabled);
        } catch (e) {
          console.error("Kestra toggle failed:", e);
        }
        return NextResponse.json({ is_enabled: newEnabled });
      }
      // Plain Kestra flow id.
      const flow = await getFlow(namespace, id);
      const newDisabled = !flow.disabled;
      await toggleFlow(namespace, id, newDisabled);
      return NextResponse.json({ is_enabled: !newDisabled });
    }

    // ── Full update via builder ──────────────────────────────────────────
    // Two paths:
    //   1) flowcore.workflows row exists (builder-created) → UPDATE row + redeploy
    //   2) no row (platform-managed) → just regenerate YAML from builder
    //      shape and push to Kestra. We don't INSERT a flowcore row to
    //      keep Plan B's "no parallel store" stance honest; if the user
    //      makes structural changes the builder can't represent, the next
    //      tenant-sync provision call will overwrite their edits with the
    //      on-disk YAML — they'll see a "platform_managed" warning in
    //      the UI explaining this.
    const wf = await queryOne<Record<string, unknown>>(
      "SELECT * FROM flowcore.workflows WHERE id = $1 AND clinic_id = $2",
      [id, slug],
    );
    if (wf) {
      const updated = await queryOne(
        `UPDATE flowcore.workflows SET
          name = COALESCE($2, name),
          description = $3,
          trigger_cron = COALESCE($4, trigger_cron),
          trigger_sql = COALESCE($5, trigger_sql),
          actions = COALESCE($6::jsonb, actions),
          updated_at = now()
         WHERE id = $1 AND clinic_id = $7 RETURNING *`,
        [
          id,
          data.name,
          data.description || null,
          data.triggerCron,
          data.triggerSql,
          data.actions ? JSON.stringify(data.actions) : null,
          slug,
        ],
      );
      const u = updated as Record<string, unknown>;
      try {
        const { parent, worker } = generateKestraYaml(
          {
            id: u.id as string,
            name: u.name as string,
            description: u.description as string,
            triggerType: u.trigger_type as string,
            triggerCron: u.trigger_cron as string,
            triggerSql: u.trigger_sql as string,
            actions: typeof u.actions === "string" ? JSON.parse(u.actions as string) : (u.actions as []),
            namespace,
          },
          { pair: true },
        );
        await createOrUpdateFlowFromYaml(worker);
        if (parent) await createOrUpdateFlowFromYaml(parent);
      } catch (e) {
        console.error("Kestra redeploy failed:", e);
      }
      return NextResponse.json(updated);
    }

    // Platform-managed path: regenerate YAML from the builder form and push.
    try {
      const { parent, worker } = generateKestraYaml(
        {
          id,
          name: data.name ?? id,
          description: data.description ?? "",
          triggerType: data.triggerType ?? "schedule",
          triggerCron: data.triggerCron ?? "0 9 * * *",
          triggerSql: data.triggerSql ?? "",
          actions: Array.isArray(data.actions) ? data.actions : [],
          actionMode: data.actionMode ?? "on_approval",
          namespace,
        },
        { pair: true },
      );
      await createOrUpdateFlowFromYaml(worker);
      if (parent) await createOrUpdateFlowFromYaml(parent);
      return NextResponse.json({
        ok: true, id, namespace, platform_managed: true,
        warning: "Edits applied to Kestra. The next tenant-sync provision will overwrite them with the on-disk YAML — durable per-tenant overrides are tracked separately.",
      });
    } catch (e) {
      return NextResponse.json({
        ok: false, error: "kestra_redeploy_failed", detail: (e as Error).message,
      }, { status: 422 });
    }
  } catch (e) {
    return authErrorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug } = requireAuth(req);
    const namespace = namespaceFor(slug);
    const { id } = await params;

    const wf = await queryOne<Record<string, unknown>>(
      "SELECT * FROM flowcore.workflows WHERE id = $1 AND clinic_id = $2",
      [id, slug],
    );
    if (wf) {
      try {
        const flowId = (wf.kestra_flow_id as string) || (wf.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        await deleteFlow(namespace, `${flowId}-run`).catch(() => {});
        await deleteFlow(namespace, flowId).catch(() => {});
      } catch (e) {
        console.error("Kestra delete failed:", e);
      }
      await query("DELETE FROM flowcore.workflows WHERE id = $1", [id]);
    } else {
      // Plain Kestra flow id (platform-managed). Allow delete of the flow
      // from Kestra; the next /tenant-sync/provision call will redeploy it.
      try { await deleteFlow(namespace, id); } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e);
  }
}
