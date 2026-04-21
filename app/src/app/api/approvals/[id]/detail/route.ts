import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

const KESTRA_URL = process.env.KESTRA_API_URL || "http://localhost:8080";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    const { id } = await params;

    const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}`);
    if (!res.ok) return NextResponse.json({ error: "Execution not found" }, { status: 404 });

    const exec = await res.json();

    // Extract record data — per-record subflow has it in inputs.record
    let recordData: Record<string, unknown> | null = null;
    let queryResults: unknown[] = [];

    if (exec.inputs?.record) {
      const record = typeof exec.inputs.record === "string"
        ? JSON.parse(exec.inputs.record)
        : exec.inputs.record;
      recordData = record;
      queryResults = [record];
    }

    // Also check parent flow query outputs
    for (const tr of exec.taskRunList || []) {
      if (tr.taskId === "query_data_source" && tr.outputs?.body) {
        const body = tr.outputs.body;
        queryResults = typeof body === "string" ? JSON.parse(body) : body;
        break;
      }
    }

    // Extract labels
    const labels: Record<string, string> = {};
    for (const l of exec.labels || []) {
      labels[l.key] = l.value;
    }

    // Get the flow definition to extract action details
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
      queryResults,
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

/**
 * Walk the task tree, skip Pause tasks, resolve templates with record data,
 * and build human-readable previews of what each action will do.
 */
function extractActionPreviews(
  tasks: Record<string, unknown>[],
  record: Record<string, unknown> | null,
  previews: ActionPreview[],
  afterPause = false
) {
  for (const task of tasks) {
    const type = (task.type as string) || "";

    if (type.includes("Pause") && !task.delay) {
      afterPause = true;
      continue;
    }

    if (type.includes("Sequential") || type.includes("Parallel")) {
      extractActionPreviews((task.tasks as Record<string, unknown>[]) || [], record, previews, afterPause);
      continue;
    }

    if (!afterPause) continue;

    if (type.includes("http.Request")) {
      const uri = (task.uri as string) || "";
      const body = (task.body as string) || "";
      const resolved = record ? resolveTemplate(body, record) : body;
      const resolvedUri = record ? resolveTemplate(uri, record) : uri;

      if (uri.includes("twilio")) {
        // Parse SMS body from URL-encoded form
        const msgMatch = resolved.match(/Body=([^&]*)/);
        const toMatch = resolved.match(/To=([^&]*)/);
        previews.push({
          type: "sms",
          title: "Send SMS",
          details: {
            to: toMatch ? decodeURIComponent(toMatch[1]) : "?",
            message: msgMatch ? decodeURIComponent(msgMatch[1]) : resolved,
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
    } else if (type.includes("Log")) {
      // Skip log tasks
    }
  }
}

/** Resolve {{ inputs.record.field }} and {{ kv('x') }} templates with actual data */
function resolveTemplate(template: string, record: Record<string, unknown>): string {
  let result = template;
  // Replace {{ inputs.record.field }}
  result = result.replace(/\{\{\s*inputs\.record\.(\w+)\s*\}\}/g, (_match, field) => {
    return String(record[field] ?? `[${field}]`);
  });
  // Replace {{ taskrun.value.field }}
  result = result.replace(/\{\{\s*taskrun\.value\.(\w+)\s*\}\}/g, (_match, field) => {
    return String(record[field] ?? `[${field}]`);
  });
  // Leave {{ kv('x') }} as-is but mark it
  result = result.replace(/\{\{\s*kv\('(\w+)'\)\s*\}\}/g, (_match, key) => {
    return `[${key}]`;
  });
  return result;
}
