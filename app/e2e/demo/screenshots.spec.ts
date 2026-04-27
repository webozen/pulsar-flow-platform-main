/**
 * Happy-flow product screenshots, focused on the four shipped modules
 * with real UI:
 *   - Content (5 internal tabs)
 *   - Office (staff directory / scheduling)
 *   - AI Notes (Plaud integration — feed + time windows + onboarding)
 *   - Automation (the flow-platform — multiple surfaces)
 *
 * Skips the empty-state module landing pages that made the previous
 * catalog look repetitive.
 *
 * Output: app/demo-output/stills/<NN-name>.png
 */
import { test, expect, request as playwrightRequest, type Page } from "@playwright/test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const BACKEND = process.env.PULSAR_BACKEND_URL ?? "http://localhost:18080"
const APP = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const FRONTEND = process.env.PULSAR_FRONTEND_URL ?? "http://localhost:5173"
const TENANT_SLUG = process.env.TEST_TENANT_SLUG ?? "acme-dental"
const TENANT_EMAIL = process.env.TEST_TENANT_EMAIL ?? "admin@acme.test"
const TENANT_PASSCODE = process.env.TEST_TENANT_PASSCODE ?? ""
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000"

const STILLS_DIR = path.resolve(__dirname, "../../demo-output/stills")

let tenantJwt = ""

// All modules with shipped frontend UI — activated so the marketplace
// shows them as accessible. Without this, acme-dental can show every
// card greyed out as "NOT ENABLED" (which has happened after running
// coverage.spec.ts which deactivates all modules and doesn't always
// successfully restore them).
const REQUIRED_MODULES = [
  "automation", "scheduling", "content", "ai-notes", "translate",
  "opendental", "opendental-ai", "voice-ringcentral", "text-support",
  "hr", "inventory", "payroll", "invoicing", "call-handling",
]

test.beforeAll(async () => {
  await rm(STILLS_DIR, { recursive: true, force: true })
  await mkdir(STILLS_DIR, { recursive: true })

  if (!TENANT_PASSCODE) {
    throw new Error("TEST_TENANT_PASSCODE must be set (regen via admin API)")
  }
  const api = await playwrightRequest.newContext()

  // Ensure modules are active before we start taking pictures.
  const adminRes = await api.post(`${BACKEND}/api/admin/login`, {
    data: { passcode: ADMIN_PASSCODE },
  })
  expect(adminRes.ok(), "admin login").toBeTruthy()
  const adminToken = (await adminRes.json()).token
  const tenants = await (await api.get(`${BACKEND}/api/admin/tenants`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json() as Array<{ id: number; slug: string; modules: string[] }>
  const t = tenants.find((x) => x.slug === TENANT_SLUG)
  if (!t) throw new Error(`Tenant "${TENANT_SLUG}" not found`)
  const missing = REQUIRED_MODULES.filter((m) => !(t.modules ?? []).includes(m))
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  ↳ activating ${missing.length} missing modules on ${TENANT_SLUG}`)
    await api.patch(`${BACKEND}/api/admin/tenants/${t.id}/modules`, {
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      data: { modules: REQUIRED_MODULES },
    })
  }

  const tlogin = await api.post(`${BACKEND}/api/tenant/login`, {
    data: { slug: TENANT_SLUG, email: TENANT_EMAIL, passcode: TENANT_PASSCODE },
  })
  expect(tlogin.ok(), `tenant login: ${tlogin.status()}`).toBeTruthy()
  tenantJwt = (await tlogin.json()).token
})

async function setJwt(page: Page) {
  // Flow-platform (Next.js, :3002) reads `pulsar_jwt` cookie.
  for (const url of [APP, FRONTEND, BACKEND]) {
    await page.context().addCookies([
      { name: "pulsar_jwt", value: tenantJwt, url, sameSite: "Lax" },
    ])
  }
  // Frontend (Vite/React, :5173) reads sessionStorage['pulsar.jwt'].
  // Must navigate to the origin first so sessionStorage is scoped right.
  await page.goto(FRONTEND, { waitUntil: "domcontentloaded" })
  await page.evaluate(([token]) => {
    try { sessionStorage.setItem("pulsar.jwt", token) } catch {}
  }, [tenantJwt])
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean; settle?: number } = {}) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(opts.settle ?? 900)
  const file = path.join(STILLS_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false })
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}.png`)
}

test("Pulsar — happy-flow product screenshots", async ({ page }) => {
  test.setTimeout(240_000)

  // ── ACT 1 · Identity ───────────────────────────────────────────────
  await page.goto(`${FRONTEND}/login`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await shot(page, "01-login-blank")

  await page.locator("#slug").fill(TENANT_SLUG)
  await page.locator("#email").fill(TENANT_EMAIL)
  await page.locator("#passcode").fill("PULS-XXXX-XXXX")
  await shot(page, "02-login-filled")

  await setJwt(page)

  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/`)
  await shot(page, "03-marketplace-home")

  // ── ACT 2 · Office (staff directory / scheduling) ──────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/office`)
  await shot(page, "10-office-staff-directory")
  // Capture full-page so deck slides can show the full directory at once.
  await shot(page, "11-office-full", { fullPage: true })

  // ── ACT 3 · Content (Knowledge Base) — 4 populated tabs ────────────
  // Demo mode populates guides, contacts, training, files (chat skipped:
  // LLM chat is dynamic and hard to mock convincingly).
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/content?demo=1`)
  await shot(page, "20-content-guides")

  for (const [idx, label, slug] of [
    ["21", "Contacts", "contacts"],
    ["22", "Training", "training"],
    ["23", "Files",    "files"],
  ] as const) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") }).first()
    if (await btn.count() > 0) {
      await btn.click().catch(() => {})
      await shot(page, `${idx}-content-${slug}`)
    }
  }

  // ── ACT 4 · AI Notes (Plaud) ───────────────────────────────────────
  // Connect-Plaud onboarding screen — what a brand-new tenant sees.
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/ai-notes`)
  await shot(page, "30-ai-notes-connect-plaud")

  // Populated feed via demo mode (?demo=1 flips the API to canned
  // recordings — see modules-fe/ai-notes-ui/src/demoData.ts).
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/ai-notes?demo=1`)
  await shot(page, "31-ai-notes-feed-populated", { settle: 1500 })

  // Click the first card's Summary button to expand the AI summary panel.
  const summaryBtn = page.getByRole("button", { name: /Summary/i }).first()
  if (await summaryBtn.count() > 0) {
    await summaryBtn.click().catch(() => {})
    await shot(page, "32-ai-notes-summary-expanded", { settle: 1000 })
  }

  // Click the first card's Transcript button to expand the transcript panel.
  const transcriptBtn = page.getByRole("button", { name: /Transcript/i }).first()
  if (await transcriptBtn.count() > 0) {
    await transcriptBtn.click().catch(() => {})
    await shot(page, "33-ai-notes-transcript-expanded", { settle: 1000 })
  }

  // ── ACT 4b · Calls module (3 sub-routes: caller-match, call-intel, copilot)
  // Caller Match — screen-pop with active patient card + recent calls.
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/call-handling/calls?demo=1`)
  await shot(page, "35-calls-screen-pop", { settle: 1500 })

  // Call Intel — post-call AI summaries list (left) + selected entry (right).
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/call-handling/call-intel?demo=1`)
  await shot(page, "36-call-intel-list", { settle: 1500 })
  // Click the first entry to expand into the detail pane (transcript + action items).
  const firstIntelEntry = page.locator("button").filter({ hasText: /Sawyer|Ivanna|Marcus|Eleanor|\+1401/ }).first()
  if (await firstIntelEntry.count() > 0) {
    await firstIntelEntry.click().catch(() => {})
    await shot(page, "37-call-intel-detail", { settle: 1200 })
  }

  // Co-Pilot — live agent-assist surface (will show empty / waiting state
  // since no active call. Useful to show the UI shell exists.)
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/call-handling/copilot?demo=1`)
  await shot(page, "38-call-copilot", { settle: 1500 })

  // ── ACT 4c · Text Support module (2 sub-routes: messages, insights) ─
  // Text Co-Pilot — SMS inbox + AI-suggested replies.
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/text-support/messages?demo=1`)
  await shot(page, "85-text-copilot-list", { settle: 1500 })
  // Click into a thread to see the conversation.
  const firstTextThread = page.locator("button").filter({ hasText: /401555/ }).first()
  if (await firstTextThread.count() > 0) {
    await firstTextThread.click().catch(() => {})
    await shot(page, "86-text-copilot-thread", { settle: 1200 })
    // Click Suggest to surface the AI-generated reply drafts (the differentiator).
    const suggestBtn = page.getByRole("button", { name: /^Suggest/ }).first()
    if (await suggestBtn.count() > 0) {
      await suggestBtn.click().catch(() => {})
      await shot(page, "87-text-copilot-suggestions", { settle: 1500 })
    }
  }

  // Text Intel — SMS thread summaries with sentiment + intent.
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/text-support/insights?demo=1`)
  await shot(page, "88-text-intel-list", { settle: 1500 })
  const firstIntelThread = page.locator("button").filter({ hasText: /401555/ }).first()
  if (await firstIntelThread.count() > 0) {
    await firstIntelThread.click().catch(() => {})
    await shot(page, "89-text-intel-detail", { settle: 1200 })
  }

  // ── ACT 5b · Invoicing (financial dashboard) ──────────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/invoicing?demo=1`)
  await shot(page, "57-invoicing-dashboard", { settle: 1500 })
  await shot(page, "58-invoicing-full", { fullPage: true, settle: 800 })

  // ── ACT 5c · HR (staff directory + time-off) ──────────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/hr?demo=1`)
  await shot(page, "59-hr-directory", { settle: 1500 })

  // ── ACT 5d · Inventory (supplies + reorder alerts) ────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/inventory?demo=1`)
  await shot(page, "60-inventory-stock", { settle: 1500 })

  // ── ACT 5 · Automation (the flow-platform) ─────────────────────────
  // Dashboard — operational overview tile.
  await page.goto(`${APP}/automation/dashboard`)
  await shot(page, "40-automation-dashboard")
  await shot(page, "41-automation-dashboard-full", { fullPage: true })

  // Workflows list — entry to the per-tenant automations.
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows`)
  await shot(page, "42-workflows-list")

  // Builder progression — the centerpiece sequence.
  await page.goto(`${APP}/automation/clinics/${TENANT_SLUG}/workflows/new`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await shot(page, "43-builder-blank")

  await page.locator("input").first().fill("Recall Reminder")
  await page.locator("input").nth(1).fill("Send a friendly SMS when a patient is due for a cleaning")
  await shot(page, "44-builder-name-typed")

  // Scroll to the trigger / SQL / actions section.
  await page.evaluate(() => window.scrollTo(0, 400))
  await shot(page, "45-builder-trigger-section", { settle: 600 })

  // Full Builder, top to bottom — perfect for a deck slide that shows the
  // whole form in one image.
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, "46-builder-full", { fullPage: true })

  // Approvals queue WITH 4 paused cards (demo mode). THE differentiator
  // screenshot — patient names, appointments, draft SMS, Approve/Skip
  // buttons all visible inline. No need for an "expanded" variant — the
  // card already shows the full SMS preview by default.
  await page.goto(`${APP}/automation/approvals?demo=1`)
  await shot(page, "47-approvals-queue-populated", { settle: 1500 })

  // Try to surface the confirm dialog — clicking Approve should open it.
  const approveBtn = page.getByRole("button", { name: /^Approve · / }).first()
  if (await approveBtn.count() > 0) {
    await approveBtn.click().catch(() => {})
    await page.waitForTimeout(800)
    // Only take the dialog screenshot if a dialog actually appeared.
    const dialog = page.getByRole("dialog").first()
    if (await dialog.count() > 0) {
      await shot(page, "48-approval-confirm-dialog", { settle: 600 })
      const cancelBtn = page.getByRole("button", { name: /^Cancel/ }).first()
      if (await cancelBtn.count() > 0) await cancelBtn.click().catch(() => {})
    }
  }

  // Conversations — populated SMS thread list.
  await page.goto(`${APP}/automation/conversations?demo=1`)
  await shot(page, "50-conversations-list", { settle: 1500 })

  // Click into the first thread to show the message history view.
  const firstThread = page.locator('[data-testid^="thread-"], button:has-text("+1401")').first()
  if (await firstThread.count() > 0) {
    await firstThread.click().catch(() => {})
    await shot(page, "51-conversation-thread", { settle: 1000 })
  }

  // ── ACT 5e · Payroll (sales preview UI) ───────────────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/payroll?demo=1`)
  await shot(page, "61-payroll-dashboard", { settle: 1500 })
  await shot(page, "62-payroll-full", { fullPage: true, settle: 800 })

  // ── ACT 5f · OpenDental Sync (status + activity) ──────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/opendental?demo=1`)
  await shot(page, "63-opendental-sync", { settle: 1500 })

  // ── ACT 5g · Ask AI (OpenDental AI — Gemini Live chat) ────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/opendental-ai?demo=1`)
  await shot(page, "65-ask-ai-conversation", { settle: 2000 })
  // Switch to the Audit log tab to surface tool-call rows (the AI's
  // grounded SQL queries — important for compliance pitch).
  const auditTab = page.getByRole("button", { name: /Audit log/i }).first()
  if (await auditTab.count() > 0) {
    await auditTab.click().catch(() => {})
    await shot(page, "66-ask-ai-audit", { settle: 1200 })
  }

  // ── ACT 5h · Translate (real-time bilingual kiosk) ────────────────
  await page.goto(`${FRONTEND}/t/${TENANT_SLUG}/translate?demo=1`)
  await shot(page, "68-translate-kiosk", { settle: 2000 })
  await shot(page, "69-translate-kiosk-full", { fullPage: true, settle: 800 })

  // ── ACT 6 · Admin lens (operator view) ─────────────────────────────
  // Skip the admin-login form (it's a one-input login screen) and go
  // straight to the multi-tenant list — useful for DSO / multi-location
  // pitches.
  await page.context().clearCookies()
  await page.goto(`${FRONTEND}/admin`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.locator('input[type="password"]').fill(ADMIN_PASSCODE)
  await page.getByRole("button", { name: /sign in/i }).click().catch(() => {})
  await page.waitForTimeout(1500)
  await shot(page, "70-admin-tenants")
})
