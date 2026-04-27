/**
 * Regression guards for the Kestra KV `getKV` helper.
 *
 * Kestra OSS 0.19's KV REST API returns a TYPED ENVELOPE
 * (`{"type":"STRING","value":"..."}`), not the raw value. The earlier
 * implementation assumed a JSON-quoted string and silently returned
 * the envelope JSON as the "value", which then got passed to
 * downstream HTTP auth headers verbatim — OpenDental + Twilio rejected
 * those calls as "Invalid API key(s)." This test pins the unwrap
 * behaviour so that drift gets caught at PR time, not on a customer
 * call.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { getKV } from "../kestra";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function envelope(type: string, value: unknown) {
  return new Response(JSON.stringify({ type, value }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("getKV (Kestra KV envelope unwrap)", () => {
  it("STRING envelope → returns inner value (regression: previously returned the JSON wrapper)", async () => {
    fetchMock.mockResolvedValueOnce(envelope("STRING", "test-od-developer-key"));
    const v = await getKV("dental.acme-dental", "opendental_developer_key");
    expect(v).toBe("test-od-developer-key");
  });

  it("NUMBER envelope → returns the value coerced to string", async () => {
    fetchMock.mockResolvedValueOnce(envelope("NUMBER", 587));
    const v = await getKV("dental.acme-dental", "smtp_port");
    expect(v).toBe("587");
  });

  it("BOOLEAN envelope → returns 'true' / 'false' string", async () => {
    fetchMock.mockResolvedValueOnce(envelope("BOOLEAN", true));
    expect(await getKV("ns", "k")).toBe("true");
  });

  it("404 → returns null (key not set)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await getKV("ns", "missing")).toBeNull();
  });

  it("non-2xx (other than 404) throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(getKV("ns", "k")).rejects.toThrow(/KV get error 500/);
  });

  it("legacy bare JSON-quoted string → still unwrapped (forward-compat with older Kestra)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify("plain-string"), {
      headers: { "Content-Type": "application/json" },
    }));
    expect(await getKV("ns", "k")).toBe("plain-string");
  });

  it("envelope value is null → returns null (Kestra represents 'cleared' this way)", async () => {
    fetchMock.mockResolvedValueOnce(envelope("STRING", null));
    expect(await getKV("ns", "k")).toBeNull();
  });
});
