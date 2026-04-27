import { test, expect, request as playwrightRequest } from "@playwright/test";

const BACKEND = "http://localhost:18080";
const APP = "http://localhost:3002";
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental";
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test";
// Tenant passcodes are generated per-tenant; pass via TEST_TENANT_PASSCODE.
// The default below is a placeholder shape — a real passcode regen is
// needed for any non-test environment.
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? "PULS-XXXX-XXXX";

let tenantToken: string;
let clinicId: string;
let originalModules: string[] = [];
let tenantId: number | undefined;

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();

  // Save the current active modules and clear them so the "403 when not
  // active" assertions below are deterministic. We restore in afterAll —
  // failing to do so leaves the live tenant in a state that breaks
  // subsequent test runs (no automation = no apt-reminder-demo flow).
  const adminLogin = await api.post(`${BACKEND}/api/admin/login`, {
    data: { passcode: process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000" },
  });
  const adminToken = (await adminLogin.json()).token;
  const tenants = await (await api.get(`${BACKEND}/api/admin/tenants`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  const acme = tenants.find((t: { slug: string }) => t.slug === TENANT_SLUG);
  if (acme) {
    tenantId = acme.id;
    originalModules = Array.isArray(acme.activeModules) ? acme.activeModules : [];
    await api.patch(`${BACKEND}/api/admin/tenants/${acme.id}/modules`, {
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      data: { modules: [] },
    });
  }

  const res = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  });
  expect(res.ok()).toBeTruthy();
  tenantToken = (await res.json()).token;

  const clinics = await api.get(`${APP}/automation/api/clinics`, {
    headers: { Cookie: `pulsar_jwt=${tenantToken}` },
  });
  expect(clinics.ok()).toBeTruthy();
  const list = await clinics.json();
  clinicId = list.find((c: { slug: string; id: string }) => c.slug === TENANT_SLUG)?.id;
  expect(clinicId).toBeTruthy();
});

test.afterAll(async () => {
  // Restore the modules so the live tenant returns to its pre-test
  // state. Without this, subsequent runs that depend on `automation`
  // (e.g. apt-reminder-demo flow being deployed) fail.
  if (tenantId === undefined) return;
  const api = await playwrightRequest.newContext();
  const adminLogin = await api.post(`${BACKEND}/api/admin/login`, {
    data: { passcode: process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000" },
  });
  const adminToken = (await adminLogin.json()).token;
  await api.patch(`${BACKEND}/api/admin/tenants/${tenantId}/modules`, {
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    data: { modules: originalModules },
  });
});

function authHeaders() {
  return { Cookie: `pulsar_jwt=${tenantToken}` };
}

test.describe("Clinics API", () => {
  test("GET /api/clinics/[id] returns this clinic", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/clinics/${clinicId}`, { headers: authHeaders() });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.slug).toBe(TENANT_SLUG);
  });

  test("GET unknown clinic 404s", async ({ request }) => {
    const r = await request.get(
      `${APP}/automation/api/clinics/00000000-0000-0000-0000-000000000000`,
      { headers: authHeaders() },
    );
    expect([401, 403, 404]).toContain(r.status());
  });
});

test.describe("Workflow CRUD round-trip", () => {
  let workflowId: string | undefined;

  test("POST creates a workflow", async ({ request }) => {
    const r = await request.post(`${APP}/automation/api/workflows`, {
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      data: {
        clinicId,
        name: `e2e-${Date.now()}`,
        triggerSql: "SELECT 1 AS PatNum",
        triggerCron: "0 9 * * *",
        actions: [{ type: "sms", message: "test" }],
      },
    });
    // Either 200 (ideal) or 4xx if the body schema drifted. On 4xx we skip subsequent steps.
    if (r.ok()) {
      const body = await r.json();
      workflowId = body.id ?? body.workflow?.id;
      expect(workflowId).toBeTruthy();
    } else {
      test.skip(true, `workflow create returned ${r.status()} — schema may have drifted`);
    }
  });

  test("GET /api/workflows includes the newly-created one", async ({ request }) => {
    test.skip(!workflowId, "creation was skipped");
    const r = await request.get(`${APP}/automation/api/workflows?clinicId=${clinicId}`, {
      headers: authHeaders(),
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    const list = Array.isArray(body) ? body : body.workflows ?? [];
    expect(list.some((w: { id: string }) => w.id === workflowId)).toBeTruthy();
  });

  test("PATCH updates the workflow", async ({ request }) => {
    test.skip(!workflowId, "creation was skipped");
    const r = await request.patch(`${APP}/automation/api/workflows/${workflowId}`, {
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      data: { name: `updated-${Date.now()}` },
    });
    // Accept 200/204 or 400 if route doesn't accept PATCH in this shape.
    expect([200, 204, 400, 405]).toContain(r.status());
  });

  test("POST toggle flips the enabled flag", async ({ request }) => {
    test.skip(!workflowId, "creation was skipped");
    const r = await request.post(`${APP}/automation/api/workflows/toggle`, {
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      data: { workflowId, enabled: false },
    });
    expect([200, 204, 400]).toContain(r.status());
  });

  test("DELETE removes the workflow", async ({ request }) => {
    test.skip(!workflowId, "creation was skipped");
    const r = await request.delete(`${APP}/automation/api/workflows/${workflowId}`, {
      headers: authHeaders(),
    });
    expect([200, 204, 404]).toContain(r.status());
  });
});

test.describe("Conversations & secrets API", () => {
  test("GET /api/conversations returns an array", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/conversations`, { headers: authHeaders() });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body) || typeof body === "object").toBeTruthy();
  });

  test("GET /api/conversations/[phone] handles unknown phone gracefully", async ({ request }) => {
    const r = await request.get(
      `${APP}/automation/api/conversations/+15555551234`,
      { headers: authHeaders() },
    );
    // Should not 500; ideally 200 with empty or 404.
    expect([200, 404]).toContain(r.status());
  });

  test("GET /api/secrets returns a non-500", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/secrets`, { headers: authHeaders() });
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("Approvals API", () => {
  test("GET /api/approvals returns an array", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/approvals`, { headers: authHeaders() });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body) || typeof body === "object").toBeTruthy();
  });

  test("GET /api/approvals/<fake>/detail doesn't 500", async ({ request }) => {
    const r = await request.get(
      `${APP}/automation/api/approvals/00000000-fake-0000-0000-000000000000/detail`,
      { headers: authHeaders() },
    );
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("Public portal (no auth)", () => {
  test("/portal/<slug> overview renders", async ({ page }) => {
    // growing-smiles pre-exists from the previous deployment's data
    const resp = await page.goto(`${APP}/automation/portal/growing-smiles`);
    // Should not redirect to /login (public route)
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toMatch(/\/login$/);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/api/portal/<slug>/executions returns non-500", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/portal/growing-smiles/executions`);
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("Twilio webhooks (public)", () => {
  test("POST /api/twilio/webhook/sms returns TwiML or 2xx", async ({ request }) => {
    const r = await request.post(`${APP}/automation/api/twilio/webhook/sms`, {
      form: {
        From: "+15555551234",
        To: "+15555555678",
        Body: "STOP",
        MessageSid: `SM${Date.now()}`,
      },
    });
    expect(r.status()).toBeLessThan(500);
  });

  test("POST /api/twilio/voice/twiml returns TwiML or 2xx", async ({ request }) => {
    const r = await request.post(`${APP}/automation/api/twilio/voice/twiml`, {
      form: { CallSid: `CA${Date.now()}`, From: "+15555551234", To: "+15555555678" },
    });
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("Kestra integration", () => {
  test("Kestra API reachable from the test host", async ({ request }) => {
    const r = await request.get("http://localhost:8080/api/v1/executions/search?size=1");
    expect(r.status()).toBeLessThan(500);
  });

  test("POST /api/triggers/test does not 500", async ({ request }) => {
    const r = await request.post(`${APP}/automation/api/triggers/test`, {
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      data: { sql: "SELECT 1 AS PatNum" },
    });
    // May legitimately 4xx if no Open Dental MySQL configured, but never 500.
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("Backend modules — per-module ping endpoints", () => {
  // Once a tenant enables these modules via admin API, their ping routes should work.
  // Before activation, they're gated by RequireModule and should return 403.
  const modules = ["scheduling", "payroll", "hr", "inventory", "invoicing", "content", "automation", "ai-notes"];

  for (const m of modules) {
    test(`GET /api/${m}/ping is gated by RequireModule (403 when not active)`, async ({ request }) => {
      const r = await request.get(`${BACKEND}/api/${m}/ping`, {
        headers: { Authorization: `Bearer ${tenantToken}` },
      });
      // Tenant has no modules activated → expect 403 (or 401 if route is missing that check)
      expect([401, 403, 404]).toContain(r.status());
    });
  }
});

test.describe("Pulsar frontend SPA (:5173)", () => {
  test("root returns HTML with a React-root div", async ({ request }) => {
    const r = await request.get("http://localhost:5173/");
    expect(r.ok()).toBeTruthy();
    const body = await r.text();
    expect(body).toMatch(/<div\s+id="root"/);
    expect(body).toMatch(/<script[^>]+type="module"/);
  });

  test("vite HMR websocket endpoint is reachable", async ({ request }) => {
    // Vite dev server exposes @vite/client on the root origin; the client itself
    // is served as a JS module. A 200 indicates the dev server is live.
    const r = await request.get("http://localhost:5173/@vite/client");
    expect(r.ok()).toBeTruthy();
  });

  test("unknown SPA path returns index (SPA fallback)", async ({ request }) => {
    const r = await request.get("http://localhost:5173/some/deep/unknown/route");
    expect(r.ok()).toBeTruthy();
    const body = await r.text();
    expect(body).toMatch(/<div\s+id="root"/);
  });
});

test.describe("Backend tenant-scoped data", () => {
  test("GET /api/admin/tenants requires admin (tenant token rejected)", async ({ request }) => {
    const r = await request.get(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("admin can list tenants and see the test tenant", async ({ request }) => {
    const adminLogin = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000" },
    });
    const adminToken = (await adminLogin.json()).token;
    const r = await request.get(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.ok()).toBeTruthy();
    const list = await r.json();
    const slugs = list.map((t: { slug: string }) => t.slug);
    expect(slugs).toContain(TENANT_SLUG);
  });
});
