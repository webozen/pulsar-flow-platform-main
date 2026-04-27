/**
 * Unit tests for the outcome rollup endpoint.
 *
 * Regression guards baked in:
 *   - sentTo/sentBody must come through even when the Twilio JSON
 *     response exceeds the old 500-char slice limit.
 *   - approval_gate KILLED → "skipped" (Skip path).
 *   - any FAILED → "failed" with the deepest leaf error surfaced.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => Response.json({ error: (e as Error).message }, { status: 401 }),
}));

import { GET } from "../[id]/outcome/route";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function req(): Request {
  return new Request("http://localhost/api/approvals/EX1/outcome", {
    headers: { Cookie: "pulsar_jwt=x" },
  });
}
const params = Promise.resolve({ id: "EX1" });

function execWithTaskRuns(trs: unknown[], extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ id: "EX1", state: { current: "RUNNING" }, taskRunList: trs, ...extra }));
}

describe("GET /api/approvals/{id}/outcome", () => {
  it("404s when Kestra has no execution", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("summary=pending while approval_gate is PAUSED", async () => {
    fetchMock.mockResolvedValueOnce(execWithTaskRuns([
      { id: "g", taskId: "approval_gate", state: { current: "PAUSED" } },
    ]));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("pending");
  });

  it("summary=running while send_sms is RUNNING", async () => {
    fetchMock.mockResolvedValueOnce(execWithTaskRuns([
      { id: "g", taskId: "approval_gate", state: { current: "SUCCESS" } },
      { id: "s", taskId: "send_sms", state: { current: "RUNNING" } },
    ]));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("running");
  });

  it("summary=sent — surfaces sentTo + full sentBody (regression: previously sliced to 500 chars before parse)", async () => {
    const longBody = "Hi Sawyer, " + "blah ".repeat(200) + "Reply CONFIRM";
    const twilioResp = JSON.stringify({
      sid: "SM123",
      status: "queued",
      to: "+15198002773",
      body: longBody,
      account_sid: "AC...",
      api_version: "2010-04-01",
    });
    expect(twilioResp.length).toBeGreaterThan(500); // ensure regression bait
    fetchMock.mockResolvedValueOnce(execWithTaskRuns([
      { id: "g", taskId: "approval_gate", state: { current: "SUCCESS" } },
      {
        id: "s",
        taskId: "send_sms",
        state: { current: "SUCCESS" },
        outputs: { body: twilioResp, code: 201 },
      },
    ]));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("sent");
    expect(body.sentTo).toBe("+15198002773");
    expect(body.sentBody).toBe(longBody);
    // Detail string is now compact (just the status); the sid moved
    // to its own field so the UI can render it as a clickable pill
    // linking to Twilio's console.
    expect(body.detail).toBe("Twilio queued");
    expect(body.twilioSid).toBe("SM123");
    expect(body.twilioStatus).toBe("queued");
  });

  it("summary=skipped when execution KILLED", async () => {
    fetchMock.mockResolvedValueOnce(execWithTaskRuns(
      [{ id: "g", taskId: "approval_gate", state: { current: "KILLED" } }],
      { state: { current: "KILLED" } },
    ));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("skipped");
  });

  it("summary=failed surfaces deepest leaf error from attempts[].logs[]", async () => {
    fetchMock.mockResolvedValueOnce(execWithTaskRuns([
      { id: "g", taskId: "approval_gate", state: { current: "SUCCESS" } },
      {
        id: "s",
        taskId: "send_sms",
        state: { current: "FAILED" },
        attempts: [{
          state: { current: "FAILED" },
          logs: [{ level: "ERROR", message: "Twilio HTTP 401: bad credentials" }],
        }],
      },
    ], { state: { current: "FAILED" } }));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("failed");
    expect(body.detail).toContain("Twilio HTTP 401");
  });

  it("summary=failed folds Twilio error JSON in outputs.body when there's no log message", async () => {
    fetchMock.mockResolvedValueOnce(execWithTaskRuns([
      { id: "g", taskId: "approval_gate", state: { current: "SUCCESS" } },
      {
        id: "s",
        taskId: "send_sms",
        state: { current: "FAILED" },
        outputs: { body: JSON.stringify({ code: 21608, message: "Trial: number unverified" }) },
      },
    ]));
    const body = await (await GET(req(), { params })).json();
    expect(body.summary).toBe("failed");
    expect(body.detail).toContain("21608");
    expect(body.detail).toContain("unverified");
  });

  it("401s without JWT", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });
});
