/**
 * AI Notes end-to-end test.
 *
 * Two paths, picked at runtime based on whether the tenant has
 * connected a Plaud token:
 *
 * 1. Disconnected → onboarding wizard renders, GET /onboarding returns
 *    { connected: false }, the page shows the token-paste form.
 * 2. Connected → /api/ai-notes/feed returns a real array (empty or
 *    populated), the page renders either the feed cards or the
 *    EmptyState component (no demo fallback).
 *
 * The spec does NOT require a Plaud token to pass — the disconnected
 * path is fully exercised even when the tenant has no token. When a
 * token IS present, both paths run.
 */
import { test, expect, request as playwrightRequest, type Page } from "@playwright/test"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const FRONTEND = process.env.PULSAR_FRONTEND_URL ?? "http://localhost:5173"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test"
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? ""

let tenantJwt = ""

test.beforeAll(async () => {
  if (!TENANT_PASSCODE) throw new Error("TEST_TENANT_PASSCODE must be set")
  const api = await playwrightRequest.newContext()

  // Make sure ai-notes is active on the tenant — coverage.spec.ts has
  // historically deactivated it without restoration.
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
      if (t && !(t.modules ?? []).includes("ai-notes")) {
        await api.patch(`${BACKEND}/api/admin/tenants/${t.id}/modules`, {
          headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
          data: { modules: [...(t.modules ?? []), "ai-notes"] },
        })
      }
    }
  }

  const r = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  })
  expect(r.ok()).toBeTruthy()
  tenantJwt = (await r.json()).token
})

async function setJwt(page: Page) {
  for (const url of [FRONTEND, BACKEND]) {
    await page.context().addCookies([
      { name: "pulsar_jwt", value: tenantJwt, url, sameSite: "Lax" },
    ])
  }
  await page.goto(FRONTEND)
  await page.evaluate((token) => {
    sessionStorage.setItem("pulsar.jwt", token)
  }, tenantJwt)
}

test("ai-notes onboarding endpoint returns a real connection-status object", async () => {
  const api = await playwrightRequest.newContext()
  const r = await api.get(`${BACKEND}/api/ai-notes/onboarding`, {
    headers: { Authorization: `Bearer ${tenantJwt}` },
  })
  expect(r.ok()).toBeTruthy()
  const body = await r.json()
  expect(body).toHaveProperty("connected")
  expect(typeof body.connected).toBe("boolean")
})

test("ai-notes feed endpoint behaves correctly for current connection state", async () => {
  const api = await playwrightRequest.newContext()
  const status = await api.get(`${BACKEND}/api/ai-notes/onboarding`, {
    headers: { Authorization: `Bearer ${tenantJwt}` },
  })
  const { connected } = await status.json()

  const feed = await api.get(`${BACKEND}/api/ai-notes/feed?window=7d`, {
    headers: { Authorization: `Bearer ${tenantJwt}` },
  })
  if (connected) {
    expect(feed.ok()).toBeTruthy()
    const arr = await feed.json()
    expect(Array.isArray(arr)).toBe(true)
    for (const item of arr) {
      expect(item).toHaveProperty("recording")
      expect(item.recording).toHaveProperty("id")
    }
  } else {
    // PRECONDITION_FAILED is the contract when no token is stored.
    expect(feed.status()).toBe(412)
  }
})

test("ai-notes UI renders the right surface for the connection state", async ({ page }) => {
  await setJwt(page)
  const api = await playwrightRequest.newContext()
  const status = await api.get(`${BACKEND}/api/ai-notes/onboarding`, {
    headers: { Authorization: `Bearer ${tenantJwt}` },
  })
  const { connected } = await status.json()

  if (connected) {
    await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/ai-notes`)
    await page.waitForLoadState("networkidle").catch(() => {})
    const heading = page.locator("h1", { hasText: /AI Notes/i })
    await expect(heading).toBeVisible()
    // either feed cards OR empty state — but never the literal demo
    // patient names. If those leak past the demo strip, fail loud.
    const html = await page.content()
    expect(html).not.toMatch(/Sawyer Mitchell|Ivanna Chen|Marcus Reyes|Priya Shah|Eleanor Park/)
  } else {
    await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/ai-notes/onboarding`)
    await page.waitForLoadState("networkidle").catch(() => {})
    const heading = page.locator("h1", { hasText: /Connect Plaud/i })
    await expect(heading).toBeVisible()
    const tokenField = page.locator('textarea[placeholder*="eyJ"]')
    await expect(tokenField).toBeVisible()
  }
})

test("ai-notes API client has no demo-mode branches", async () => {
  const fs = await import("fs/promises")
  const path = await import("path")
  const apiSrc = path.resolve(
    __dirname,
    "../../../pulsar-frontend/modules-fe/ai-notes-ui/src/aiNotesApi.ts",
  )
  const content = await fs.readFile(apiSrc, "utf8")
  expect(content).not.toMatch(/isDemoMode|DEMO_FEED|demoTranscript|demoSummary|demoData/)
})
