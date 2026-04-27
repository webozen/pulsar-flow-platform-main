import { NextResponse } from "next/server";
import { resumeExecution, killExecution } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { query, initDb } from "@/lib/db";
import { checkResumeRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/approvals/{id}/resume — advance one paused row execution.
 *
 *   body { }                                  → Approve = resume the exec.
 *   body { action: "kill", payload?: ... }    → Skip    = kill the exec.
 *   body { payload?: ... }                    → caller-supplied audit ctx
 *
 * Side effects in addition to Kestra:
 *   1. Rate-limit check — caps clicks per (slug, exec) so a runaway
 *      script can't hammer Kestra/Twilio.
 *   2. Append-only audit row in flowcore.approval_audit with the JWT
 *      actor + action + execution + payload snapshot. Compliance can
 *      answer "who approved the SMS to patient X on date Y" even
 *      after Kestra's execution retention rotates the row away.
 *
 * NOTE: this route does NOT send any `taskRunId` to Kestra. Kestra
 * OSS 0.19's resume scoping is broken (verified — `?taskRunId=X`
 * silently resumes whichever paused gate is next in FIFO). The
 * subflow-per-row architecture (each row = own execution) sidesteps
 * that, so resume targets the whole execution unambiguously.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const claims = requireAuth(req);
    const { id } = await params;

    let action: "resume" | "kill" = "resume";
    let payload: Record<string, unknown> | null = null;
    try {
      const body = await req.json();
      if (body?.action === "kill") action = "kill";
      if (body?.payload && typeof body.payload === "object") {
        payload = body.payload as Record<string, unknown>;
      }
    } catch {
      /* no body = resume */
    }

    // Rate limit BEFORE the Kestra call. Per (slug, execId) so one
    // tenant flooding doesn't affect another, and so a stuck click in
    // the UI can't repeatedly poke the same execution.
    const rl = checkResumeRateLimit(claims.slug, id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    if (action === "kill") {
      await killExecution(id);
    } else {
      await resumeExecution(id);
    }

    // Audit insert is best-effort — a DB hiccup must not break the
    // user's approve flow. We log + continue.
    try {
      await initDb();
      await query(
        `INSERT INTO flowcore.approval_audit
          (slug, actor_email, actor_role, action, execution_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [claims.slug, claims.email || null, claims.role || null, action, id,
         payload ? JSON.stringify(payload) : null],
      );
    } catch (e) {
      console.error("[approval-audit] insert failed (non-fatal):", (e as Error).message);
    }

    return NextResponse.json({ ok: true, action });
  } catch (e) {
    return authErrorResponse(e);
  }
}
