import { query, queryOne } from "@/lib/db";
import { classifyInboundSms } from "@/lib/twilio";
import { getKV, KESTRA_URL } from "@/lib/kestra";
import { OPENDENTAL_BASE } from "@/lib/opendental";
import { namespaceFor } from "@/lib/tenant-sync";

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

  // Inbound webhook routing: Twilio doesn't carry tenant identity, so we
  // map the receiving number to a clinic. Phase 2 keeps this lookup
  // small — only `slug` and `name` are needed; namespace is derived
  // from slug.
  const clinic = await queryOne<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM flowcore.clinics WHERE twilio_from_number = $1 LIMIT 1`,
    [to]
  );

  if (!clinic) {
    console.warn(`[twilio.webhook.sms] no clinic matched To=${to}`);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
      headers: { "Content-Type": "text/xml" },
    });
  }
  const namespace = namespaceFor(clinic.slug);

  const keyword = classifyInboundSms(body);

  // Resolve phone → patient via OpenDental. Per-tenant credentials live
  // in Kestra KV as `opendental_developer_key` + `opendental_customer_key`
  // (the actual KV key names — earlier code looked for `_api_url`/`_api_key`
  // which don't exist).
  let patNum: string | null = null;
  try {
    const dev = await getKV(namespace, "opendental_developer_key");
    const cust = await getKV(namespace, "opendental_customer_key");
    if (dev && cust) {
      const res = await fetch(
        `${OPENDENTAL_BASE}/patients?phone=${encodeURIComponent(from)}`,
        { headers: { Authorization: `ODFHIR ${dev}/${cust}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]?.PatNum) patNum = String(rows[0].PatNum);
      }
    }
  } catch {
    // Patient match is best-effort
  }

  await query(
    `INSERT INTO flowcore.sms_messages (clinic_id, direction, from_number, to_number, body, twilio_sid, keyword, pat_num)
     VALUES ($1, 'inbound', $2, $3, $4, $5, $6, $7)`,
    [clinic.id, from, to, body, messageSid, keyword, patNum]
  );

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
  try {
    await fetch(
      `${KESTRA_URL}/api/v1/executions/webhook/${namespace}/inbound-sms/inbound-sms`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to, body, keyword, patNum,
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
