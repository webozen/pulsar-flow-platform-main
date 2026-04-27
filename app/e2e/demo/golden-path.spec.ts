/**
 * Demo-video golden path. Walks the most compelling product moments in
 * the order a non-technical dental practice manager would experience
 * them on first use. Every `waitForTimeout` is a deliberate pause so
 * voice-over has time to land — feel free to nudge.
 *
 * Cleanup is best-effort in afterAll so re-running yields a clean
 * recording every time.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const APP = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"

const DEMO_WF_NAME = "Recall Reminder (Demo)"
const DEMO_WF_DESC = "Sends a friendly SMS when a patient is due for a cleaning"

let tenantJwt = ""

test.beforeAll(async () => {
  // Admin login → impersonate target tenant → bank the JWT for the spec.
  const api = await playwrightRequest.newContext()
  const adminRes = await api.post(`${BACKEND}/api/admin/login`, { data: { passcode: ADMIN_PASSCODE } })
  expect(adminRes.ok(), "admin login").toBeTruthy()
  const adminToken = (await adminRes.json()).token

  const tenantsRes = await api.get(`${BACKEND}/api/admin/tenants`, { headers: { Authorization: `Bearer ${adminToken}` } })
  const tenants = (await tenantsRes.json()) as Array<{ id: number; slug: string }>
  const t = tenants.find((x) => x.slug === TENANT_SLUG)
  if (!t) throw new Error(`Tenant "${TENANT_SLUG}" not found`)
  const impRes = await api.post(`${BACKEND}/api/admin/tenants/${t.id}/impersonate`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  expect(impRes.ok(), "impersonate").toBeTruthy()
  tenantJwt = (await impRes.json()).token

  // Best-effort: remove any prior copy of the demo workflow so the save
  // shows a clean Builder → list transition.
  try {
    const r = await api.get(`${APP}/automation/api/workflows`, {
      headers: { Cookie: `pulsar_jwt=${tenantJwt}` },
    })
    if (r.ok()) {
      const list = (await r.json()) as Array<{ id?: string; name?: string }>
      for (const w of list) {
        if (w.name === DEMO_WF_NAME && w.id) {
          await api.delete(`${APP}/automation/api/workflows/${w.id}`, {
            headers: { Cookie: `pulsar_jwt=${tenantJwt}` },
          })
        }
      }
    }
  } catch { /* non-fatal */ }
})

test("Pulsar — golden path demo", async ({ page, context }) => {
  await context.addCookies([{ name: "pulsar_jwt", value: tenantJwt, url: APP, sameSite: "Lax" }])

  // ── Scene 1: Dashboard tour ─────────────────────────────────────
  // VO: "When a practice opens Pulsar, they see at a glance what's running."
  await page.goto(`${APP}/automation/dashboard`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2500)

  // ── Scene 2: Open the workflows list ────────────────────────────
  // VO: "Workflows are the automations the practice has set up."
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2500)

  // ── Scene 3: Build a new workflow ───────────────────────────────
  // VO: "Adding a new automation takes about a minute."
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)

  const nameInput = page.locator("input").first()
  await nameInput.click()
  await nameInput.pressSequentially(DEMO_WF_NAME, { delay: 60 })
  await page.waitForTimeout(800)

  const descInput = page.locator("input").nth(1)
  await descInput.click()
  await descInput.pressSequentially(DEMO_WF_DESC, { delay: 40 })
  await page.waitForTimeout(1200)

  // ── Scene 4: Save → workflow appears in the list ────────────────
  // The Save button label varies; match by accessible role.
  const saveBtn = page.getByRole("button", { name: /save|create|deploy/i }).first()
  if (await saveBtn.count() > 0) {
    await saveBtn.click()
    await page.waitForTimeout(2000)
  }

  // ── Scene 5: Show approvals queue ───────────────────────────────
  // VO: "When a workflow is gated for human approval, requests land here."
  await page.goto(`${APP}/automation/approvals`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(3000)

  // ── Scene 6: Settings glance (branding/identity) ────────────────
  // Hold the camera here long enough to read the practice name.
  await page.goto(`${APP}/automation/dashboard`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2500)
})

test.afterAll(async () => {
  // Best-effort teardown: remove the workflow created during the demo
  // so the next run starts from the same state.
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
