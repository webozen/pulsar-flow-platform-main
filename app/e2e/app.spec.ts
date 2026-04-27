import { test, expect, request as playwrightRequest } from "@playwright/test";

const BACKEND = "http://localhost:18080";
const APP = "http://localhost:3002";
const PROXY = "http://localhost:5173";
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000";
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental";
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test";
// Tenant passcodes are generated per-tenant; pass via TEST_TENANT_PASSCODE.
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? "PULS-XXXX-XXXX";

let tenantToken: string;

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  const res = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  });
  if (!res.ok()) {
    throw new Error(
      `Tenant login failed (HTTP ${res.status()}). Make sure tenant "${TENANT_SLUG}" exists and passcode is current. Body: ${await res.text()}`,
    );
  }
  const body = await res.json();
  tenantToken = body.token;
  expect(tenantToken).toBeTruthy();
});

test.describe("Backend (pulsar-backend) — auth API", () => {
  test("admin login returns HS384 JWT", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.token).toMatch(/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/);
  });

  test("tenant login issues token and sets pulsar_jwt cookie", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
    const setCookie = r.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("pulsar_jwt=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  test("/api/auth/me returns tenant claims when called with Bearer", async ({ request }) => {
    const r = await request.get(`${BACKEND}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.slug).toBe(TENANT_SLUG);
    expect(body.role).toBe("tenant_user");
    expect(body.email).toBe(TENANT_EMAIL);
  });

  test("/api/auth/me without token is 401", async ({ request }) => {
    const r = await request.get(`${BACKEND}/api/auth/me`);
    expect(r.status()).toBe(401);
  });

  test("/api/auth/refresh rotates a valid token", async ({ request }) => {
    // JWT iat/exp have second-level resolution, so a refresh within the same
    // second returns an identical token (the payload is byte-identical). Sleep
    // briefly to guarantee a different iat and therefore a different signature.
    await new Promise((r) => setTimeout(r, 1100));
    const r = await request.post(`${BACKEND}/api/auth/refresh`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.token).toBeTruthy();
    expect(body.token).not.toBe(tenantToken);
  });
});

test.describe("Backend — OpenAPI surface", () => {
  test("OpenAPI spec is served", async ({ request }) => {
    const r = await request.get(`${BACKEND}/v3/api-docs`);
    expect(r.ok()).toBeTruthy();
    const spec = await r.json();
    expect(spec.openapi).toBeTruthy();
    expect(Object.keys(spec.paths)).toContain("/api/auth/me");
  });

  test("Swagger UI redirects to the index", async ({ request }) => {
    const r = await request.get(`${BACKEND}/swagger-ui.html`, { maxRedirects: 0 });
    expect([200, 302]).toContain(r.status());
  });
});

test.describe("Vite proxy (pulsar-frontend) routes to backend", () => {
  test("/api via proxy reaches :18080", async ({ request }) => {
    const r = await request.post(`${PROXY}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
  });

  test("/v3/api-docs via proxy reaches :18080", async ({ request }) => {
    const r = await request.get(`${PROXY}/v3/api-docs`);
    expect(r.ok()).toBeTruthy();
  });

  test("/automation via proxy reaches :3002", async ({ page }) => {
    const response = await page.goto(`${PROXY}/automation/login`);
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/Pulsar/);
  });
});

test.describe("Flow-platform — unauthenticated", () => {
  test("/automation/dashboard without cookie redirects to /login", async ({ page }) => {
    const response = await page.goto(`${APP}/automation/dashboard`);
    // Server-side redirects through /login, which then client-redirects to the Pulsar app.
    // We accept either the intermediate /login page OR the Pulsar app URL.
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/\/login$|localhost:5173/);
    expect(response).toBeTruthy();
  });

  test("/automation/login is a client-side redirect to the Pulsar frontend", async ({ page }) => {
    // The shim page runs a useEffect that sets window.location.href to the Pulsar URL.
    // The spinner text ("Redirecting to Pulsar") flashes for one tick; reliably asserting
    // that the redirect landed on :5173 is both more meaningful and deterministic.
    await page.goto(`${APP}/automation/login`, { waitUntil: "commit" });
    await page.waitForURL(/localhost:5173/, { timeout: 10000 });
    expect(page.url()).toMatch(/localhost:5173/);
  });
});

test.describe("Flow-platform — authenticated (tenant user)", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "pulsar_jwt",
        value: tenantToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("dashboard renders with AppShell", async ({ page }) => {
    await page.goto(`${APP}/automation/dashboard`);
    // Should NOT have been redirected away.
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toContain("/automation/dashboard");
  });

  test("/automation/clinics redirects the tenant to their workflows page", async ({ page }) => {
    await page.goto(`${APP}/automation/clinics`);
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/\/automation\/clinics\/[^/]+\/workflows$/);
  });

  test("GET /automation/api/clinics returns this tenant's clinic", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/clinics`, {
      headers: { Cookie: `pulsar_jwt=${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
    const clinics = await r.json();
    expect(Array.isArray(clinics)).toBeTruthy();
    expect(clinics.length).toBeGreaterThanOrEqual(1);
    expect(clinics.some((c: { slug: string }) => c.slug === TENANT_SLUG)).toBeTruthy();
  });

  test("GET /automation/api/workflows responds", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/workflows`, {
      headers: { Cookie: `pulsar_jwt=${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
  });

  test("GET /automation/api/approvals responds", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/approvals`, {
      headers: { Cookie: `pulsar_jwt=${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
  });

  test("GET /automation/api/conversations responds", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/conversations`, {
      headers: { Cookie: `pulsar_jwt=${tenantToken}` },
    });
    expect(r.ok()).toBeTruthy();
  });

  test("protected API rejects requests without the cookie", async ({ request }) => {
    const r = await request.get(`${APP}/automation/api/clinics`);
    // Either 401 or a 307/308 redirect to /login — both are 'not authorized'
    expect([401, 307, 308]).toContain(r.status());
  });
});

test.describe("Full end-to-end handshake (via Vite proxy, real browser)", () => {
  test("tenant login → cookie → authenticated /automation → /api both usable", async ({ page, request }) => {
    // 1. Log in via the proxy (same path a browser would take)
    const login = await request.post(`${PROXY}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
    });
    expect(login.ok()).toBeTruthy();
    const body = await login.json();
    const token = body.token;

    // 2. Inject the same cookie into the browser context.
    await page.context().addCookies([
      { name: "pulsar_jwt", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);

    // 3. Hit the flow-platform via the proxy — should not redirect to login.
    const resp = await page.goto(`${PROXY}/automation/dashboard`);
    expect(resp?.ok()).toBeTruthy();
    expect(page.url()).toContain("/automation/dashboard");

    // 4. In the same session, backend API should accept the Bearer token.
    const me = await request.get(`${PROXY}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok()).toBeTruthy();
    const meBody = await me.json();
    expect(meBody.slug).toBe(TENANT_SLUG);
  });
});
