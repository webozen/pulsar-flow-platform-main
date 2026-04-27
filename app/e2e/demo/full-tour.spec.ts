/**
 * Comprehensive product tour. Visits every shipped screen across both
 * the pulsar-frontend SPA (`:5173`) and the flow-platform Next.js app
 * (`:3002`), ending with an admin glance. Designed for a 2–3 minute
 * sales/onboarding demo when paced with voice-over.
 *
 * Scenes are factored into helpers so it's easy to drop / reorder /
 * lengthen any one of them. Every `pause()` is a deliberate hold to
 * give VO time to land.
 *
 * Pre-reqs:
 *   - All five services running (backend :18080, flow-platform :3002,
 *     frontend :5173, MySQL, Postgres, Kestra)
 *   - Tenant has all relevant modules activated (acme-dental in dev
 *     already does — see backend admin → tenants/{id}/modules)
 */
import { test, expect, request as playwrightRequest, type Page } from "@playwright/test"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const APP = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const FRONTEND = process.env.PULSAR_FRONTEND_URL ?? "http://localhost:5173"
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test"
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? ""

const DEMO_WF_NAME = "Recall Reminder (Demo)"
const DEMO_WF_DESC = "Sends a friendly SMS when a patient is due for a cleaning"

// Tunable pacing — bump these if voice-over needs more breathing room.
const DWELL_SHORT = 1500   // for transitions
const DWELL_NORMAL = 2500  // for "look at this screen" moments
const DWELL_LONG = 3500    // for headline screens (dashboard, marketplace)
const TYPE_DELAY_FAST = 35  // chars/sec ≈ 28
const TYPE_DELAY_SLOW = 60  // chars/sec ≈ 17

let tenantJwt = ""

test.beforeAll(async () => {
  if (!TENANT_PASSCODE) {
    throw new Error(
      "TEST_TENANT_PASSCODE must be set. Regen via: " +
        "POST /api/admin/tenants/<id>/passcode (admin Bearer token).",
    )
  }
  // Pre-bake JWTs so the tour works on both origins immediately. The
  // login form is still recorded for the demo; this just keeps the
  // protected pages reachable without a real round-trip.
  const api = await playwrightRequest.newContext()
  const tlogin = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  })
  expect(tlogin.ok(), `tenant login: ${tlogin.status()}`).toBeTruthy()
  tenantJwt = (await tlogin.json()).token
})

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms)
}

async function setJwtOnAllOrigins(page: Page) {
  // Same JWT, three origins. The shared HMAC secret means each app
  // verifies the cookie identically. SameSite=Lax keeps it sent on
  // top-level navigation (which is what Playwright does between scenes).
  for (const url of [APP, FRONTEND, BACKEND]) {
    await page.context().addCookies([
      { name: "pulsar_jwt", value: tenantJwt, url, sameSite: "Lax" },
    ])
  }
  // Also stash in localStorage for the frontend's `setAuthToken` path.
  await page.goto(FRONTEND, { waitUntil: "domcontentloaded" })
  await page.evaluate(([token]) => {
    try { localStorage.setItem("pulsar_jwt", token) } catch {}
  }, [tenantJwt])
}

async function visit(page: Page, url: string, dwell = DWELL_NORMAL) {
  await page.goto(url, { waitUntil: "networkidle" }).catch(async () => {
    // Some Next.js routes do client-side data fetches that never settle
    // networkidle. Fall back to load.
    await page.goto(url, { waitUntil: "load" })
  })
  await pause(page, dwell)
}

test("Pulsar — full product tour (~2–3 min recording)", async ({ page, context }) => {
  test.setTimeout(300_000) // 5 min ceiling

  // ── ACT 1 · Identity ───────────────────────────────────────────
  // Scene 1: tenant login form — the very first surface a practice sees.
  await visit(page, `${FRONTEND}/login`, DWELL_LONG)

  await page.locator("#slug").click()
  await page.locator("#slug").pressSequentially(TENANT_SLUG, { delay: TYPE_DELAY_SLOW })
  await pause(page, 600)

  await page.locator("#email").click()
  await page.locator("#email").pressSequentially(TENANT_EMAIL, { delay: TYPE_DELAY_FAST })
  await pause(page, 600)

  await page.locator("#passcode").click()
  await page.locator("#passcode").pressSequentially(TENANT_PASSCODE, { delay: TYPE_DELAY_FAST })
  await pause(page, 1200)

  // Inject the cookie before submitting — the form will navigate to
  // /t/<slug> and we want the protected route to render immediately.
  await setJwtOnAllOrigins(page)
  await page.getByRole("button", { name: /sign in/i }).click().catch(() => {})
  await pause(page, DWELL_NORMAL)

  // Scene 2: tenant marketplace home — the module dashboard.
  await visit(page, `${FRONTEND}/t/${TENANT_SLUG}/`, DWELL_LONG)

  // ── ACT 2 · Module tour ────────────────────────────────────────
  // Tap each shipped module. Pacing: ~3s per screen — enough to read
  // the headline, not enough to bore the viewer.
  const modules: Array<{ path: string; label: string }> = [
    { path: "/office",         label: "Office (scheduling)" },
    { path: "/hr",             label: "HR" },
    { path: "/payroll",        label: "Payroll" },
    { path: "/invoicing",      label: "Invoicing" },
    { path: "/content",        label: "Content" },
    { path: "/inventory",      label: "Inventory" },
    { path: "/ai-notes",       label: "AI Notes" },
    { path: "/translate",      label: "Translate" },
    { path: "/opendental",     label: "OpenDental" },
    { path: "/opendental-ai",  label: "Ask AI" },
    { path: "/call-handling",  label: "Calls" },
    { path: "/text-support",   label: "Text" },
  ]
  for (const m of modules) {
    await visit(page, `${FRONTEND}/t/${TENANT_SLUG}${m.path}`, DWELL_NORMAL)
  }

  // ── ACT 3 · Automation deep-dive ───────────────────────────────
  // The most differentiated surface — give it more screen time.
  // Scene 3a: dashboard.
  await visit(page, `${APP}/automation/dashboard`, DWELL_LONG)

  // Scene 3b: workflows list.
  await visit(page, `${APP}/automation/clinics/${TENANT_SLUG}/workflows`, DWELL_NORMAL)

  // Scene 3c: build a new workflow — the centerpiece.
  await visit(page, `${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`, DWELL_SHORT)

  const nameInput = page.locator("input").first()
  await nameInput.click()
  await nameInput.pressSequentially(DEMO_WF_NAME, { delay: TYPE_DELAY_SLOW })
  await pause(page, 700)

  const descInput = page.locator("input").nth(1)
  await descInput.click()
  await descInput.pressSequentially(DEMO_WF_DESC, { delay: TYPE_DELAY_FAST })
  await pause(page, 1500)

  const saveBtn = page.getByRole("button", { name: /save|create|deploy/i }).first()
  if (await saveBtn.count() > 0) {
    await saveBtn.click()
    await pause(page, DWELL_NORMAL)
  }

  // Scene 3d: approvals queue (the human-in-the-loop differentiator).
  await visit(page, `${APP}/automation/approvals`, DWELL_LONG)

  // Scene 3e: conversations / patient messaging history.
  await visit(page, `${APP}/automation/conversations`, DWELL_NORMAL)

  // Scene 3f: patients view.
  await visit(page, `${APP}/automation/clinics/${TENANT_SLUG}/patients`, DWELL_NORMAL)

  // Scene 3g: playbooks (templates the tenant can clone).
  await visit(page, `${APP}/automation/clinics/${TENANT_SLUG}/playbooks`, DWELL_NORMAL)

  // Scene 3h: the public portal view — what an end-patient/staff sees.
  await visit(page, `${APP}/automation/portal/${TENANT_SLUG}`, DWELL_NORMAL)
  await visit(page, `${APP}/automation/portal/${TENANT_SLUG}/executions`, DWELL_NORMAL)

  // ── ACT 4 · Admin glance ───────────────────────────────────────
  // Show the operator surface: which tenants exist, lifecycle state.
  // Sign out of tenant role first so the admin login flow is real.
  await context.clearCookies()
  await visit(page, `${FRONTEND}/admin`, DWELL_NORMAL)

  await page.locator('input[type="password"]').click()
  await page.locator('input[type="password"]').pressSequentially(ADMIN_PASSCODE, { delay: TYPE_DELAY_FAST })
  await pause(page, 800)
  await page.getByRole("button", { name: /sign in/i }).click().catch(() => {})
  await pause(page, DWELL_NORMAL)

  // Scene 4: admin tenants list.
  await visit(page, `${FRONTEND}/admin`, DWELL_LONG)

  // Final hold so the closing VO has air. Returns to marketplace home
  // as a "this is your control center" outro shot.
  await context.addCookies([
    { name: "pulsar_jwt", value: tenantJwt, url: FRONTEND, sameSite: "Lax" },
  ])
  await visit(page, `${FRONTEND}/t/${TENANT_SLUG}/`, DWELL_LONG)
})

test.afterAll(async () => {
  // Best-effort: wipe the demo workflow so re-runs are deterministic.
  if (!tenantJwt) return
  const api = await playwrightRequest.newContext()
  try {
    const r = await api.get(`${APP}/automation/api/workflows`, {
      headers: { Cookie: `pulsar_jwt=${tenantJwt}` },
    })
    if (!r.ok()) return
    const list = (await r.json()) as Array<{ id?: string; name?: string }>
    for (const w of list) {
      if (w.name === DEMO_WF_NAME && w.id) {
        await api.delete(`${APP}/automation/api/workflows/${w.id}`, {
          headers: { Cookie: `pulsar_jwt=${tenantJwt}` },
        })
      }
    }
  } catch { /* non-fatal */ }
})
