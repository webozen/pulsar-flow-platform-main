import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Twilio posts here when a voice call completes (StatusCallback).
 * Updates the stored record with final status + duration.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const callSid = String(form.get("CallSid") || "");
  const status = String(form.get("CallStatus") || "");
  const duration = Number(form.get("CallDuration") || 0);

  await query(
    `UPDATE flowcore.voice_calls SET status = $1, duration_sec = $2, completed_at = now() WHERE twilio_sid = $3`,
    [status, duration || null, callSid]
  );

  return new Response("", { status: 204 });
}
