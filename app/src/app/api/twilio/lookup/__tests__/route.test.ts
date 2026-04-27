/**
 * Tests for the Twilio phone-lookup endpoint.
 *
 * Caches results in flowcore.phone_lookups to avoid paying for repeat
 * Twilio Lookup API calls. Twilio creds (sid + auth token + from
 * number) live in Kestra KV per-tenant. Accepts either a slug or a
 * UUID for clinicId — same defensive pattern used by /api/triggers/test.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { queryMock, queryOneMock, getKVMock, lookupPhoneMock, getClinicTwilioAuthMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  getKVMock: vi.fn(),
  lookupPhoneMock: vi.fn(),
  getClinicTwilioAuthMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: queryMock, queryOne: queryOneMock }));
vi.mock("@/lib/kestra", () => ({ getKV: getKVMock }));
vi.mock("@/lib/twilio", () => ({
  lookupPhone: lookupPhoneMock,
  getClinicTwilioAuth: getClinicTwilioAuthMock,
}));

import { POST } from "../route";

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  getKVMock.mockReset();
  lookupPhoneMock.mockReset();
  getClinicTwilioAuthMock.mockReset();
});

function req(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/twilio/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/twilio/lookup", () => {
  it("400 when phone or clinicId missing", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ phone: "+1" }))).status).toBe(400);
    expect((await POST(req({ clinicId: "x" }))).status).toBe(400);
  });

  it("cache hit (force=false) → returns cached row, no Twilio call", async () => {
    queryOneMock.mockResolvedValueOnce({
      valid: true, line_type: "mobile", carrier: "Verizon",
      country_code: "US", looked_up_at: "2026-04-25T00:00:00Z",
    });
    const res = await POST(req({ phone: "+15551234567", clinicId: "acme-dental" }));
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(lookupPhoneMock).not.toHaveBeenCalled();
  });

  it("cache miss → calls Twilio with KV creds + caches result", async () => {
    queryOneMock.mockResolvedValueOnce(null); // no cache
    queryOneMock.mockResolvedValueOnce({ slug: "acme-dental" }); // clinic row not used because slug is passed directly; this won't be hit
    getKVMock.mockImplementation(async (_ns, key) => {
      if (key === "twilio_sid") return "AC123";
      if (key === "twilio_from_number") return "+17406606649";
      return null;
    });
    getClinicTwilioAuthMock.mockResolvedValueOnce("auth-token");
    lookupPhoneMock.mockResolvedValueOnce({
      valid: true, lineType: "mobile", carrier: "Verizon", countryCode: "US", raw: {},
    });

    const res = await POST(req({ phone: "+15551234567", clinicId: "acme-dental" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.valid).toBe(true);
    expect(lookupPhoneMock).toHaveBeenCalledTimes(1);
    // Twilio was called with creds resolved from KV (NOT from a clinics column)
    const callArgs = lookupPhoneMock.mock.calls[0][1] as { sid: string };
    expect(callArgs.sid).toBe("AC123");
  });

  it("clinicId can be a UUID — falls back to flowcore.clinics lookup for the slug", async () => {
    queryOneMock.mockResolvedValueOnce(null); // no cache
    queryOneMock.mockResolvedValueOnce({ slug: "acme-dental" }); // UUID → slug lookup
    getKVMock.mockImplementation(async (_ns, key) => {
      if (key === "twilio_sid") return "AC123";
      if (key === "twilio_from_number") return "+17406606649";
      return null;
    });
    getClinicTwilioAuthMock.mockResolvedValueOnce("auth-token");
    lookupPhoneMock.mockResolvedValueOnce({
      valid: true, lineType: "mobile", carrier: "Verizon", countryCode: "US", raw: {},
    });

    const res = await POST(req({ phone: "+15551234567", clinicId: "11111111-2222-3333-4444-555555555555" }));
    expect(res.status).toBe(200);
    // The 2nd queryOne call is the clinics lookup
    expect(queryOneMock).toHaveBeenCalledTimes(2);
  });

  it("no twilio_sid in KV → 400 'no Twilio credentials configured'", async () => {
    queryOneMock.mockResolvedValueOnce(null); // no cache
    getKVMock.mockResolvedValue(null); // no creds anywhere
    const res = await POST(req({ phone: "+15551234567", clinicId: "acme-dental" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Twilio credentials/);
  });

  it("Twilio error → 502", async () => {
    queryOneMock.mockResolvedValueOnce(null);
    getKVMock.mockImplementation(async (_ns, key) => {
      if (key === "twilio_sid") return "AC123";
      if (key === "twilio_from_number") return "+17406606649";
      return null;
    });
    getClinicTwilioAuthMock.mockResolvedValueOnce("auth-token");
    lookupPhoneMock.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req({ phone: "+15551234567", clinicId: "acme-dental" }));
    expect(res.status).toBe(502);
  });
});
