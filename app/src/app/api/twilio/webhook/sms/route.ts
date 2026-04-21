import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { classifyInboundSms } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Twilio posts here when a patient replies to an SMS.
 * Configure this URL in Twilio phone number console:
 *   https://<app>/api/twilio/webhook/sms
 * Body is application/x-www-form-urlencoded (TwiML webhook standard).
 *
 * Response is TwiML. Returning empty <Response/> means "don't auto-reply".
 * If the patient replied STOP, Twilio handles the carrier-level opt-out
 * automatically, but we mirror it into flowcore.sms_opt_outs so our
 * workflows skip that number on future sends.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const from = String(form.get("From") || "");
  const to = String(form.get("To") || "");
  const body = String(form.get("Body") || "");
  const messageSid = String(form.get("MessageSid") || "");

  // Match the inbound "To" number to a clinic by twilio_from_number
  const clinic = await queryOne<{ id: string; name: string; kestra_namespace: string }>(
    `SELECT id, name, kestra_namespace FROM flowcore.clinics WHERE twilio_from_number = $1 LIMIT 1`,
    [to]
  );

  if (!clinic) {
    // Unknown destination — log and return empty TwiML so Twilio doesn't retry
    console.warn(`[twilio.webhook.sms] no clinic matched To=${to}`);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const keyword = classifyInboundSms(body);

  // Try to resolve the phone to a known patient via Open Dental mock
  let patNum: string | null = null;
  try {
    const clinicRow = await queryOne<{ opendental_api_url: string; opendental_api_key: string }>(
      `SELECT opendental_api_url, opendental_api_key FROM flowcore.clinics WHERE id = $1`,
      [clinic.id]
    );
    if (clinicRow?.opendental_api_url) {
      const res = await fetch(
        `${clinicRow.opendental_api_url}/patients?phone=${encodeURIComponent(from)}`,
        { headers: { Authorization: `ODFHIR ${clinicRow.opendental_api_key || ""}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]?.PatNum) patNum = String(rows[0].PatNum);
      }
    }
  } catch {
    // Patient match is best-effort
  }

  // Persist the inbound message
  await query(
    `INSERT INTO flowcore.sms_messages (clinic_id, direction, from_number, to_number, body, twilio_sid, keyword, pat_num)
     VALUES ($1, 'inbound', $2, $3, $4, $5, $6, $7)`,
    [clinic.id, from, to, body, messageSid, keyword, patNum]
  );

  // Handle opt-out immediately
  if (keyword === "STOP") {
    await query(
      `INSERT INTO flowcore.sms_opt_outs (clinic_id, phone_number, reason)
       VALUES ($1, $2, 'patient replied STOP')
       ON CONFLICT (clinic_id, phone_number) DO NOTHING`,
      [clinic.id, from]
    );
  } else if (keyword === "START") {
    await query(
      `DELETE FROM flowcore.sms_opt_outs WHERE clinic_id = $1 AND phone_number = $2`,
      [clinic.id, from]
    );
  }

  // Trigger a Kestra webhook flow if the clinic has one set up for inbound replies.
  // Convention: flow id `inbound-sms` in the clinic namespace, with key `inbound-sms`.
  // Flow receives { from, to, body, keyword, patNum, clinicId } and decides routing.
  const kestraUrl = process.env.KESTRA_API_URL || "http://localhost:8080";
  try {
    await fetch(
      `${kestraUrl}/api/v1/executions/webhook/${clinic.kestra_namespace}/inbound-sms/inbound-sms`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          body,
          keyword,
          patNum,
          clinicId: clinic.id,
          messageSid,
        }),
      }
    );
  } catch {
    // No inbound-sms flow configured — that's fine, message is still logged
  }

  // TwiML response — auto-reply for STOP/HELP, silent otherwise
  let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  if (keyword === "HELP") {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
      `${clinic.name}: Reply STOP to unsubscribe. For appointments call our office.`
    )}</Message></Response>`;
  } else if (keyword === "CONFIRM") {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
      `${clinic.name}: Thanks — your appointment is confirmed. See you soon!`
    )}</Message></Response>`;
  }

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
