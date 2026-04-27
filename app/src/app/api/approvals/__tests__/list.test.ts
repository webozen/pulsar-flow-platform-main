/**
 * Unit tests for the approvals list endpoint.
 * Mocks Kestra via global fetch + the pulsar-auth + tenant-sync helpers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => Response.json({ error: (e as Error).message }, { status: 401 }),
}));
vi.mock("@/lib/tenant-sync", () => ({
  namespaceFor: (slug: string) => `dental.${slug}`,
}));

import { GET } from "../route";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

/** Default test exec — labelled as approval-card material. The
 *  `approval-queue-card: "true"` label is what the route now filters
 *  on; flowId is incidental (whatever the user-built workflow is
 *  named). Override `labels: []` to test the negative case. */
function mkExec(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "exec-1",
    namespace: "dental.acme-dental",
    flowId: "user-built-row-flow",
    state: { current: "PAUSED" },
    labels: [{ key: "approval-queue-card", value: "true" }],
    startDate: "2026-04-25T05:00:00Z",
    inputs: { row: JSON.stringify({ FName: "Sawyer", LName: "Montgomery", AptDateTime: "2026-04-27 11:30" }) },
    taskRunList: [{ id: "tr-1", taskId: "approval_gate", state: { current: "PAUSED" } }],
    ...over,
  };
}

function req(): Request {
  return new Request("http://localhost/api/approvals", { headers: { Cookie: "pulsar_jwt=x" } });
}

describe("GET /api/approvals (list)", () => {
  it("returns [] when Kestra returns no executions", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("filters by `approval-queue-card: true` label — execs missing the label are dropped", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            mkExec({ id: "row-1" }),                                                        // labelled
            mkExec({ id: "no-label", labels: [] }),                                          // unlabelled — drop
            mkExec({ id: "row-2" }),                                                        // labelled
            mkExec({ id: "wrong-value", labels: [{ key: "approval-queue-card", value: "false" }] }), // explicit false — drop
          ],
        }),
      ),
    );
    const res = await GET(req());
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((b: { executionId: string }) => b.executionId).sort()).toEqual(["row-1", "row-2"]);
  });

  it("parses inputs.row JSON into recordPreview", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [mkExec()] })));
    const res = await GET(req());
    const body = await res.json();
    expect(body[0].recordPreview).toEqual({
      FName: "Sawyer",
      LName: "Montgomery",
      AptDateTime: "2026-04-27 11:30",
    });
    expect(body[0].taskRunId).toBe("tr-1");
    expect(body[0].executionId).toBe("exec-1");
  });

  it("survives malformed inputs.row (returns null preview, no crash)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [mkExec({ inputs: { row: "not-json{{" } })] })),
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json())[0].recordPreview).toBeNull();
  });

  it("queries Kestra with the tenant-prefixed namespace and PAUSED state — NO flowId hardcode", async () => {
    // Regression guard: the route used to filter by hardcoded flowIds
    // (`apt-reminder-row`, `appointment-reminder-test-row`). It now
    // filters by the `approval-queue-card: "true"` label, so flow ids
    // are completely opaque to the route. The Kestra URL must NOT
    // pass any flowId filter.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await GET(req());
    const url = (fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("namespace=dental.acme-dental");
    expect(url).toContain("state=PAUSED");
    expect(url).not.toContain("flowId=");
  });

  it("surfaces ANY labelled flow regardless of name — works for runtime-built workflows", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        results: [
          mkExec({ id: "ex-1", flowId: "patient-reminder-recall-2025" }),
          mkExec({ id: "ex-2", flowId: "birthday-card-send-q2" }),
          mkExec({ id: "ex-3", flowId: "treatment-plan-followup", labels: [] }), // unlabelled
        ],
      })),
    );
    const body = await (await GET(req())).json();
    expect(body.map((b: { executionId: string }) => b.executionId).sort())
      .toEqual(["ex-1", "ex-2"]);
  });

  it("multi-tenant isolation: queries Kestra ONLY for the caller's namespace", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockReturnValueOnce({ slug: "beta-dental", role: "tenant_user" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await GET(req());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("namespace=dental.beta-dental");
    expect(url).not.toContain("dental.acme-dental");
  });

  it("401s when no JWT", async () => {
    const auth = await import("@/lib/pulsar-auth");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
