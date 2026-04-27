/**
 * Tests for the inbound Twilio Voice digit-gather webhook.
 *
 * Twilio posts here after a caller presses a digit on an outbound IVR
 * call. We update the voice_calls row, fire a Kestra webhook so the
 * tenant's flow can branch, and return TwiML to play an
 * acknowledgement. Routing is again `twilio_from_number → slug` (same
 * pattern as the SMS webhook); namespace is derived from the slug.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: queryMock, queryOne: queryOneMock }));

import { POST } from "../route";

const fetchMock = vi.fn();
beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function form(data: Record<string, string>): Request {
  const body = new URLSearchParams(data);
  return new Request("http://localhost/api/twilio/voice/gather", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("POST /api/twilio/voice/gather", () => {
  it("digit 1 (confirm) → updates voice_calls row + fires kestra webhook + returns confirmation TwiML", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await POST(form({ Digits: "1", CallSid: "CA1", From: "+15551234567", To: "+17406606649" }));
    const xml = await res.text();
    expect(xml).toContain("confirmed");
    // voice_calls UPDATE was called with the digit
    const updateCall = queryMock.mock.calls.find((c) => String(c[0]).includes("UPDATE flowcore.voice_calls"));
    expect(updateCall).toBeTruthy();
    expect((updateCall![1] as unknown[])[0]).toBe("1"); // response_digit
    expect((updateCall![1] as unknown[])[1]).toBe("CA1"); // twilio_sid
  });

  it("digit 2 (reschedule) → reschedule TwiML; digit 3 (transfer) → connect TwiML", async () => {
    queryOneMock.mockResolvedValue({ id: "clinic-uuid", slug: "acme-dental" });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res2 = await POST(form({ Digits: "2", CallSid: "CA2", From: "+15551234567", To: "+17406606649" }));
    expect(await res2.text()).toContain("reschedule");
    const res3 = await POST(form({ Digits: "3", CallSid: "CA3", From: "+15551234567", To: "+17406606649" }));
    expect(await res3.text()).toContain("connect");
  });

  it("namespace for the kestra voice-response webhook is derived from the slug, NOT a kestra_namespace column", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "beta-dental" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await POST(form({ Digits: "1", CallSid: "CA4", From: "+1", To: "+2" }));
    const kestraCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/voice-response/voice-response"));
    expect(String(kestraCall![0])).toContain("/dental.beta-dental/");
  });

  it("unknown To number → updates voice_calls but skips the kestra trigger", async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const res = await POST(form({ Digits: "1", CallSid: "CA5", From: "+1", To: "+99999" }));
    expect(res.status).toBe(200);
    // voice_calls update still happens (we have the CallSid)
    expect(queryMock).toHaveBeenCalled();
    // No kestra fetch should have fired
    const kestraCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("voice-response"));
    expect(kestraCall).toBeUndefined();
  });
});
