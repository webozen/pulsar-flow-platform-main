/**
 * E2E coverage for the Edit Workflow page.
 *
 * Builder/Summary asserts that targeted the legacy `appointment-reminder`
 * single-execution flow were removed: that flow was replaced by the
 * subflow-per-row pair (`apt-reminder-demo` + `apt-reminder-row`) during
 * the Kestra-resume bug workaround, and the dental flows directory was
 * cleaned to a blank slate. The remaining asserts pin URL-safety
 * (stale-UUID → JWT-slug redirect) and the approval detail API shape.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const APP = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"

let tenantJwt = ""

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext()
  const adminRes = await api.post(`${BACKEND}/api/admin/login`, { data: { passcode: ADMIN_PASSCODE } })
  expect(adminRes.ok()).toBeTruthy()
  const adminToken = (await adminRes.json()).token
  const listRes = await api.get(`${BACKEND}/api/admin/tenants`, { headers: { Authorization: `Bearer ${adminToken}` } })
  expect(listRes.ok()).toBeTruthy()
  const tenants = (await listRes.json()) as Array<{ id: number; slug: string }>
  const tenant = tenants.find((t) => t.slug === TENANT_SLUG)
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`)
  const impRes = await api.post(`${BACKEND}/api/admin/tenants/${tenant.id}/impersonate`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  expect(impRes.ok()).toBeTruthy()
  tenantJwt = (await impRes.json()).token
  expect(tenantJwt).toBeTruthy()
})

async function setTenantCookie(context: import("@playwright/test").BrowserContext) {
  await context.addCookies([{ name: "pulsar_jwt", value: tenantJwt, url: APP, sameSite: "Lax" }])
}

test.describe("Edit Workflow — URL safety", () => {
  test("stale UUID URL redirects to the JWT slug", async ({ page, context }) => {
    await setTenantCookie(context)
    const STALE_UUID = "4f7b78bc-8cc7-45c2-a9f4-284d7a11bfdd"
    await page.goto(`${APP}/automation/clinics/${STALE_UUID}/workflows`, { waitUntil: "networkidle" })
    await expect(page).toHaveURL(new RegExp(`/clinics/${TENANT_SLUG}/workflows$`), { timeout: 10000 })
    await page.goto(`${APP}/automation/clinics/${STALE_UUID}/workflows/appointment-reminder`, { waitUntil: "networkidle" })
    await expect(page).toHaveURL(new RegExp(`/clinics/${TENANT_SLUG}/workflows$`), { timeout: 10000 })
  })
})

test.describe("Approvals — recordData + action previews", () => {
  test("expanded approval surfaces patient row and full batch", async ({ request }) => {
    // API-level check (UI for this flow lives in /approvals; expansion
    // calls /api/approvals/{id}/detail which is what we pin here).
    const apiCtx = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `pulsar_jwt=${tenantJwt}` },
    })
    const list = await apiCtx.get(`${APP}/automation/api/approvals`)
    expect(list.ok()).toBeTruthy()
    const items = (await list.json()) as Array<{
      id: string; executionId?: string; namespace: string;
      recordPreview?: Record<string, unknown> | null
    }>
    if (items.length === 0) {
      test.skip(true, "No paused executions — trigger apt-reminder-demo first.")
      return
    }
    expect(items[0].recordPreview).toBeTruthy()
    const execId = items[0].executionId ?? items[0].id.split(":")[0]
    const detail = await apiCtx.get(`${APP}/automation/api/approvals/${execId}/detail`)
    expect(detail.ok()).toBeTruthy()
    const body = await detail.json()
    expect(body.recordData).toBeTruthy()
    expect(typeof body.recordData).toBe("object")
    // Real Growing Smiles data: appointment row has these field keys.
    expect(Object.keys(body.recordData).join(",")).toMatch(/AptNum|FName|WirelessPhone/)
    // The detail route also exposes per-action previews (rendered SMS body etc.).
    expect(Array.isArray(body.actionPreviews)).toBe(true)
    // Suppress unused-binding lint: `request` arg is required by Playwright fixture
    void request
  })
})
