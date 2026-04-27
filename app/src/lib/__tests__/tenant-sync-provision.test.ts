/**
 * Direct tests for the tenant-lifecycle provision/suspend/resume/delete
 * helpers. The bridge from Pulsar's TenantCreated event lands here, so a
 * regression in any of these silently breaks onboarding.
 *
 * Each helper is exercised with a mocked Kestra fetch so we don't have
 * to spin up Kestra. The tests focus on the contract observable to
 * Pulsar's automation-sync caller (return shape + which Kestra
 * endpoints get hit).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function importFresh(): Promise<typeof import("../tenant-sync")> {
  vi.resetModules();
  return await import("../tenant-sync");
}

let tmp: string;
const fetchMock = vi.fn();
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "tsync-"));
  process.env.PULSAR_FLOWS_DIR = tmp;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.PULSAR_FLOWS_DIR;
  vi.unstubAllGlobals();
});

function writeFlow(name: string, content: string) {
  writeFileSync(path.join(tmp, name), content);
}

const SAMPLE_FLOW = (id: string) =>
  `id: ${id}\nnamespace: dental\ntasks:\n  - id: x\n    type: io.kestra.plugin.core.log.Log\n    message: hi\n`;

/** Returns a fresh Response per call — `mockResolvedValue` shares the
 *  same instance, and after the first `.json()` consumes the body the
 *  next read throws "Body already used". */
function freshResponse(payload: unknown, init?: ResponseInit) {
  return () => new Response(JSON.stringify(payload), init);
}

describe("provisionTenant", () => {
  it("seeds 3 KV defaults + deploys every YAML in the flows dir", async () => {
    writeFlow("flow-a.yml", SAMPLE_FLOW("flow-a"));
    writeFlow("flow-b.yml", SAMPLE_FLOW("flow-b"));
    fetchMock.mockImplementation(freshResponse({ id: "x", revision: 1, disabled: false, tasks: [] }));
    const { provisionTenant } = await importFresh();
    const out = await provisionTenant({ slug: "acme-dental", name: "Acme Dental", modules: [] });
    expect(out.slug).toBe("acme-dental");
    expect(out.namespace).toBe("dental.acme-dental");
    expect(out.flowsDeployed.map((f) => f.id).sort()).toEqual(["flow-a", "flow-b"]);
    const kvCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/v1/namespaces/dental.acme-dental/kv/"),
    );
    expect(kvCalls.length).toBeGreaterThanOrEqual(3);
    expect(kvCalls.some((c) => String(c[0]).endsWith("/clinic_name"))).toBe(true);
    expect(kvCalls.some((c) => String(c[0]).endsWith("/timezone"))).toBe(true);
    expect(kvCalls.some((c) => String(c[0]).endsWith("/app_url"))).toBe(true);
  });

  it("rewrites `namespace: dental` → `namespace: dental.<slug>` before POSTing each YAML", async () => {
    writeFlow("flow-a.yml", SAMPLE_FLOW("flow-a"));
    fetchMock.mockImplementation(freshResponse({ id: "x", revision: 1, tasks: [] }));
    const { provisionTenant } = await importFresh();
    await provisionTenant({ slug: "acme-dental", modules: [] });
    const postFlow = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]) === "http://localhost:8080/api/v1/flows" &&
        (c[1] as RequestInit).method === "POST",
    );
    expect(postFlow, "POST /api/v1/flows must fire").toBeTruthy();
    const yaml = (postFlow![1] as RequestInit).body as string;
    expect(yaml).toContain("namespace: dental.acme-dental");
    expect(yaml).not.toMatch(/^namespace: dental$/m);
  });

  it("modules empty → all flows deployed-but-disabled (toggle to disabled=true)", async () => {
    writeFlow("flow-a.yml", SAMPLE_FLOW("flow-a"));
    fetchMock.mockImplementation(freshResponse({ id: "flow-a", revision: 1, disabled: false, tasks: [] }));
    const { provisionTenant } = await importFresh();
    const out = await provisionTenant({ slug: "acme-dental", modules: [] });
    expect(out.flowsDeployed[0].disabled).toBe(true);
  });

  it("collects per-flow errors instead of throwing the whole provision", async () => {
    writeFlow("good.yml", SAMPLE_FLOW("good"));
    writeFlow("bad.yml", SAMPLE_FLOW("bad"));
    // readdirSync doesn't guarantee order — the iteration is alphabetical
    // on macOS and most Linux ext4. Use a URL-aware mock that fails the
    // POST /flows when the YAML body says `id: bad`, and succeeds for
    // anything else. Then the test result is independent of file order.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST" && u === "http://localhost:8080/api/v1/flows") {
        const body = String(init.body ?? "");
        if (body.includes("id: bad")) return new Response("kaboom", { status: 500 });
        return new Response(JSON.stringify({ id: "good", revision: 1 }));
      }
      // GET /flows/{ns}/{id} → return a stub flow object for toggle.
      if (u.match(/\/api\/v1\/flows\/[^/]+\/[^/]+$/) && (!init || !init.method || init.method === "GET")) {
        return new Response(JSON.stringify({ id: "good", disabled: false, tasks: [] }));
      }
      // PUT toggle, KV writes — empty 200/204.
      return new Response(null, { status: 204 });
    });
    const { provisionTenant } = await importFresh();
    const out = await provisionTenant({ slug: "acme-dental", modules: [] });
    expect(out.flowsDeployed.map((f) => f.id)).toEqual(["good"]);
    expect(out.errors.map((e) => e.id)).toEqual(["bad"]);
    expect(out.errors[0].error).toContain("500");
  });
});

describe("suspendTenant", () => {
  it("disables every flow currently in the namespace", async () => {
    fetchMock
      // Kestra /flows/search returns { results: [...] }, not a bare array.
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "f1" }, { id: "f2" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f1", disabled: false, tasks: [] }))) // getFlow f1
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f1", disabled: true }))) // PUT toggle
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f2", disabled: false, tasks: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f2", disabled: true })));
    const { suspendTenant } = await importFresh();
    const out = await suspendTenant("acme-dental");
    expect(out.suspendedFlows).toEqual(["f1", "f2"]);
  });
});

describe("deleteTenant", () => {
  it("deletes every flow from the tenant's namespace", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "f1" }, { id: "f2" }] }))) // listFlows
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // deleteFlow f1
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // deleteFlow f2
    const { deleteTenant } = await importFresh();
    const out = await deleteTenant("acme-dental");
    expect(out.deletedFlows).toEqual(["f1", "f2"]);
    const deleteCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit).method === "DELETE" && String(c[0]).includes("/api/v1/flows/"),
    );
    expect(deleteCalls).toHaveLength(2);
  });
});

describe("pushTenantSecrets", () => {
  it("writes each secret as KV (Kestra OSS doesn't have /secrets) — keys are lowercased", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { pushTenantSecrets } = await importFresh();
    const out = await pushTenantSecrets("acme-dental", {
      Twilio_Sid: "AC123",
      OPENDENTAL_DEVELOPER_KEY: "dev",
    });
    expect(out.written.sort()).toEqual(["opendental_developer_key", "twilio_sid"]);
    const kvCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/v1/namespaces/dental.acme-dental/kv/"),
    );
    expect(kvCalls.some((c) => String(c[0]).endsWith("/twilio_sid"))).toBe(true);
    expect(kvCalls.some((c) => String(c[0]).endsWith("/opendental_developer_key"))).toBe(true);
    // Defensive: never an uppercase variant
    expect(kvCalls.some((c) => String(c[0]).endsWith("/Twilio_Sid"))).toBe(false);
  });

  it("partial failures are reported per-key, not thrown", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // first ok
      .mockResolvedValueOnce(new Response("bad", { status: 500 })); // second fails
    const { pushTenantSecrets } = await importFresh();
    const out = await pushTenantSecrets("acme-dental", { a: "1", b: "2" });
    expect(out.written).toHaveLength(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].error).toMatch(/KV/);
  });
});
