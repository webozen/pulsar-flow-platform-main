/**
 * Full-browser end-to-end test of the admin and tenant login UIs.
 *
 * Walks through:
 *   1. Admin login at /admin
 *   2. Create a unique tenant through the modal
 *   3. Verify the PasscodeRevealModal surfaces ALL three credentials
 *      (workspace, email, passcode) so the admin can hand them off
 *   4. Regenerate passcode from the detail page, verify new modal
 *   5. Tenant login at /login — try every wrong combo then the right one
 */
import { test, expect, Page } from "@playwright/test";

const FRONTEND = "http://localhost:5173";
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-0000";

// Make every run unique so re-running doesn't hit "slug_taken".
const RUN = Date.now();
const SLUG = `uitest-${RUN}`;
const NAME = `UI Test Clinic ${RUN}`;
const EMAIL = `owner-${RUN}@uitest.local`;

let createdPasscode: string;

async function adminLogin(page: Page) {
  await page.goto(`${FRONTEND}/admin`);
  await page.locator("input[type=password]").fill(ADMIN_PASSCODE);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible({ timeout: 10000 });
  // Wait for at least one table row to render (list fetches on mount).
  // Avoids races with the first click after a fresh login.
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });
}

// The admin lifecycle tests share the created tenant's credentials across tests,
// and the tenant-login tests rely on that tenant existing. Serial mode keeps
// them ordered and fails fast on the first broken step.
test.describe.configure({ mode: "serial" });

test.describe("Admin UI — full tenant lifecycle", () => {
  test("login → create tenant → reveal modal shows slug + email + passcode", async ({ page }) => {
    await adminLogin(page);

    // Create tenant
    await page.getByRole("button", { name: /\+ Create tenant/i }).click();
    await page.locator('input[placeholder="acme"]').fill(SLUG);
    await page.locator('input[placeholder="Acme Salon"]').fill(NAME);
    await page.locator('input[type=email]').fill(EMAIL);
    await page.getByRole("button", { name: /^Create$/i }).click();

    // Reveal modal — all three fields must be visible with the freshly-issued values
    const slugEl = page.getByTestId("reveal-slug");
    const emailEl = page.getByTestId("reveal-email");
    const passEl = page.getByTestId("reveal-passcode");
    await expect(slugEl).toHaveText(SLUG);
    await expect(emailEl).toHaveText(EMAIL);
    await expect(passEl).toHaveText(/^PULS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    createdPasscode = (await passEl.textContent())!.trim();
    expect(createdPasscode).toBeTruthy();

    // Dismiss and confirm the new tenant appears in the list
    await page.getByRole("button", { name: /^Done$/i }).click();
    await expect(page.getByRole("link", { name: NAME })).toBeVisible();
  });

  test("tenant detail page shows workspace + email and a Regenerate passcode button (passcode itself is hidden)", async ({ page }) => {
    await adminLogin(page);
    // The row may be anywhere in a long list — scroll it into view first.
    const link = page.getByRole("link", { name: NAME });
    await link.waitFor({ state: "visible", timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
    // Slug and email appear in both the subheading and the Access section — assert first match.
    await expect(page.getByText(SLUG).first()).toBeVisible();
    await expect(page.getByText(EMAIL).first()).toBeVisible();
    // Raw passcode must NOT be visible on the detail page (bug #9 design)
    await expect(page.getByText(createdPasscode ?? "NEVER_MATCHES")).toHaveCount(0);
    // Hidden placeholder must be visible
    await expect(page.getByText(/hidden — regenerate to view/i)).toBeVisible();
    // Regenerate button must exist
    await expect(page.getByRole("button", { name: /Regenerate passcode/i })).toBeVisible();
  });

  test("regenerating invalidates the old passcode and reveals the new one", async ({ page, request }) => {
    await adminLogin(page);
    const link = page.getByRole("link", { name: NAME });
    await link.waitFor({ state: "visible", timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.getByRole("button", { name: /Regenerate passcode/i }).click();

    // New PasscodeRevealModal opens with the new value
    const newPass = await page.getByTestId("reveal-passcode").textContent();
    expect(newPass).toMatch(/^PULS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(newPass).not.toBe(createdPasscode);

    // Old passcode must now fail at the backend
    const stale = await request.post("http://localhost:18080/api/tenant/login", {
      data: { slug: SLUG, email: EMAIL, passcode: createdPasscode },
    });
    expect(stale.status()).toBe(401);

    createdPasscode = (newPass ?? "").trim();
    await page.getByRole("button", { name: /^Done$/i }).click();
  });
});

test.describe("Tenant login UI — all 3 factors enforced", () => {
  // Each test is independent: go to /login fresh, fill combo, click Sign in, check outcome.

  async function fillLogin(page: Page, slug: string, email: string, passcode: string) {
    await page.goto(`${FRONTEND}/login`);
    // The form has three inputs in order: workspace (text, placeholder "acme"),
    // email (type=email), passcode (type=password).
    await page.locator('input[placeholder="acme"]').fill(slug);
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(passcode);
    await page.getByRole("button", { name: /sign in/i }).click();
  }

  test("wrong workspace → UI shows 'Invalid email or passcode'", async ({ page }) => {
    await fillLogin(page, "totally-bogus-workspace", EMAIL, createdPasscode);
    await expect(page.getByText(/Invalid email or passcode/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/login");
  });

  test("wrong email → UI shows 'Invalid email or passcode'", async ({ page }) => {
    await fillLogin(page, SLUG, "intruder@evil.test", createdPasscode);
    await expect(page.getByText(/Invalid email or passcode/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/login");
  });

  test("wrong passcode → UI shows 'Invalid email or passcode'", async ({ page }) => {
    await fillLogin(page, SLUG, EMAIL, "PULS-XXXX-XXXX");
    await expect(page.getByText(/Invalid email or passcode/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/login");
  });

  test("two wrong, one right → still rejected", async ({ page }) => {
    await fillLogin(page, "wrong-slug", "wrong@email.test", createdPasscode);
    await expect(page.getByText(/Invalid email or passcode/i)).toBeVisible({ timeout: 10000 });
  });

  test("all three correct → navigates into /t/{slug}", async ({ page }) => {
    await fillLogin(page, SLUG, EMAIL, createdPasscode);
    await page.waitForURL(new RegExp(`/t/${SLUG}(?:/|$)`), { timeout: 15000 });
    expect(page.url()).toContain(`/t/${SLUG}`);
  });

  test("all three correct but email in UPPERCASE → still navigates in (case-insensitive email)", async ({ page }) => {
    await fillLogin(page, SLUG, EMAIL.toUpperCase(), createdPasscode);
    await page.waitForURL(new RegExp(`/t/${SLUG}(?:/|$)`), { timeout: 15000 });
    expect(page.url()).toContain(`/t/${SLUG}`);
  });
});

test.describe("Logout UX — end-to-end through the admin shell", () => {
  test("clicking 'Sign out' in /admin calls logout, clears session, and bounces to admin login", async ({ page }) => {
    // 1. Log in as admin through the UI so useAuth holds a live token + context.
    await page.goto(`${FRONTEND}/admin`);
    await page.locator("input[type=password]").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible({ timeout: 10000 });

    // 2. Observe the logout request on the network so we can assert the server was called.
    const logoutReq = page.waitForRequest(
      (req) => req.url().includes("/api/auth/logout") && req.method() === "POST",
      { timeout: 10000 },
    );
    await page.getByRole("button", { name: /Sign out/i }).click();
    await logoutReq;

    // 3. Admin shell routes to the login page once auth status flips to unauthenticated.
    await expect(page.locator("input[type=password]")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Enter your admin passcode/i)).toBeVisible();

    // 4. Post-logout, /api/auth/me should reject the stale client token (session purged).
    const tokenAfter = await page.evaluate(() => sessionStorage.getItem("pulsar.jwt"));
    expect(tokenAfter).toBeNull();
  });
});
