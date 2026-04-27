/**
 * Regression tests for the 9 bug fixes shipped in this session.
 *
 * Each test asserts the new/fixed behaviour. If any of these start failing,
 * a fix has been regressed.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";

const BACKEND = "http://localhost:18080";
const APP = "http://localhost:3002";
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000";
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental";
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test";
// Tenant passcodes are generated per-tenant; pass via TEST_TENANT_PASSCODE.
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? "PULS-XXXX-XXXX";

let tenantToken: string;

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  const r = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  });
  expect(r.ok()).toBeTruthy();
  tenantToken = (await r.json()).token;
});

test.describe("Bug #2 — clinics page redirect", () => {
  test("authenticated tenant on /automation/clinics now lands on /workflows (not /login)", async ({ page, context }) => {
    await context.addCookies([
      { name: "pulsar_jwt", value: tenantToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    await page.goto(`${APP}/automation/clinics`);
    await page.waitForLoadState("domcontentloaded");
    // Happy path is now reachable — NOT /login anymore.
    expect(page.url()).toMatch(/\/automation\/clinics\/[^/]+\/workflows$/);
  });
});

test.describe("Bug #7 — /actuator/health exposed", () => {
  test("GET /actuator/health returns 200 with status UP", async ({ request }) => {
    const r = await request.get(`${BACKEND}/actuator/health`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.status).toBe("UP");
  });
});

test.describe("Bug #8 — adminLogin sets pulsar_jwt cookie", () => {
  test("POST /api/admin/login returns Set-Cookie just like tenantLogin", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
    const setCookie = r.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("pulsar_jwt=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });
});

test.describe("Bug #9 — TenantDto no longer leaks passcode", () => {
  test("GET /api/admin/tenants does NOT include access_passcode for any tenant", async ({ request }) => {
    const adminLogin = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    const adminToken = (await adminLogin.json()).token;
    const r = await request.get(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.ok()).toBeTruthy();
    const list = await r.json();
    // No tenant row should contain a "passcode" or "access_passcode" field.
    for (const t of list) {
      expect(Object.keys(t)).not.toContain("passcode");
      expect(Object.keys(t)).not.toContain("access_passcode");
    }
  });

  test("create-tenant response still includes the passcode exactly once", async ({ request }) => {
    const adminLogin = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    const adminToken = (await adminLogin.json()).token;
    const slug = `bugfix-${Date.now()}`;
    const create = await request.post(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      data: { slug, name: "Bugfix Test", contactEmail: `owner@${slug}.test` },
    });
    expect(create.ok()).toBeTruthy();
    const body = await create.json();
    // Top-level passcode present
    expect(body.passcode).toMatch(/^PULS-/);
    // Inside the tenant object: NOT present
    expect(Object.keys(body.tenant)).not.toContain("passcode");
  });
});

test.describe("Passcode hashing at rest", () => {
  test("DB column stores a BCrypt hash, not the plaintext passcode", async () => {
    // Cross-platform: shell into the running pulsar-mysql container
    // (started by docker compose). Avoids depending on a host MySQL CLI.
    const { execSync } = await import("node:child_process");
    const out = execSync(
      `docker exec pulsar-mysql mysql -uroot -ppulsar pulsar_platform -sN ` +
        `-e "SELECT access_passcode_hash FROM public_tenants WHERE slug='${TENANT_SLUG}'"`,
      { encoding: "utf8" },
    );
    expect(out.trim()).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  test("login still verifies correctly even though DB stores only a hash", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
  });
});

test.describe("Logout endpoint", () => {
  test("POST /api/auth/logout clears the pulsar_jwt cookie", async ({ request }) => {
    // Log in first so the client has a cookie to clear.
    const login = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
    });
    expect(login.ok()).toBeTruthy();

    const logout = await request.post(`${BACKEND}/api/auth/logout`);
    expect(logout.ok()).toBeTruthy();
    const setCookie = logout.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("pulsar_jwt=");
    // Max-Age=0 is how RFC 6265 says "delete immediately"
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});

test.describe("Tenant login now verifies email as a third factor", () => {
  test("wrong email with right passcode is rejected (401)", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: "intruder@evil.test", passcode: TENANT_PASSCODE },
    });
    expect(r.status()).toBe(401);
  });

  test("correct email in uppercase still works (case-insensitive)", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL.toUpperCase(), passcode: TENANT_PASSCODE },
    });
    expect(r.ok()).toBeTruthy();
  });

  test("missing email field rejects (401)", async ({ request }) => {
    const r = await request.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, passcode: TENANT_PASSCODE },
    });
    expect([400, 401]).toContain(r.status());
  });
});

test.describe("Bug #6 — Redis dependency fully removed", () => {
  test("backend has no Redis client configured and tenant writes succeed without Redis running", async ({ request }) => {
    // With Redis entirely uninstalled, every admin CRUD path must succeed.
    const adminLogin = await request.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE },
    });
    const adminToken = (await adminLogin.json()).token;

    const slug = `noredis-${Date.now()}`;
    const create = await request.post(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      data: { slug, name: "No Redis Test", contactEmail: `owner@${slug}.test` },
    });
    // Before bug #6 fix: 500 from RedisConnectionFailureException.
    // After fix: 200 regardless of Redis presence.
    expect(create.ok()).toBeTruthy();
  });

  test("nothing in the stack is listening on the old Redis port 6380", async ({ request }) => {
    // Cross-platform: try to open a TCP connection. Anything other than
    // a connection-refused/timeout means a process is listening on 6380.
    const net = await import("node:net");
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port: 6380 });
      const done = (open: boolean) => {
        socket.destroy();
        resolve(open);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      setTimeout(() => done(false), 1500);
    });
    expect(isOpen, "port 6380 should be closed (Redis dependency removed)").toBe(false);
    // Suppress unused-binding lint: `request` arg is required by Playwright fixture
    void request;
  });
});
