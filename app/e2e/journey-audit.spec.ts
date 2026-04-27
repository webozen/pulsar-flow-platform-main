/**
 * Customer-journey audit. Walks the canonical flow from sign-in
 * through first workflow + first approval + module navigation.
 * Each scene asserts the page rendered SOMETHING coherent (not a
 * blank, not an error). Findings get logged to console for triage.
 *
 * This is NOT a regression test — it's an exploratory tool. Failures
 * here mean "something looks weird," not "the build is broken."
 */
import { test, expect, request as playwrightRequest, type Page } from "@playwright/test"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const APP = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const FRONTEND = process.env.PULSAR_FRONTEND_URL ?? "http://localhost:5173"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test"
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? ""

let tenantJwt = ""
const findings: string[] = []

function note(severity: "BLOCKER" | "BUG" | "UX", scene: string, msg: string) {
  const line = `[${severity}] ${scene}: ${msg}`
  // eslint-disable-next-line no-console
  console.log("  " + line)
  findings.push(line)
}

// All shipped modules — the audit ensures these are active before
// running so a previous test's destructive setUp doesn't corrupt state.
const REQUIRED_MODULES = [
  "automation", "scheduling", "content", "ai-notes", "translate",
  "opendental", "opendental-ai", "voice-ringcentral", "text-support",
  "hr", "inventory", "payroll", "invoicing", "call-handling",
]

test.beforeAll(async () => {
  if (!TENANT_PASSCODE) throw new Error("TEST_TENANT_PASSCODE must be set")
  const api = await playwrightRequest.newContext()

  // Self-heal modules — coverage.spec.ts deactivates them as part of a
  // "403 when not active" test and its afterAll has been seen to skip
  // restoration. Without this, the marketplace shows 0 active cards.
  const adminLogin = await api.post(`${BACKEND}/api/admin/login`, {
    data: { passcode: process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000" },
  })
  if (adminLogin.ok()) {
    const adminToken = (await adminLogin.json()).token
    const tenantsRes = await api.get(`${BACKEND}/api/admin/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (tenantsRes.ok()) {
      const tenants = (await tenantsRes.json()) as Array<{ id: number; slug: string; modules: string[] }>
      const t = tenants.find((x) => x.slug === TENANT_SLUG)
      if (t) {
        const missing = REQUIRED_MODULES.filter((m) => !(t.modules ?? []).includes(m))
        if (missing.length > 0) {
          await api.patch(`${BACKEND}/api/admin/tenants/${t.id}/modules`, {
            headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
            data: { modules: REQUIRED_MODULES },
          })
        }
      }
    }
  }

  const r = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  })
  expect(r.ok()).toBeTruthy()
  tenantJwt = (await r.json()).token
})

test.afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`\n=== Customer-journey findings (${findings.length}) ===`)
  for (const f of findings) {
    // eslint-disable-next-line no-console
    console.log(f)
  }
})

async function setJwt(page: Page) {
  for (const url of [APP, FRONTEND, BACKEND]) {
    await page.context().addCookies([
      { name: "pulsar_jwt", value: tenantJwt, url, sameSite: "Lax" },
    ])
  }
  await page.goto(FRONTEND)
  await page.evaluate((token) => {
    sessionStorage.setItem("pulsar.jwt", token)
  }, tenantJwt)
}

test("journey: tenant login form renders + accepts credentials", async ({ page }) => {
  await page.goto(`${FRONTEND}/login`)
  const slug = page.locator("#slug")
  const email = page.locator("#email")
  const pass = page.locator("#passcode")
  if (!(await slug.count())) note("BLOCKER", "login", "missing #slug input")
  if (!(await email.count())) note("BLOCKER", "login", "missing #email input")
  if (!(await pass.count())) note("BLOCKER", "login", "missing #passcode input")
  const button = page.getByRole("button", { name: /sign in/i })
  if (!(await button.count())) note("BLOCKER", "login", "missing Sign in button")
})

test("journey: marketplace home renders 15 module cards in a clean grid", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const html = await page.content()
  if (!html.includes("Welcome back")) note("UX", "marketplace", "missing 'Welcome back' headline")
  if (html.includes("NOT ENABLED")) note("BUG", "marketplace", "showing NOT ENABLED — module activation likely lost")
  if (!html.includes("Office") || !html.includes("Automation")) note("BLOCKER", "marketplace", "module names missing from grid")
})

test("journey: every active module page renders without crashing", async ({ page }) => {
  await setJwt(page)
  const modules = [
    "office", "hr", "inventory", "payroll", "invoicing",
    "content", "ai-notes", "translate", "opendental",
    "opendental-ai", "call-handling", "text-support",
  ]
  for (const m of modules) {
    const path = `${FRONTEND}/t/${TENANT_SLUG}/${m}`
    await page.goto(path)
    await page.waitForLoadState("networkidle").catch(() => {})
    const url = page.url()
    const html = await page.content()
    if (url.includes("/login") && !url.includes("?demo=")) {
      note("BLOCKER", `module:${m}`, `bounced to login (auth lost?)`)
      continue
    }
    if (html.includes("Application error") || html.includes("Cannot read properties")) {
      note("BLOCKER", `module:${m}`, "runtime error visible")
      continue
    }
    if (url.endsWith("/onboarding")) {
      note("UX", `module:${m}`, "redirected to onboarding — fine for unconfigured modules but worth confirming")
    }
  }
})

test("journey: marketplace → Automation cross-app handoff works", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`)
  // The Automation nav link is `external: true` — should hit the proxy.
  await page.goto(`${APP}/automation/dashboard`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const url = page.url()
  if (url.includes("/login")) {
    note("BLOCKER", "auto-handoff", "Automation requires re-login (cross-app cookie not set)")
  }
  if (!(await page.locator('text=/dashboard/i').first().count())) {
    note("UX", "auto-handoff", "dashboard heading not found")
  }
})

test("journey: workflows list — empty state is friendly + has CTA", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const html = await page.content()
  // Look for primary CTA to create.
  const createBtn = page.getByRole("button", { name: /create|new workflow|\+/i }).first()
  const createLink = page.locator("a").filter({ hasText: /create|new workflow/i }).first()
  if (!(await createBtn.count()) && !(await createLink.count())) {
    note("UX", "workflows-list", "no obvious 'Create workflow' CTA visible above the fold")
  }
  if (!html.includes("Workflows") && !html.includes("workflows")) {
    note("UX", "workflows-list", "page has no 'Workflows' label / heading")
  }
})

test("journey: Builder form loads + accepts input", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const inputs = await page.locator("input").count()
  if (inputs < 2) note("BUG", "builder", `only ${inputs} input fields — Builder might not have rendered`)
  const sqlBox = page.locator("textarea").first()
  if (!(await sqlBox.count())) note("UX", "builder", "no textarea (SQL editor missing?)")
  const saveBtn = page.getByRole("button", { name: /save|create|deploy/i }).first()
  if (!(await saveBtn.count())) note("BLOCKER", "builder", "no Save button — user can't ship a workflow")
})

test("journey: Approvals empty state communicates 'All clear'", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/approvals`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const html = await page.content()
  if (!html.includes("All clear") && !html.includes("No pending") && !html.includes("Approval Queue")) {
    note("UX", "approvals-empty", "empty state copy missing — could feel broken")
  }
})

test("journey: Approvals queue WITH cards (demo mode) renders patient cards", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/approvals?demo=1`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const html = await page.content()
  for (const name of ["Sawyer Mitchell", "Ivanna Chen", "Marcus Reyes", "Priya Shah"]) {
    if (!html.includes(name)) note("BUG", "approvals-demo", `expected card for ${name}`)
  }
  const approveBtn = page.getByRole("button", { name: /^Approve · / }).first()
  if (!(await approveBtn.count())) note("BUG", "approvals-demo", "Approve · {name} button not rendering")
})

test("journey: Conversations page renders", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/conversations`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const html = await page.content()
  if (!html.includes("Conversations") && !html.includes("threads")) {
    note("UX", "conversations", "no header / threads label")
  }
})

test("journey: Sign out from frontend lands somewhere sane", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const signOut = page.getByRole("button", { name: /sign out/i }).first()
  if (!(await signOut.count())) {
    note("UX", "sign-out", "no Sign out button visible in header")
    return
  }
  await signOut.click().catch(() => {})
  await page.waitForLoadState("networkidle").catch(() => {})
  const url = page.url()
  if (!url.includes("/login")) {
    note("UX", "sign-out", `landed at ${url} after sign out — expected /login`)
  }
})

test("journey: clicking a marketplace card navigates to the module", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`)
  await page.waitForLoadState("networkidle").catch(() => {})
  // Find a card that says Office and click it.
  const officeCard = page.locator('a, button').filter({ hasText: /^Office$/ }).first()
  if (!(await officeCard.count())) {
    note("UX", "marketplace-click", "Office card not clickable")
    return
  }
  await officeCard.click().catch(() => {})
  await page.waitForLoadState("networkidle").catch(() => {})
  if (!page.url().includes("/office")) {
    note("UX", "marketplace-click", `clicked Office, landed at ${page.url()}`)
  }
})

test("journey: onboarding-gated modules", async ({ page }) => {
  await setJwt(page)
  for (const m of ["ai-notes", "opendental-ai", "translate"]) {
    await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/${m}`)
    await page.waitForLoadState("networkidle").catch(() => {})
    const url = page.url()
    if (url.endsWith("/onboarding")) {
      note("UX", `onboarding:${m}`, "redirects to wizard (expected)")
    } else {
      const html = await page.content()
      if (html.includes("Cannot read") || html.includes("undefined")) {
        note("BUG", `onboarding:${m}`, "non-onboarding render error")
      }
    }
  }
})

test("journey: builder save with full data navigates to workflows list", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.locator("input").first().fill(`audit-flow-${Date.now()}`)
  await page.locator("input").nth(1).fill("audit test")
  // Builder requires SQL. Drop a minimal valid one.
  const sqlBox = page.locator("textarea").first()
  if (await sqlBox.count() > 0) {
    await sqlBox.fill("SELECT 1 AS PatNum")
  }
  const saveBtn = page.getByRole("button", { name: /save|create|deploy/i }).first()
  await saveBtn.click().catch(() => {})
  await page.waitForTimeout(3000)
  const url = page.url()
  if (url.includes("/workflows/new")) {
    const html = await page.content()
    // After fix, save should redirect; if still on /new with no error,
    // the user is stuck.
    if (!html.includes("Failed") && !html.includes("error") && !html.includes("required")) {
      note("UX", "builder-save", "stuck on /new with no error — silent failure?")
    }
  }
})

test("journey: marketplace card click — loose selector", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/?demo=1`)
  await page.waitForLoadState("networkidle").catch(() => {})
  // Try multiple selector strategies — what actually rendered?
  const byHref = await page.locator(`a[href*="/office"]`).count()
  const byText = await page.locator('a').filter({ hasText: 'Office' }).count()
  const allAnchors = await page.locator('a').count()
  // eslint-disable-next-line no-console
  console.log(`  [debug] marketplace anchors: total=${allAnchors}, by-href=${byHref}, by-text=${byText}`)
  if (byHref === 0 && byText === 0) {
    note("BUG", "card-link", `marketplace has ${allAnchors} anchors but none link to Office`)
    return
  }
  const officeLink = (byHref ? page.locator(`a[href*="/office"]`) : page.locator('a').filter({ hasText: 'Office' })).first()
  await officeLink.click().catch(() => {})
  await page.waitForLoadState("networkidle").catch(() => {})
  if (!page.url().includes("/office")) {
    note("BUG", "card-link", `Office card clicked but URL is ${page.url()}`)
  }
})

test("journey: clicking Approve on a demo card opens the confirm dialog", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/approvals?demo=1`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const approveBtn = page.getByRole("button", { name: /^Approve · Sawyer/ }).first()
  if (!(await approveBtn.count())) {
    note("UX", "approve-click", "no approve button — demo data not rendering")
    return
  }
  await approveBtn.click().catch(() => {})
  await page.waitForTimeout(800)
  // Base UI AlertDialog uses role="alertdialog" — check both roles.
  const alertDialog = page.getByRole("alertdialog").first()
  const dialog = page.getByRole("dialog").first()
  const hasDialog = (await alertDialog.count()) || (await dialog.count())
  if (!hasDialog) {
    const html = await page.content()
    if (!html.includes("Approve and send") && !html.includes("Sending")) {
      note("UX", "approve-click", "click had no visible feedback")
    }
  }
})

test("journey: workflow Save without SQL surfaces a clear error", async ({ page }) => {
  await setJwt(page)
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.locator("input").first().fill(`audit-${Date.now()}`)
  await page.locator("input").nth(1).fill("audit")
  const saveBtn = page.getByRole("button", { name: /save|create|deploy/i }).first()
  await saveBtn.click().catch(() => {})
  await page.waitForTimeout(2500)
  // The form may navigate (success) OR show an inline error. Accept either.
  const url = page.url()
  if (!url.includes("/workflows/new")) return // navigated → success
  const html = await page.content()
  const errorVisible =
    html.includes("required") || html.includes("Failed") || html.includes("error") ||
    html.includes("SQL is required") || html.includes("triggerSql")
  if (!errorVisible) {
    note("BUG", "builder-error", "save with missing SQL did NOT surface a user-visible error")
  }
})

test("journey: admin login + tenants list", async ({ page }) => {
  await page.goto(`${FRONTEND}/admin`)
  await page.waitForLoadState("networkidle").catch(() => {})
  const passField = page.locator('input[type="password"]')
  if (!(await passField.count())) {
    note("BLOCKER", "admin-login", "no password field")
    return
  }
  await passField.fill(process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000")
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForTimeout(1500)
  const html = await page.content()
  if (!html.includes("Tenants") && !html.includes("tenants")) {
    note("UX", "admin-tenants", "no 'Tenants' heading on admin home")
  }
})
