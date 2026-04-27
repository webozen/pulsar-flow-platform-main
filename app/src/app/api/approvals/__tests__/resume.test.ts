/**
 * Unit tests for the resume/skip endpoint.
 *
 * Critical regression: the route must NOT send any `taskRunId` to
 * Kestra (Kestra OSS 0.19's per-task scoping is broken). Tests
 * assert the request URLs/bodies against fetch spies.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", email: "ops@acme.test", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => {
    const isAuth = e instanceof Error && e.message === "Unauthorized";
    return Response.json({ error: (e as Error).message }, { status: isAuth ? 401 : 500 });
  },
}));
// DB mocks: audit insert + initDb.
const { dbQueryMock, initDbMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(async () => []),
  initDbMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  query: dbQueryMock,
  initDb: initDbMock,
}));

import { POST } from "../[id]/resume/route";
import { _resetRateLimitState } from "@/lib/rate-limit";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  dbQueryMock.mockReset();
  dbQueryMock.mockResolvedValue([]);
  initDbMock.mockReset();
  initDbMock.mockResolvedValue(undefined);
  _resetRateLimitState();
  vi.stubGlobal("fetch", fetchMock);
});

function req(body: unknown): Request {
  return new Request("http://localhost/api/approvals/EXEC123/resume", {
    method: "POST",
    headers: { Cookie: "pulsar_jwt=x", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "EXEC123" });

describe("POST /api/approvals/{id}/resume", () => {
  it("approve: POSTs Kestra /resume with NO taskRunId in URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await POST(req({}), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "resume" });
    const url = fetchMock.mock.calls[0][0] as string;
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toMatch(/\/api\/v1\/executions\/EXEC123\/resume$/);
    expect(url).not.toContain("taskRunId");
    expect(url).not.toContain("?");
    expect(opts.method).toBe("POST");
    expect(typeof opts.body).toBe("string");
    expect(opts.body as string).not.toContain("taskRunId");
  });

  it("skip: DELETEs Kestra /kill with NO taskRunId", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    const res = await POST(req({ action: "kill" }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "kill" });
    const url = fetchMock.mock.calls[0][0] as string;
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toMatch(/\/api\/v1\/executions\/EXEC123\/kill$/);
    expect(url).not.toContain("taskRunId");
    expect(opts.method).toBe("DELETE");
  });

  it("propagates Kestra failure as 500", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await POST(req({}), { params });
    expect(res.status).toBe(500);
  });

  it("401s without JWT", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const res = await POST(req({}), { params });
    expect(res.status).toBe(401);
  });

  it("approve with empty body still resumes (no JSON parse crash)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const r = new Request("http://localhost/api/approvals/EXEC123/resume", {
      method: "POST",
      headers: { Cookie: "pulsar_jwt=x" },
    });
    const res = await POST(r, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("resume");
  });

  // The query() helper takes (sql, params?) — vi.fn() infers `[]` for
  // its args, so we cast through unknown[] when reading positional
  // parameters off the recorded call.
  function findAuditCall(): unknown[] {
    const calls = dbQueryMock.mock.calls as unknown as Array<unknown[]>;
    const found = calls.find((c) => String(c[0]).includes("INSERT INTO flowcore.approval_audit"));
    if (!found) throw new Error("audit insert was not called");
    return found[1] as unknown[];
  }

  it("writes an approval_audit row with actor + action + execution + payload", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await POST(req({ payload: { patient: "Sawyer", apt: "2026-04-27 11:30" } }), { params });
    const p = findAuditCall();
    expect(p[0]).toBe("acme-dental");      // slug
    expect(p[1]).toBe("ops@acme.test");    // actor_email
    expect(p[2]).toBe("tenant_user");      // actor_role
    expect(p[3]).toBe("resume");           // action
    expect(p[4]).toBe("EXEC123");          // execution_id
    expect(p[5]).toContain("Sawyer");      // payload (jsonb stringified) — 6th positional ($6, index 5)
  });

  it("audit row records 'kill' for Skip", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await POST(req({ action: "kill" }), { params });
    expect(findAuditCall()[3]).toBe("kill");
  });

  it("audit-insert failure does NOT break the user's approve flow", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    dbQueryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(req({}), { params });
    expect(res.status).toBe(200); // user still sees success
  });

  it("rate-limited: same exec hammered 11x in a tick → 429 with Retry-After", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    // First 10 succeed (burst).
    for (let i = 0; i < 10; i++) {
      const r = await POST(req({}), { params });
      expect(r.status, `call ${i + 1} should succeed`).toBe(200);
    }
    // 11th hits the limit.
    const denied = await POST(req({}), { params });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBeTruthy();
    const body = await denied.json();
    expect(body.error).toBe("rate_limited");
  });
});
