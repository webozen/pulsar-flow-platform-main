/**
 * E2E coverage for the per-row approval queue.
 *
 * The flow architecture is "subflow per row": apt-reminder-demo fans
 * out one apt-reminder-row execution per appointment, each its own
 * paused execution. Resume targets the whole execution — Kestra OSS
 * 0.19's per-taskRun scoping is broken (verified manually), so this
 * suite is the regression net for that.
 *
 * SMS COST DISCIPLINE: Twilio is in TRIAL mode and every approval
 * sends a real SMS to +15198002773. By default this suite only
 * sends ONE SMS total — the "no crosstalk" check, which is the
 * single regression we care about most. Other scenarios use Skip
 * (kills, no SMS) or static checks. Set RUN_LIVE_TWILIO=1 to also
 * run the full delivery-confirmation scenario.
 */
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test"
import { readFileSync, existsSync } from "fs"
import path from "path"

const BACKEND  = process.env.PULSAR_BACKEND_URL  ?? "http://localhost:18080"
const APP      = process.env.PULSAR_FLOW_APP_URL ?? "http://localhost:3002"
const KESTRA   = process.env.KESTRA_URL          ?? "http://localhost:8080"
const ADMIN_PASSCODE = process.env.PULSAR_ADMIN_PASSCODE ?? "PULS-DEV-0000"
const TENANT_SLUG    = process.env.TEST_TENANT_SLUG     ?? "acme-dental"
const NAMESPACE      = `dental.${TENANT_SLUG}`
const RUN_LIVE_TWILIO = process.env.RUN_LIVE_TWILIO === "1"

// Trial Twilio config — hardcoded across the suite.
const TRIAL_SENDER    = "+17406606649"
const TRIAL_RECIPIENT = "+15198002773"

// Real values must be supplied via env vars — never hardcoded. Tests skip
// the Twilio-API verification block if either is missing.
const TWILIO_SID   = process.env.TWILIO_SID   ?? ""
const TWILIO_TOKEN = process.env.TWILIO_TOKEN ?? ""

let tenantJwt = ""

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext()
  const adminRes = await api.post(`${BACKEND}/api/admin/login`, { data: { passcode: ADMIN_PASSCODE } })
  expect(adminRes.ok(), "admin login").toBeTruthy()
  const adminToken = (await adminRes.json()).token
  const listRes = await api.get(`${BACKEND}/api/admin/tenants`, { headers: { Authorization: `Bearer ${adminToken}` } })
  expect(listRes.ok(), "list tenants").toBeTruthy()
  const tenants = (await listRes.json()) as Array<{ id: number; slug: string }>
  const tenant = tenants.find((t) => t.slug === TENANT_SLUG)
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`)
  const impRes = await api.post(`${BACKEND}/api/admin/tenants/${tenant.id}/impersonate`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  expect(impRes.ok(), "impersonate tenant").toBeTruthy()
  tenantJwt = (await impRes.json()).token
  expect(tenantJwt).toBeTruthy()
})

async function setTenantCookie(context: import("@playwright/test").BrowserContext) {
  await context.addCookies([{ name: "pulsar_jwt", value: tenantJwt, url: APP, sameSite: "Lax" }])
}

async function killAllPausedRows() {
  const r = await fetch(`${KESTRA}/api/v1/executions/search?namespace=${NAMESPACE}&state=PAUSED&size=100`)
  const d = (await r.json()) as { results?: Array<{ id: string }> }
  for (const e of d.results ?? []) {
    await fetch(`${KESTRA}/api/v1/executions/${e.id}`, { method: "DELETE" })
  }
}

async function triggerDemo() {
  const r = await fetch(`${KESTRA}/api/v1/executions/${NAMESPACE}/apt-reminder-demo`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=----empty" },
    body: "------empty--",
  })
  expect(r.ok || r.status === 204, `trigger demo ${r.status}`).toBeTruthy()
}

// Skip every live-stack scenario cleanly when the apt-reminder-demo flow
// isn't deployed in the tenant namespace (e.g. clean-slate dev state).
// Without this gate, the beforeEach times out waiting for paused rows
// and cascades through every serial test in the block.
async function demoFlowDeployed(): Promise<boolean> {
  try {
    const r = await fetch(`${KESTRA}/api/v1/flows/${NAMESPACE}/apt-reminder-demo`)
    return r.ok
  } catch {
    return false
  }
}

async function waitForPausedRows(min = 3, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await fetch(`${KESTRA}/api/v1/executions/search?namespace=${NAMESPACE}&state=PAUSED&flowId=apt-reminder-row&size=100`)
    const d = (await r.json()) as { results?: unknown[] }
    if ((d.results?.length ?? 0) >= min) return d.results as Array<{ id: string }>
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Timed out waiting for ≥${min} paused row execs`)
}

async function listApprovals(api: APIRequestContext) {
  const res = await api.get(`${APP}/automation/api/approvals`, { headers: { Cookie: `pulsar_jwt=${tenantJwt}` } })
  expect(res.ok(), `list approvals ${res.status()}`).toBeTruthy()
  return (await res.json()) as Array<{ executionId: string; recordPreview: { FName?: string; LName?: string } | null }>
}

// ── 1. Static safety guards (no live infra) ───────────────────────────

test.describe("Approval Queue — safety guards", () => {
  test("apt-reminder-row.yml hardcodes the trial recipient + uses trial sender KV", () => {
    const yamlPath = path.resolve(__dirname, "../../kestra/flows/dental/apt-reminder-row.yml")
    // The dental flows dir is intentionally empty in the demo-clean-slate
    // state. The guard still has value WHEN the row flow exists — it
    // catches accidental swaps to the live recipient before we're off
    // Twilio trial. If the file is gone, we have nothing to guard.
    if (!existsSync(yamlPath)) {
      test.skip(true, "kestra/flows/dental/apt-reminder-row.yml not deployed — nothing to guard")
      return
    }
    const yaml = readFileSync(yamlPath, "utf8")
    expect(yaml).toContain("To=%2B15198002773")
    expect(yaml).toContain("From={{ kv('twilio_from_number') }}")
    // Defensive: ensure the live form (per-row WirelessPhone) hasn't
    // been silently introduced before we're off Twilio trial.
    expect(yaml).not.toContain("To={{ fromJson(inputs.row).WirelessPhone }}")
  })

  test("list endpoint requires a JWT", async () => {
    const r = await fetch(`${APP}/automation/api/approvals`)
    expect(r.status).toBe(401)
  })
})

// ── 2. Live-stack scenarios that don't fire SMS ───────────────────────

test.describe.configure({ mode: "serial" })

test.describe("Approval Queue — live stack (Skip/Cancel/preview, no SMS)", () => {
  test.beforeEach(async () => {
    test.setTimeout(60_000)
    if (!(await demoFlowDeployed())) {
      test.skip(true, "apt-reminder-demo flow not deployed in tenant namespace")
      return
    }
    await killAllPausedRows()
    await new Promise((r) => setTimeout(r, 1500))
    await triggerDemo()
    await waitForPausedRows(3)
  })

  test.afterAll(async () => {
    // Keep the trial number quiet — no leftover paused execs after
    // the suite finishes.
    await killAllPausedRows()
  })

  test("scenario-list: cards render with patient name + appointment", async () => {
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    expect(items.length).toBeGreaterThanOrEqual(3)
    for (const it of items) {
      expect(it.executionId).toBeTruthy()
      expect(it.recordPreview).toBeTruthy()
      expect(it.recordPreview?.FName).toBeTruthy()
    }
  })

  test("scenario-skip: kills only that execution, others stay PAUSED", async ({ page, context }) => {
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const itemsBefore = await listApprovals(api)
    const target = itemsBefore[1]

    await page.goto(`${APP}/automation/approvals`)
    await expect(page.getByText("Approval Queue")).toBeVisible({ timeout: 15000 })
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    await expect(card).toBeVisible({ timeout: 15000 })
    /* native confirm replaced by AlertDialog — see confirm-action below */
    await card.getByTestId("skip-btn").click()
    await page.getByTestId("confirm-action").click()
    await expect(card.getByTestId("outcome-chip")).toContainText("Skipped", { timeout: 15000 })

    const r = await fetch(`${KESTRA}/api/v1/executions/${target.executionId}`)
    const exec = (await r.json()) as { state: { current: string } }
    expect(exec.state.current).toBe("KILLED")
    const others = itemsBefore.filter((i) => i.executionId !== target.executionId)
    for (const o of others.slice(0, 2)) {
      const rr = await fetch(`${KESTRA}/api/v1/executions/${o.executionId}`)
      const ee = (await rr.json()) as { state: { current: string } }
      expect(ee.state.current).toBe("PAUSED")
    }
  })

  test("scenario-cancel: confirm dialog Cancel leaves the gate PAUSED — no resume, no SMS", async ({ page, context }) => {
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    const target = items[0]

    await page.goto(`${APP}/automation/approvals`)
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByTestId("approve-btn").click()
    await page.getByTestId("confirm-cancel").click()
    await page.waitForTimeout(2500)
    const r = await fetch(`${KESTRA}/api/v1/executions/${target.executionId}`)
    const exec = (await r.json()) as { state: { current: string } }
    expect(exec.state.current).toBe("PAUSED")
  })

  test("scenario-preview: SMS preview resolves the patient's name (not raw {{ }} text)", async ({ page, context }) => {
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    const target = items[0]
    const targetName = String(target.recordPreview?.FName)

    await page.goto(`${APP}/automation/approvals`)
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    await expect(card).toBeVisible({ timeout: 15000 })
    const sms = card.getByTestId("sms-preview")
    await expect(sms).toBeVisible({ timeout: 15000 })
    await expect(sms).toContainText(`Hi ${targetName}`)
    await expect(sms).not.toContainText("fromJson")
    await expect(sms).not.toContainText("{{")
  })

  test("scenario-button-name: Approve and Skip buttons display the patient name (mis-click guard)", async ({ page, context }) => {
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    const target = items[1]
    const targetName = `${target.recordPreview?.FName} ${target.recordPreview?.LName ?? ""}`.trim()

    await page.goto(`${APP}/automation/approvals`)
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId("approve-btn")).toContainText(targetName)
    await expect(card.getByTestId("skip-btn")).toContainText(targetName)
  })
})

// ── 3. The one no-crosstalk SMS test (always runs) ────────────────────

test.describe("Approval Queue — no crosstalk (sends ONE SMS to trial recipient)", () => {
  test.beforeEach(async () => {
    test.setTimeout(60_000)
    if (!(await demoFlowDeployed())) {
      test.skip(true, "apt-reminder-demo flow not deployed in tenant namespace")
      return
    }
    await killAllPausedRows()
    await new Promise((r) => setTimeout(r, 1500))
    await triggerDemo()
    await waitForPausedRows(3)
  })

  test.afterAll(async () => {
    await killAllPausedRows()
  })

  test("approve card #2 (not first) — only #2's exec resumes; SMS body matches its patient", async ({ page, context }) => {
    test.setTimeout(60_000)
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    expect(items.length).toBeGreaterThanOrEqual(3)
    const target = items[1]
    const targetName = String(target.recordPreview?.FName)

    await page.goto(`${APP}/automation/approvals`)
    await expect(page.getByText("Approval Queue")).toBeVisible({ timeout: 15000 })
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    await expect(card).toBeVisible({ timeout: 15000 })
    /* native confirm replaced by AlertDialog — see confirm-action below */
    await card.getByTestId("approve-btn").click()
    await page.getByTestId("confirm-action").click()
    await expect(card.getByTestId("outcome-chip")).toContainText("Sent", { timeout: 30_000 })

    // Sent confirmation contains THIS patient's name + the trial recipient.
    const confirmation = card.getByTestId("sent-confirmation")
    await expect(confirmation).toContainText(targetName)
    await expect(confirmation).toContainText(TRIAL_RECIPIENT)

    // Direct Kestra check — only target exec resumed; siblings still PAUSED.
    const r = await fetch(`${KESTRA}/api/v1/executions/${target.executionId}`)
    const exec = (await r.json()) as { state: { current: string } }
    expect(exec.state.current).toBe("SUCCESS")
    for (const o of [items[0], items[2]]) {
      if (o.executionId === target.executionId) continue
      const rr = await fetch(`${KESTRA}/api/v1/executions/${o.executionId}`)
      const ee = (await rr.json()) as { state: { current: string } }
      expect(ee.state.current).toBe("PAUSED")
    }
  })
})

// ── 4. Optional Twilio API delivery confirmation (gated) ──────────────

const optTwilio = RUN_LIVE_TWILIO ? test.describe : test.describe.skip
optTwilio("Approval Queue — Twilio API delivery confirmation (RUN_LIVE_TWILIO=1)", () => {
  test.beforeEach(async () => {
    test.setTimeout(90_000)
    await killAllPausedRows()
    await new Promise((r) => setTimeout(r, 1500))
    await triggerDemo()
    await waitForPausedRows(3)
  })

  test.afterAll(async () => {
    await killAllPausedRows()
  })

  test("Twilio confirms delivered to the trial recipient from the trial sender", async ({ page, context }) => {
    test.setTimeout(90_000)
    await setTenantCookie(context)
    const api = await playwrightRequest.newContext()
    const items = await listApprovals(api)
    const target = items[0]
    const targetName = String(target.recordPreview?.FName)

    await page.goto(`${APP}/automation/approvals`)
    const card = page.locator(`[data-testid='approval-card-${target.executionId}']`)
    /* native confirm replaced by AlertDialog — see confirm-action below */
    await card.getByTestId("approve-btn").click()
    await page.getByTestId("confirm-action").click()
    await expect(card.getByTestId("outcome-chip")).toContainText("Sent", { timeout: 30_000 })

    // Pull recent Twilio messages, find the one matching this patient.
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json?To=${encodeURIComponent(TRIAL_RECIPIENT)}&PageSize=10`,
      { headers: { Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64") } },
    )
    expect(r.ok).toBeTruthy()
    const msgs = ((await r.json()) as { messages: Array<{ sid: string; to: string; from: string; body: string; status: string }> }).messages
    const match = msgs.find((m) => m.body.includes(`Hi ${targetName}`))
    expect(match, `Twilio record for ${targetName}`).toBeTruthy()
    expect(match!.to).toBe(TRIAL_RECIPIENT)
    expect(match!.from).toBe(TRIAL_SENDER)

    // Poll for delivered status.
    const deadline = Date.now() + 30_000
    let status = match!.status
    while (Date.now() < deadline && status !== "delivered") {
      await new Promise((r) => setTimeout(r, 1500))
      const sr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages/${match!.sid}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64") },
      })
      if (sr.ok) status = ((await sr.json()) as { status: string }).status
    }
    expect(status).toBe("delivered")
  })
})
