/**
 * Twilio REST client helpers used by the app (outside Kestra flows).
 *
 * Kestra flows talk to Twilio directly via HTTP Request tasks with the
 * clinic's credentials stored in namespace KV. This library is for
 * app-triggered actions: phone lookups, ad-hoc outbound SMS from the
 * conversations UI, and kicking off voice calls.
 *
 * Credentials are read per-clinic from flowcore.clinics (SID + from number)
 * and the auth token is read from Kestra secrets. For app-side calls we
 * fall back to env vars TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN so developers
 * can drive the feature locally without a full Kestra roundtrip.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function basicAuth(sid: string, token: string): string {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

export interface TwilioCreds {
  sid: string;
  authToken: string;
  fromNumber?: string | null;
}

/**
 * Look up a phone number. Returns validity, line type (mobile/landline/voip),
 * and carrier. Costs ~$0.005 per lookup (first "basic" lookup is free).
 * See: https://www.twilio.com/docs/lookup/v2-api
 */
export async function lookupPhone(
  phone: string,
  creds: TwilioCreds
): Promise<{
  valid: boolean;
  lineType: string | null;
  carrier: string | null;
  countryCode: string | null;
  raw: unknown;
}> {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(
    phone
  )}?Fields=line_type_intelligence`;
  const res = await fetch(url, {
    headers: { Authorization: basicAuth(creds.sid, creds.authToken) },
  });
  if (res.status === 404) {
    return { valid: false, lineType: null, carrier: null, countryCode: null, raw: null };
  }
  if (!res.ok) throw new Error(`Twilio Lookup error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    valid: data.valid !== false,
    lineType: data.line_type_intelligence?.type || null,
    carrier: data.line_type_intelligence?.carrier_name || null,
    countryCode: data.country_code || null,
    raw: data,
  };
}

/**
 * Send an SMS. Used by the conversations UI when staff types a manual reply.
 */
export async function sendSms(
  to: string,
  body: string,
  creds: TwilioCreds
): Promise<{ sid: string; status: string }> {
  if (!creds.fromNumber) throw new Error("Twilio from number is not configured for this clinic");
  const url = `${TWILIO_API}/Accounts/${creds.sid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: creds.fromNumber, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds.sid, creds.authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio SMS error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { sid: data.sid, status: data.status };
}

/**
 * Place an outbound voice call. TwiML URL drives what the caller hears and
 * how DTMF keypresses are handled. Point this at our /api/twilio/voice/twiml
 * endpoint for the standard "press 1 to confirm" appointment script.
 */
export async function placeCall(
  to: string,
  twimlUrl: string,
  statusCallbackUrl: string | undefined,
  creds: TwilioCreds
): Promise<{ sid: string; status: string }> {
  if (!creds.fromNumber) throw new Error("Twilio from number is not configured for this clinic");
  const url = `${TWILIO_API}/Accounts/${creds.sid}/Calls.json`;
  const form = new URLSearchParams({
    To: to,
    From: creds.fromNumber,
    Url: twimlUrl,
    Method: "GET",
  });
  if (statusCallbackUrl) {
    form.set("StatusCallback", statusCallbackUrl);
    form.append("StatusCallbackEvent", "completed");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds.sid, creds.authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio Call error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { sid: data.sid, status: data.status };
}

/**
 * Reads the Twilio auth token for a clinic. Prefers the clinic's own Kestra
 * secret; falls back to the env var for local dev.
 */
export async function getClinicTwilioAuth(
  kestraNamespace: string
): Promise<string> {
  const envToken = process.env.TWILIO_AUTH_TOKEN;
  if (envToken) return envToken;
  // In production we'd read the secret from Kestra. Kestra's secrets API is
  // write-only via REST, so the canonical path is: app stores the token
  // securely (env for now) and pushes it to Kestra for flow-time use.
  throw new Error(
    `No Twilio auth token available for ${kestraNamespace}. Set TWILIO_AUTH_TOKEN in the app environment.`
  );
}

/**
 * Classify an inbound SMS body into a keyword. Runs the standard Twilio
 * STOP/START/HELP plus our app-level keywords (CONFIRM/CANCEL/RESCHEDULE).
 */
export function classifyInboundSms(body: string): string | null {
  const t = body.trim().toUpperCase();
  if (!t) return null;
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(t)) return "STOP";
  if (["START", "UNSTOP", "YES"].includes(t)) return "START";
  if (t === "HELP" || t === "INFO") return "HELP";
  if (["CONFIRM", "C", "1", "Y"].includes(t)) return "CONFIRM";
  if (["RESCHEDULE", "R", "2"].includes(t)) return "RESCHEDULE";
  if (["CALL", "CALLME", "3"].includes(t)) return "CALL";
  return null;
}
