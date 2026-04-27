/**
 * Unit tests for the per-execution logs endpoint. Just a thin
 * pass-through to Kestra now that each row execution is independent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => Response.json({ error: (e as Error).message }, { status: 401 }),
}));

import { GET } from "../[id]/logs/route";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function req(qs = ""): Request {
  return new Request(`http://localhost/api/approvals/EX/logs${qs}`, {
    headers: { Cookie: "pulsar_jwt=x" },
  });
}
const params = Promise.resolve({ id: "EX" });

describe("GET /api/approvals/{id}/logs", () => {
  it("returns the lines from Kestra with normalised shape", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "EX", flowId: "apt-reminder-row" })))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { taskId: "send_sms", taskRunId: "tr-x", level: "INFO",  message: "POST 200 OK", timestamp: "2026-04-25T05:00:00Z", attemptNumber: 0 },
        { taskId: "send_sms", taskRunId: "tr-x", level: "ERROR", message: "Twilio 401 unauth",                           timestamp: "2026-04-25T05:00:01Z", attemptNumber: 0 },
      ])));
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flowId).toBe("apt-reminder-row");
    expect(body.lines).toHaveLength(2);
    expect(body.lines[1]).toMatchObject({ level: "ERROR", taskId: "send_sms", message: "Twilio 401 unauth" });
  });

  it("respects ?minLevel= when calling Kestra", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "EX" })))
      .mockResolvedValueOnce(new Response("[]", { headers: { "Content-Type": "application/json" } }));
    await GET(req("?minLevel=ERROR"), { params });
    const logsUrl = fetchMock.mock.calls[1][0] as string;
    expect(logsUrl).toContain("minLevel=ERROR");
  });

  it("404 when execution missing", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response("[]"));
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("502 when execution exists but logs endpoint fails", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "EX" })))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const res = await GET(req(), { params });
    expect(res.status).toBe(502);
  });

  it("401 without JWT", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });
});
