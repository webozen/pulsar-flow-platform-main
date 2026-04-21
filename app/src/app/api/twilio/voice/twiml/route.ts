import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Twilio fetches this URL when an outbound call connects.
 * We return TwiML that plays a greeting and gathers a 1-digit DTMF response.
 *
 * Query params:
 *   clinicName   — "Smile Dental Care"
 *   patientName  — "Sarah"
 *   aptDate      — "tomorrow at 2pm"
 *   callbackUrl  — where Twilio should POST the digit that was pressed
 *                  (defaults to /api/twilio/voice/gather on this app)
 *
 * The clinic's workflow builds the URL with template variables filled in,
 * so the patient hears their own name and appointment time.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clinicName = url.searchParams.get("clinicName") || "your dental office";
  const patientName = url.searchParams.get("patientName") || "";
  const aptDate = url.searchParams.get("aptDate") || "your upcoming appointment";
  const gatherUrl =
    url.searchParams.get("callbackUrl") ||
    `${url.origin}/api/twilio/voice/gather`;

  const greeting = patientName
    ? `Hello ${patientName}, this is ${clinicName} calling about ${aptDate}.`
    : `Hello, this is ${clinicName} calling about ${aptDate}.`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(gatherUrl)}" method="POST" timeout="8">
    <Say voice="Polly.Joanna">${escapeXml(greeting)} Please press 1 to confirm, 2 to reschedule, or 3 to speak with reception.</Say>
  </Gather>
  <Say voice="Polly.Joanna">We didn't hear a response. Goodbye.</Say>
</Response>`;

  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
