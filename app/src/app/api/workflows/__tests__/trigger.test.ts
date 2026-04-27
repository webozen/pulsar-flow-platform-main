/**
 * Unit tests for POST /api/workflows/{id}/trigger.
 *
 * Regression guards baked in:
 *   - Route must NOT touch `flowcore.clinics.kestra_namespace` (dropped
 *     in Phase 2). Earlier code SELECTed that column, throwing
 *     "column does not exist" at runtime → "internal error" toast in
 *     the UI. The test below pins the `WHERE id = $1` query against
 *     `flowcore.workflows` only — no clinics join.
 *   - Both id forms must resolve: a `flowcore.workflows` UUID (custom
 *     builder flow) AND a Kestra flowId string (platform-managed flow
 *     like `appointment-reminder-test` that never gets a builder row).
 *   - Namespace must be derived from the JWT slug, not from any DB
 *     column (Plan B identity model).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => {
    const isAuth = e instanceof Error && e.message === "Unauthorized";
    return Response.json({ error: (e as Error).message }, { status: isAuth ? 401 : 500 });
  },
}));

// `initDb` is a no-op for the test (we mock the pool). `query` is the
// pg helper the route uses; we stub it to control what comes back.
vi.mock("@/lib/db", () => ({
  initDb: vi.fn(async () => {}),
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { POST } from "../[id]/trigger/route";
import { queryOne } from "@/lib/db";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (queryOne as ReturnType<typeof vi.fn>).mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function req(): Request {
  return new Request("http://localhost/api/workflows/X/trigger", {
    method: "POST",
    headers: { Cookie: "pulsar_jwt=x" },
  });
}

describe("POST /api/workflows/{id}/trigger", () => {
  it("platform-managed flow id (no builder row) → uses id as flowId, namespace from JWT slug", async () => {
    (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "exec-1", state: { current: "CREATED" } })),
    );
    const res = await POST(req(), { params: Promise.resolve({ id: "appointment-reminder-test" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flowId).toBe("appointment-reminder-test");
    expect(body.namespace).toBe("dental.acme-dental");
    expect(body.executionId).toBe("exec-1");
    // Critically: the trigger URL must hit the JWT-derived namespace,
    // NOT a DB-resolved one.
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/executions/dental.acme-dental/appointment-reminder-test");
  });

  it("custom builder flow (UUID id) → looks up name + slugifies to flowId", async () => {
    (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ name: "Recall Reminder Daily" });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "exec-2" })),
    );
    const res = await POST(req(), {
      params: Promise.resolve({ id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flowId).toBe("recall-reminder-daily");
    expect(body.namespace).toBe("dental.acme-dental");
  });

  it("regression: route never references the dropped kestra_namespace column", async () => {
    (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "exec" })));
    await POST(req(), { params: Promise.resolve({ id: "x" }) });
    const sqlCalls = (queryOne as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]));
    for (const sql of sqlCalls) {
      expect(sql).not.toContain("kestra_namespace");
      expect(sql).not.toContain("flowcore.clinics");
    }
  });

  it("Kestra trigger failure surfaces as 500", async () => {
    (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(new Response("kaboom", { status: 500 }));
    const res = await POST(req(), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(500);
  });

  it("401 without JWT", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const res = await POST(req(), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });
});
