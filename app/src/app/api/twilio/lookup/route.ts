import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { lookupPhone, getClinicTwilioAuth } from "@/lib/twilio";
import { getKV } from "@/lib/kestra";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

/**
 * Validate a phone number via Twilio Lookup.
 * POST body: { phone: "+14155550100", clinicId: "...", force?: boolean }
 * Cached in flowcore.phone_lookups — pass force=true to re-query.
 */
export async function POST(req: Request) {
  const { phone, clinicId, force } = await req.json();
  if (!phone || !clinicId) {
    return NextResponse.json({ error: "phone and clinicId are required" }, { status: 400 });
  }

  if (!force) {
    const cached = await queryOne<{
      valid: boolean;
      line_type: string | null;
      carrier: string | null;
      country_code: string | null;
      looked_up_at: string;
    }>(`SELECT valid, line_type, carrier, country_code, looked_up_at FROM flowcore.phone_lookups WHERE phone_number = $1`, [phone]);
    if (cached) {
      return NextResponse.json({
        phone,
        valid: cached.valid,
        lineType: cached.line_type,
        carrier: cached.carrier,
        countryCode: cached.country_code,
        cached: true,
        lookedUpAt: cached.looked_up_at,
      });
    }
  }

  // Map clinicId → slug → namespace → KV creds. Accept BOTH a slug
  // (the Plan B URL identity) and a UUID (legacy callers passing
  // flowcore.clinics.id). Earlier this only handled UUIDs and silently
  // returned "Clinic not found" when the UI passed the slug from
  // useParams().
  let slug: string | null = clinicId;
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(String(clinicId))) {
    const row = await queryOne<{ slug: string }>(
      `SELECT slug FROM flowcore.clinics WHERE id = $1`,
      [clinicId]
    );
    slug = row?.slug ?? null;
  }
  if (!slug) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }
  const namespace = namespaceFor(slug);
  const twilioSid = await getKV(namespace, "twilio_sid");
  const twilioFromNumber = await getKV(namespace, "twilio_from_number");
  if (!twilioSid) {
    return NextResponse.json({ error: "Clinic has no Twilio credentials configured" }, { status: 400 });
  }

  try {
    const authToken = await getClinicTwilioAuth(namespace);
    const result = await lookupPhone(phone, {
      sid: twilioSid,
      authToken,
      fromNumber: twilioFromNumber ?? undefined,
    });

    await query(
      `INSERT INTO flowcore.phone_lookups (phone_number, valid, line_type, carrier, country_code, raw, looked_up_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (phone_number) DO UPDATE SET
         valid = EXCLUDED.valid,
         line_type = EXCLUDED.line_type,
         carrier = EXCLUDED.carrier,
         country_code = EXCLUDED.country_code,
         raw = EXCLUDED.raw,
         looked_up_at = now()`,
      [phone, result.valid, result.lineType, result.carrier, result.countryCode, result.raw]
    );

    return NextResponse.json({ phone, ...result, cached: false });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
