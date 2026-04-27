/**
 * Unit tests for the per-execution detail endpoint and the inline
 * resolveTemplate helper. Two roles:
 *   1. Verify the route reads `inputs.row` (post-Subflow architecture).
 *   2. Pin every Pebble form `resolveTemplate` is responsible for —
 *      drift here is what produced the literal `{{ … }}` text in the
 *      SMS preview.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pulsar-auth", () => ({
  requireAuth: vi.fn(() => ({ slug: "acme-dental", role: "tenant_user" })),
  authErrorResponse: (e: unknown) => Response.json({ error: (e as Error).message }, { status: 401 }),
}));

import { GET, resolveTemplate } from "../[id]/detail/route";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function req(): Request {
  return new Request("http://localhost/api/approvals/EX/detail", {
    headers: { Cookie: "pulsar_jwt=x" },
  });
}
const params = Promise.resolve({ id: "EX" });

const ROW = { FName: "Sawyer", LName: "Montgomery", AptDateTime: "2026-04-27 11:30", WirelessPhone: "(519)555-0100" };

const flowDef = {
  tasks: [
    { id: "approval_gate", type: "io.kestra.plugin.core.flow.Pause" },
    {
      id: "send_sms",
      type: "io.kestra.plugin.core.http.Request",
      uri: "https://api.twilio.com/Accounts/x/Messages.json",
      body: "To=%2B15198002773&Body=Hi+{{ fromJson(inputs.row).FName }},+appt+{{ fromJson(inputs.row).AptDateTime }},+from+{{ kv('clinic_name') }}",
    },
  ],
};

describe("resolveTemplate helper", () => {
  it("resolves fromJson(inputs.row).FIELD", () => {
    expect(resolveTemplate("Hi {{ fromJson(inputs.row).FName }}", ROW)).toBe("Hi Sawyer");
  });
  it("resolves inputs.row.FIELD", () => {
    expect(resolveTemplate("{{ inputs.row.LName }}", ROW)).toBe("Montgomery");
  });
  it("resolves fromJson(parents[0].taskrun.value).FIELD (legacy form)", () => {
    expect(resolveTemplate("Hi {{ fromJson(parents[0].taskrun.value).FName }}", ROW)).toBe("Hi Sawyer");
  });
  it("resolves taskrun.value.FIELD (legacy form)", () => {
    expect(resolveTemplate("{{ taskrun.value.FName }}", ROW)).toBe("Sawyer");
  });
  it("resolves inputs.record.FIELD (legacy form)", () => {
    expect(resolveTemplate("{{ inputs.record.FName }}", ROW)).toBe("Sawyer");
  });
  it("leaves kv('x') as a [x] placeholder", () => {
    expect(resolveTemplate("from {{ kv('clinic_name') }}", ROW)).toBe("from [clinic_name]");
  });
  it("substitutes [field] placeholder when record has no key", () => {
    expect(resolveTemplate("{{ inputs.row.MissingKey }}", ROW)).toBe("[MissingKey]");
  });
});

describe("GET /api/approvals/{id}/detail", () => {
  it("404 when Kestra has no execution", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("parses inputs.row JSON into recordData and resolves SMS preview", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "EX",
        flowId: "apt-reminder-row",
        namespace: "dental.acme-dental",
        state: { current: "PAUSED" },
        labels: [],
        inputs: { row: JSON.stringify(ROW) },
        taskRunList: [{ taskId: "approval_gate", state: { current: "PAUSED" } }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(flowDef)));
    const res = await GET(req(), { params });
    const body = await res.json();
    expect(body.recordData).toEqual(ROW);
    const sms = body.actionPreviews.find((a: { type: string }) => a.type === "sms");
    expect(sms).toBeTruthy();
    expect(sms.details.message).toContain("Hi Sawyer");
    expect(sms.details.message).toContain("2026-04-27 11:30");
    expect(sms.details.message).toContain("[clinic_name]");
    expect(sms.details.to).toBe("+15198002773");
  });

  it("survives missing inputs.row (recordData null, no crash)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "EX", flowId: "apt-reminder-row", namespace: "dental.acme-dental",
        state: { current: "PAUSED" }, labels: [], inputs: {}, taskRunList: [],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(flowDef)));
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).recordData).toBeNull();
  });

  it("returns empty actionPreviews when flow definition fetch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "EX", flowId: "apt-reminder-row", namespace: "dental.acme-dental",
        state: { current: "PAUSED" }, labels: [], inputs: { row: JSON.stringify(ROW) },
        taskRunList: [],
      })))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const body = await (await GET(req(), { params })).json();
    expect(body.actionPreviews).toEqual([]);
  });
});
