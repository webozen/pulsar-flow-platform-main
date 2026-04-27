import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { KESTRA_URL } from "@/lib/kestra";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/{execId}/detail
 *
 * For a row execution of `apt-reminder-row`, returns:
 *   - recordData: the parsed `inputs.row` (the appointment record)
 *   - actionPreviews: human-readable preview of every outbound action
 *     in the flow, with templates resolved against recordData.
 *   - taskRuns: lightweight state list for the UI.
 *
 * No taskRunId scoping needed — each execution has exactly one row.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireAuth(req);
    const { id } = await params;

    const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}`);
    if (!res.ok) return NextResponse.json({ error: "Execution not found" }, { status: 404 });

    const exec = await res.json();

    // Builder-generated worker flows pass the row as `inputs.record`
    // (typed JSON). Legacy flows used `inputs.row`. Accept both.
    let recordData: Record<string, unknown> | null = null;
    const rawRow = exec.inputs?.record ?? exec.inputs?.row;
    if (rawRow) {
      try {
        const parsed = typeof rawRow === "string" ? JSON.parse(rawRow) : rawRow;
        if (parsed && typeof parsed === "object") recordData = parsed as Record<string, unknown>;
      } catch { /* not JSON */ }
    }

    const labels: Record<string, string> = {};
    for (const l of exec.labels || []) labels[l.key] = l.value;

    const actionPreviews: ActionPreview[] = [];
    try {
      const flowRes = await fetch(`${KESTRA_URL}/api/v1/flows/${exec.namespace}/${exec.flowId}`);
      if (flowRes.ok) {
        const flow = await flowRes.json();
        extractActionPreviews(flow.tasks || [], recordData, actionPreviews);
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      id: exec.id,
      flowId: exec.flowId,
      namespace: exec.namespace,
      state: exec.state?.current,
      labels,
      recordData,
      actionPreviews,
      taskRuns: (exec.taskRunList || []).map((tr: { taskId: string; state: { current: string } }) => ({
        taskId: tr.taskId,
        state: tr.state.current,
      })),
    });
  } catch (e) {
    return authErrorResponse(e);
  }
}

interface ActionPreview {
  type: "sms" | "email" | "webhook" | "commlog" | "apt_update" | "ai" | "delay" | "other";
  title: string;
  details: Record<string, string>;
}

/** Walk the task tree, skip Pause tasks, resolve templates with record
 *  data, and build human-readable previews of what each action will do. */
function extractActionPreviews(
  tasks: Record<string, unknown>[],
  record: Record<string, unknown> | null,
  previews: ActionPreview[],
  afterPause = false,
) {
  for (const task of tasks) {
    const type = (task.type as string) || "";

    if (type.includes("Pause") && !task.delay) {
      afterPause = true;
      continue;
    }
    if (type.includes("Sequential") || type.includes("Parallel") || type.includes("ForEach")) {
      extractActionPreviews((task.tasks as Record<string, unknown>[]) || [], record, previews, afterPause);
      continue;
    }
    if (type.includes("flow.If")) {
      const then = (task as { then?: Record<string, unknown>[] }).then ?? [];
      extractActionPreviews(then, record, previews, afterPause);
      continue;
    }

    if (!afterPause) continue;

    if (type.includes("http.Request")) {
      const uri = (task.uri as string) || "";
      const body = (task.body as string) || "";
      const resolved = record ? resolveTemplate(body, record) : body;
      const resolvedUri = record ? resolveTemplate(uri, record) : uri;

      if (uri.includes("twilio")) {
        // The Twilio body is application/x-www-form-urlencoded — spaces
        // are encoded as `+`. URLSearchParams handles both, giving us
        // human-readable text.
        const partsWithSpaces = resolved.replace(/\+/g, " ");
        const params = new URLSearchParams(resolved);
        const message = params.get("Body") ?? partsWithSpaces;
        previews.push({
          type: "sms",
          title: "Send SMS",
          details: {
            to: params.get("To") ?? "?",
            message,
          },
        });
      } else if (uri.includes("smtp") || uri.includes("mail") || uri.includes("email")) {
        try {
          const emailData = JSON.parse(resolved);
          previews.push({
            type: "email",
            title: "Send Email",
            details: {
              to: emailData.to || "?",
              subject: emailData.subject || "?",
              body: emailData.body || "",
            },
          });
        } catch {
          previews.push({ type: "email", title: "Send Email", details: { raw: resolved } });
        }
      } else if (uri.includes("commlogs")) {
        previews.push({ type: "commlog", title: "Create Commlog", details: { body: resolved } });
      } else if (uri.includes("appointments")) {
        previews.push({ type: "apt_update", title: "Update Appointment", details: { uri: resolvedUri, body: resolved } });
      } else if (uri.includes("openai") || uri.includes("chat/completions")) {
        previews.push({ type: "ai", title: "AI Generate Message", details: { prompt: resolved } });
      } else {
        previews.push({ type: "webhook", title: "Webhook", details: { url: resolvedUri, body: resolved } });
      }
    } else if (type.includes("Pause") && task.delay) {
      previews.push({ type: "delay", title: `Wait ${task.delay}`, details: { duration: task.delay as string } });
    }
  }
}

/** Resolve common Pebble forms used in shipped flows so the action
 *  preview renders the actual SMS/email/webhook the patient will
 *  receive instead of raw `{{ … }}` syntax. Anything we don't
 *  recognise stays as a `[name]` placeholder. */
export function resolveTemplate(template: string, record: Record<string, unknown>): string {
  let result = template;

  // {{ fromJson(inputs.row).field }} — apt-reminder-row's canonical form.
  result = result.replace(
    /\{\{\s*fromJson\(\s*inputs\.row\s*\)\.(\w+)\s*\}\}/g,
    (_m, field) => String(record[field] ?? `[${field}]`),
  );

  // {{ inputs.row.field }} — same pattern without fromJson.
  result = result.replace(/\{\{\s*inputs\.row\.(\w+)\s*\}\}/g, (_m, field) =>
    String(record[field] ?? `[${field}]`),
  );

  // {{ fromJson(parents[0].taskrun.value).field }} — Sequential-wrapped
  // ForEach iteration; kept for any flow still using the legacy shape.
  result = result.replace(
    /\{\{\s*fromJson\(\s*parents\[\d+\]\.taskrun\.value\s*\)\.(\w+)\s*\}\}/g,
    (_m, field) => String(record[field] ?? `[${field}]`),
  );

  // {{ fromJson(taskrun.value).field }} — flat ForEach iteration.
  result = result.replace(
    /\{\{\s*fromJson\(\s*taskrun\.value\s*\)\.(\w+)\s*\}\}/g,
    (_m, field) => String(record[field] ?? `[${field}]`),
  );

  // {{ inputs.record.field }} — non-ForEach single-row flows.
  result = result.replace(/\{\{\s*inputs\.record\.(\w+)\s*\}\}/g, (_m, field) =>
    String(record[field] ?? `[${field}]`),
  );

  // {{ taskrun.value.field }} — flat ForEach without fromJson.
  result = result.replace(/\{\{\s*taskrun\.value\.(\w+)\s*\}\}/g, (_m, field) =>
    String(record[field] ?? `[${field}]`),
  );

  // {{ kv('x') }} — leave as `[x]` since the preview doesn't have KV access.
  result = result.replace(/\{\{\s*kv\(['"](\w+)['"]\)\s*\}\}/g, (_m, key) => `[${key}]`);
  return result;
}
