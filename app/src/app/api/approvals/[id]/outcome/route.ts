import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { KESTRA_URL } from "@/lib/kestra";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/{execId}/outcome
 *
 * Polls the row execution's task list and rolls up to one of:
 *   - sent     : send_sms SUCCESS (with sentTo + sentBody from Twilio)
 *   - failed   : any task FAILED (with the deepest leaf error)
 *   - skipped  : execution KILLED (Skip path)
 *   - running  : send_sms RUNNING / approval_gate just resumed
 *   - pending  : approval_gate still PAUSED
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireAuth(req);
    const { id } = await params;

    const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}`);
    if (!res.ok) return NextResponse.json({ error: "execution_not_found" }, { status: 404 });
    const exec = await res.json();

    const trs = (exec.taskRunList ?? []) as Array<{
      id: string;
      taskId: string;
      state: { current: string };
      attempts?: Array<{ logs?: Array<{ message?: string; level?: string }>; state?: { current?: string } }>;
      outputs?: Record<string, unknown>;
    }>;

    const gate = trs.find((t) => t.taskId === "approval_gate");
    const send = trs.find((t) => t.taskId === "send_sms");
    const execState = (exec.state?.current ?? "") as string;

    type ParsedTwilio = { sid?: string; status?: string; to?: string; body?: string; message?: string; code?: number };
    let sendBodyParsed: ParsedTwilio | null = null;
    if (send?.outputs?.body) {
      const raw: unknown = send.outputs.body;
      if (typeof raw === "string") {
        try { sendBodyParsed = JSON.parse(raw) as ParsedTwilio; } catch { /* not JSON */ }
      } else if (typeof raw === "object" && raw !== null) {
        sendBodyParsed = raw as ParsedTwilio;
      }
    }

    const findError = (t: { attempts?: Array<{ logs?: Array<{ message?: string; level?: string }>; state?: { current?: string } }> } | undefined): string | null => {
      if (!t?.attempts) return null;
      const failed = t.attempts.find((a) => a.state?.current === "FAILED");
      const log = failed?.logs?.find((l) => l.level === "ERROR");
      return log?.message ?? null;
    };

    let summary: "sent" | "failed" | "skipped" | "running" | "pending" = "pending";
    let detail = "";
    let sentTo: string | null = null;
    let sentBody: string | null = null;
    let twilioSid: string | null = null;
    let twilioStatus: string | null = null;

    if (send?.state?.current === "SUCCESS") {
      summary = "sent";
      if (sendBodyParsed?.sid) {
        twilioSid = sendBodyParsed.sid;
        twilioStatus = sendBodyParsed.status ?? "queued";
        detail = `Twilio ${twilioStatus}`;
      }
      if (typeof sendBodyParsed?.to === "string") sentTo = sendBodyParsed.to;
      if (typeof sendBodyParsed?.body === "string") sentBody = sendBodyParsed.body;
    } else if (execState === "KILLED" || gate?.state?.current === "KILLED") {
      summary = "skipped";
      detail = "Killed by user (Skip)";
    } else if (trs.some((t) => t.state?.current === "FAILED") || execState === "FAILED") {
      summary = "failed";
      // Prefer leaf failures with a meaningful error message.
      const leafOrder = ["send_sms", "approval_gate"];
      const leaf = leafOrder
        .map((tid) => trs.find((t) => t.taskId === tid && t.state?.current === "FAILED"))
        .find((t): t is NonNullable<typeof t> => Boolean(t));
      const err = findError(leaf) ?? findError(trs.find((t) => t.state?.current === "FAILED"));
      // Twilio error responses surface in send_sms outputs.body even
      // on FAILED — fold them into detail when present.
      if (!err && sendBodyParsed?.message) {
        detail = `Twilio ${sendBodyParsed.code ?? "error"}: ${sendBodyParsed.message}`;
      } else {
        detail = err ?? `task ${leaf?.taskId ?? "unknown"} failed`;
      }
    } else if (send?.state?.current === "RUNNING" || send?.state?.current === "CREATED") {
      summary = "running";
      detail = "Sending…";
    } else if (gate?.state?.current === "PAUSED") {
      summary = "pending";
    } else if (gate?.state?.current === "RUNNING" || gate?.state?.current === "SUCCESS") {
      // Just resumed; send_sms not yet recorded — still running.
      summary = "running";
      detail = "Sending…";
    }

    return NextResponse.json({ summary, detail, sentTo, sentBody, twilioSid, twilioStatus });
  } catch (e) {
    return authErrorResponse(e);
  }
}
