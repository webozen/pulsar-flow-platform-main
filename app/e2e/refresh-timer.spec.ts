/**
 * Proves the proactive-refresh scheduler in useAuth.tsx actually fires.
 *
 * Real JWT TTL is 3600 s, refresh schedules at (exp - 60) s → we'd wait
 * 59 minutes for a real trigger. Instead we install Playwright's fake clock
 * in the browser, log in for real (server still sees wall-clock time so
 * the JWT is valid), then fast-forward the fake clock past the scheduled
 * time. The setTimeout fires inside the page, attemptRefresh() is called,
 * and we observe the POST /api/auth/refresh request on the network.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";

const FRONTEND = "http://localhost:5173";
const BACKEND = "http://localhost:18080";
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000";

const RUN = Date.now();
const SLUG = `reftimer-${RUN}`;
const EMAIL = `owner-${RUN}@reftimer.local`;
let PASSCODE: string;

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  // Admin login → create a fresh tenant we can sign into later.
  const adminRes = await api.post(`${BACKEND}/api/admin/login`, {
    data: { passcode: ADMIN_PASSCODE },
  });
  expect(adminRes.ok()).toBeTruthy();
  const adminToken = (await adminRes.json()).token;

  const create = await api.post(`${BACKEND}/api/admin/tenants`, {
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    data: { slug: SLUG, name: `Refresh Timer Test ${RUN}`, contactEmail: EMAIL },
  });
  expect(create.ok()).toBeTruthy();
  PASSCODE = (await create.json()).passcode;
  expect(PASSCODE).toBeTruthy();
});

test("proactive refresh: scheduler fires POST /api/auth/refresh 60 s before the token expires", async ({ page }) => {
  // Install the fake clock BEFORE any page script runs so all setTimeout
  // registrations inside useAuth use this clock, not the real one.
  await page.clock.install({ time: new Date() });

  // Log in as tenant — this bootstraps the AuthProvider, which schedules the
  // refresh after /api/auth/me succeeds.
  await page.goto(`${FRONTEND}/login`);
  await page.locator('input[placeholder="acme"]').fill(SLUG);
  await page.locator('input[type=email]').fill(EMAIL);
  await page.locator('input[type=password]').fill(PASSCODE);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`/t/${SLUG}(?:/|$)`), { timeout: 15000 });

  // Grab the pre-refresh token so we can assert it changes.
  const tokenBefore = await page.evaluate(() => sessionStorage.getItem("pulsar.jwt"));
  expect(tokenBefore).toBeTruthy();

  // Start watching for the refresh request. The scheduler's setTimeout is armed
  // on the fake clock; it fires when we fast-forward past (exp - 60 s).
  // TTL is 3600 s, so advancing by 3541 s is just past the 3540 s fire point.
  const refreshRequest = page.waitForRequest(
    (req) => req.url().includes("/api/auth/refresh") && req.method() === "POST",
    { timeout: 15000 },
  );

  // Advance browser-side time only; the backend still sees wall clock time
  // so the bearer we send remains within its (real) TTL.
  await page.clock.runFor(3541 * 1000);

  const hit = await refreshRequest;
  expect(hit).toBeTruthy();

  // Give useAuth a moment to apply the new token to sessionStorage, then
  // verify it's no longer the one we started with.
  await page.waitForFunction(
    (prev: string) => {
      const t = sessionStorage.getItem("pulsar.jwt");
      return typeof t === "string" && t.length > 20 && t !== prev;
    },
    tokenBefore!,
    { timeout: 10000 },
  );
  const tokenAfter = await page.evaluate(() => sessionStorage.getItem("pulsar.jwt"));
  expect(tokenAfter).not.toBe(tokenBefore);
});

test("refresh scheduler re-arms after success — second expiry triggers another refresh", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await page.goto(`${FRONTEND}/login`);
  await page.locator('input[placeholder="acme"]').fill(SLUG);
  await page.locator('input[type=email]').fill(EMAIL);
  await page.locator('input[type=password]').fill(PASSCODE);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`/t/${SLUG}(?:/|$)`), { timeout: 15000 });

  // Count refreshes as they fly by.
  const seen: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/auth/refresh") && req.method() === "POST") {
      seen.push(new Date().toISOString());
    }
  });

  // Fast-forward past TWO refresh windows (~2 × 3540 s).
  await page.clock.runFor(3541 * 1000);
  await page.waitForTimeout(500); // allow attemptRefresh fetch + sessionStorage write to settle
  await page.clock.runFor(3541 * 1000);
  await page.waitForTimeout(500);

  expect(seen.length).toBeGreaterThanOrEqual(2);
});
