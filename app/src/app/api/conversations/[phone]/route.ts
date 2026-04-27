import { NextResponse } from "next/server";
import { query, queryOne, initDb } from "@/lib/db";
import { sendSms, getClinicTwilioAuth } from "@/lib/twilio";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { getOrCreateClinic } from "@/lib/clinic-context";
import { getKV } from "@/lib/kestra";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

/**
 * GET  — full message thread for (clinic, phone)
 * POST — send an outbound SMS and append to thread
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const { phone: rawPhone } = await params;
    const phone = decodeURIComponent(rawPhone);

    const messages = await query(
      `SELECT id, direction, from_number, to_number, body, keyword, created_at, execution_id
         FROM flowcore.sms_messages
        WHERE clinic_id = $1 AND (from_number = $2 OR to_number = $2)
        ORDER BY created_at ASC`,
      [clinic.id, phone]
    );

    const optedOut = !!(await queryOne(
      `SELECT 1 FROM flowcore.sms_opt_outs WHERE clinic_id = $1 AND phone_number = $2`,
      [clinic.id, phone]
    ));

    return NextResponse.json({ phone, messages, optedOut });
  } catch (e) {
    return authErrorResponse(e);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const { phone: rawPhone } = await params;
    const phone = decodeURIComponent(rawPhone);
    const { body } = await req.json();

    if (!body) {
      return NextResponse.json({ error: "body required" }, { status: 400 });
    }

    // Twilio creds + sender number come from Kestra KV (Phase 2 cleanup:
    // those columns dropped from flowcore.clinics).
    const namespace = namespaceFor(slug);
    const twilioSid = await getKV(namespace, "twilio_sid");
    const twilioFromNumber = await getKV(namespace, "twilio_from_number");
    if (!twilioSid || !twilioFromNumber) {
      return NextResponse.json({ error: "Clinic Twilio not configured" }, { status: 400 });
    }

    // Respect opt-outs — staff override requires explicit unstop
    const optOut = await queryOne(
      `SELECT 1 FROM flowcore.sms_opt_outs WHERE clinic_id = $1 AND phone_number = $2`,
      [clinic.id, phone]
    );
    if (optOut) {
      return NextResponse.json(
        { error: "Recipient has opted out. Remove from opt-out list to message them." },
        { status: 409 }
      );
    }

    const authToken = await getClinicTwilioAuth(namespace);
    const result = await sendSms(phone, body, {
      sid: twilioSid,
      authToken,
      fromNumber: twilioFromNumber,
    });

    await query(
      `INSERT INTO flowcore.sms_messages (clinic_id, direction, from_number, to_number, body, twilio_sid)
       VALUES ($1, 'outbound', $2, $3, $4, $5)`,
      [clinic.id, twilioFromNumber, phone, body, result.sid]
    );

    return NextResponse.json({ ok: true, sid: result.sid });
  } catch (e) {
    return authErrorResponse(e);
  }
}
