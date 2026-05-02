import { test, expect, request as playwrightRequest } from '@playwright/test'

const FRONTEND = 'http://localhost:5173'
const BACKEND  = 'http://localhost:18080'

const TENANT_SLUG     = process.env.TEST_TENANT_SLUG     ?? 'acme-dental'
const TENANT_EMAIL    = process.env.TEST_TENANT_EMAIL    ?? 'admin@acme.test'
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? ''
const ADMIN_PASSCODE  = process.env.PULSAR_ADMIN_PASSCODE ?? 'PULS-DEV-0000'

const PARKED_IDS = ['text-support','text-intel','text-copilot','invoicing','hr','inventory','payroll']

let tenantJwt = ''

test.beforeAll(async () => {
  if (!TENANT_PASSCODE) {
    // try to get a fresh passcode via admin
    const api = await playwrightRequest.newContext()
    const adminLogin = await api.post(`${BACKEND}/api/admin/login`, {
      data: { passcode: ADMIN_PASSCODE }
    })
    if (adminLogin.ok()) {
      const { token: adminToken } = await adminLogin.json()
      const tenants = await api.get(`${BACKEND}/api/admin/tenants`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
      const list = await tenants.json()
      const tenant = list.find((t: any) => t.slug === TENANT_SLUG)
      if (tenant) {
        const pc = await api.post(`${BACKEND}/api/admin/tenants/${tenant.id}/passcode`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        })
        const { passcode } = await pc.json()
        const tlogin = await api.post(`${BACKEND}/api/tenant/login`, {
          data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode }
        })
        if (tlogin.ok()) tenantJwt = (await tlogin.json()).token
      }
    }
  } else {
    const api = await playwrightRequest.newContext()
    const r = await api.post(`${BACKEND}/api/tenant/login`, {
      data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE }
    })
    if (r.ok()) tenantJwt = (await r.json()).token
  }
  if (!tenantJwt) throw new Error('Could not get tenant JWT')
})

test('Marketplace: parked modules show TODO badge', async ({ page }) => {
  await page.context().addCookies([
    { name: 'pulsar_jwt', value: tenantJwt, url: FRONTEND, sameSite: 'Lax' }
  ])
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`, { waitUntil: 'networkidle' })

  // Yellow banner should be visible
  const banner = page.locator('text=need backend integration')
  await expect(banner).toBeVisible({ timeout: 8000 })
  console.log('✅ Parked modules banner visible')

  // Each parked module card should have a TODO pill
  const todoBadges = page.locator('text=TODO')
  const count = await todoBadges.count()
  console.log(`✅ TODO badges visible: ${count}`)
  expect(count).toBeGreaterThan(0)
})

test('Admin: automation-sync NOT in module catalog', async ({ page }) => {
  // Login as admin
  await page.goto(`${FRONTEND}/admin`, { waitUntil: 'networkidle' })
  await page.locator('input[type="password"]').fill(ADMIN_PASSCODE)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 8000 })

  // Navigate to a tenant detail page
  const firstTenantLink = page.locator('a').filter({ hasText: /acme/i }).first()
  await firstTenantLink.click()
  await page.waitForTimeout(2000)

  // Check that automation-sync is NOT shown
  const syncLabel = page.locator('text=Automation Sync')
  const visible = await syncLabel.isVisible().catch(() => false)
  if (visible) {
    console.log('❌ Automation Sync still visible in admin!')
  } else {
    console.log('✅ Automation Sync NOT visible in admin module list')
  }
  await expect(syncLabel).not.toBeVisible()
})
