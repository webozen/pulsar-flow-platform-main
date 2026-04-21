import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Twilio posts here after the caller presses a digit.
 * We record the response and fire a Kestra webhook so the workflow can
 * branch (digit 1 → mark confirmed, 2 → create reschedule task, 3 → ring front desk).
 *
 * Response TwiML plays a short acknowledgement before hanging up.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const digit = String(form.get("Digits") || "");
  const callSid = String(form.get("CallSid") || "");
  const from = String(form.get("From") || "");
  const to = String(form.get("To") || "");

  // Persist the response
  await query(
    `UPDATE flowcore.voice_calls SET response_digit = $1, completed_at = now() WHERE twilio_sid = $2`,
    [digit, callSid]
  );

  const clinic = await queryOne<{ id: string; kestra_namespace: string }>(
    `SELECT id, kestra_namespace FROM flowcore.clinics WHERE twilio_from_number = $1 LIMIT 1`,
    [to] // "To" from Twilio's perspective is our From (the call leg coming back)
  );

  // Fire a Kestra webhook so the workflow can react to the digit
  if (clinic) {
    const kestraUrl = process.env.KESTRA_API_URL || "http://localhost:8080";
    try {
      await fetch(
        `${kestraUrl}/api/v1/executions/webhook/${clinic.kestra_namespace}/voice-response/voice-response`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSid, digit, from, to, clinicId: clinic.id }),
        }
      );
    } catch { /* no flow configured is fine */ }
  }

  let message = "Thank you. Goodbye.";
  if (digit === "1") message = "Your appointment is confirmed. Thank you, goodbye.";
  else if (digit === "2") message = "We'll have someone reach out to reschedule. Goodbye.";
  else if (digit === "3") message = "Please hold while we connect you.";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${message}</Say>
  <Hangup/>
</Response>`;

  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
