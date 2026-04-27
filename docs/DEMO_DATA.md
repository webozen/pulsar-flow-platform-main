---
status: live — DO NOT ship to prod without addressing this list
last-updated: 2026-04-26
production-progress:
  - ai-notes (DONE 2026-04-26)
  - caller-match (DONE 2026-04-26)
  - approvals (DONE 2026-04-26)
  - conversations (DONE 2026-04-26)
  - content (DONE 2026-04-26)
  - translate (DONE 2026-04-26)
  - opendental-ai (DONE 2026-04-26)
  - call-intel (DONE 2026-04-26)
  - text-intel (DONE 2026-04-26 — BigInteger cast bug fixed)
  - text-copilot (DONE 2026-04-26)
---
# Demo / Mock Data Inventory

> **Why this file exists:** during the sales-pitch screenshot work we
> seeded mock fixtures across multiple modules so empty UIs would show
> realistic content. **None of this data is sourced from real APIs** —
> it's hand-written fixtures activated by a `?demo=1` URL query param.
> Before any production deploy, every entry below must be either
> removed, gated behind a feature flag, or replaced with real data.

## Activation convention

Mock data activates **only when the URL contains `?demo=1`**. Each
module reads it via a local `isDemoMode()` helper that checks the
browser query string. Production users — who do not pass `?demo=1` —
get the real API path unchanged.

The `TenantShell` (frontend) was modified so `?demo=1` *also*
bypasses the onboarding redirect, allowing populated module pages to
render even on tenants that haven't completed onboarding.

## Files added (all are NEW)

### pulsar-frontend (Vite/React SPA)

| File | Purpose | Production action |
|------|---------|-------------------|
| ~~`modules-fe/ai-notes-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Module is now production-real. | — |
| ~~`modules-fe/caller-match-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Module is now production-real. | — |
| ~~`modules-fe/content-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Module is now production-real. | — |
| ~~`modules-fe/crm-ui/src/demoData.ts`~~ | ✅ MODULE DELETED entirely 2026-04-26 (CRM scrapped — re-introduce later if needed). | — |
| `modules-fe/invoicing-ui/src/demoData.ts` | 8 invoices + 6-month revenue history | Delete file; restore HomePage to `ModuleStubPage` only |
| `modules-fe/hr-ui/src/demoData.ts` | 7 staff + 3 time-off requests | Delete file; restore HomePage to `ModuleStubPage` only |
| `modules-fe/inventory-ui/src/demoData.ts` | 10 supplies with reorder status | Delete file; restore HomePage to `ModuleStubPage` only |
| ~~`modules-fe/call-intel-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Live: synthetic transcript → real Gemini summary + intent + action items. | — |
| ~~`modules-fe/text-intel-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Live: real SMS thread → Gemini summarization. BigInteger cast bug fixed. | — |
| ~~`modules-fe/text-copilot-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Live: 2 Gemini-drafted reply suggestions returned. | — |
| `modules-fe/payroll-ui/src/demoData.ts` | 4 pay periods + 7 employee earnings rows. **Note: Payroll backend NOT YET BUILT — this UI is sales-preview only.** | Delete file; restore HomePage to `ModuleStubPage`; build real payroll backend before going live |
| `modules-fe/opendental-ui/src/demoData.ts` | Sync status snapshot + 7 sync events | Delete file; restore HomePage to `ModuleStubPage` only |
| ~~`modules-fe/opendental-ai-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. ChatPage uses wsState directly. Audio-input only — live test deferred (same constraint as Translate). | — |
| ~~`modules-fe/translate-ui/src/demoData.ts`~~ | ✅ DELETED 2026-04-26. Module is now production-real. ConversationKiosk seeds reverted to literals; TranslatePage throws on missing VITE_WS_URL. | — |

### pulsar-flow-platform-main (Next.js)

| File | Purpose | Production action |
|------|---------|-------------------|
| ~~`app/src/lib/demo-mode.ts`~~ | ✅ DELETED 2026-04-26. Both consumers (Approvals + Conversations) now hit real APIs. | — |

## Files modified (existing files with demo branches added)

### pulsar-frontend

| File | What was added | Production action |
|------|----------------|-------------------|
| ~~`modules-fe/ai-notes-ui/src/aiNotesApi.ts`~~ | ✅ Demo branches removed 2026-04-26. Now hits real APIs only. | — |
| ~~`modules-fe/caller-match-ui/src/callerMatchApi.ts`~~ | ✅ Demo branches removed 2026-04-26. Now hits real APIs only. | — |
| ~~`modules-fe/caller-match-ui/src/CallerMatchPage.tsx`~~ | ✅ Demo short-circuit removed 2026-04-26. SSE always live. | — |
| ~~`modules-fe/content-ui/src/contentApi.ts`~~ | ✅ Demo branches removed 2026-04-26. Real `/api/content/*` only. | — |
| ~~`modules-fe/call-intel-ui/src/callIntelApi.ts`~~ | ✅ Demo branches removed 2026-04-26. | — |
| ~~`modules-fe/text-intel-ui/src/textIntelApi.ts`~~ | ✅ Demo branches removed 2026-04-26. | — |
| ~~`modules-fe/text-copilot-ui/src/textCopilotApi.ts`~~ | ✅ Demo branches removed 2026-04-26. | — |
| ~~`modules-fe/crm-ui/src/HomePage.tsx`~~ | ✅ MODULE DELETED entirely 2026-04-26. | — |
| `modules-fe/invoicing-ui/src/HomePage.tsx` | Forks to populated InvoicingDemoView when `?demo=1` | Restore to single `ModuleStubPage` return |
| `modules-fe/hr-ui/src/HomePage.tsx` | Forks to populated HrDemoView when `?demo=1` | Restore to single `ModuleStubPage` return |
| `modules-fe/inventory-ui/src/HomePage.tsx` | Forks to populated InventoryDemoView when `?demo=1` | Restore to single `ModuleStubPage` return |
| `apps/web/src/shells/TenantShell.tsx` | `?demo=1` in addition to `?edit=1` bypasses `findOnboardingRedirect` | Remove the `demoMode` line and the OR clause in `redirectTarget` |

### pulsar-flow-platform-main

| File | What was added | Production action |
|------|----------------|-------------------|
| ~~`app/src/app/approvals/page.tsx`~~ | ✅ Demo branches removed 2026-04-26. Both `load()` and `loadDetail()` now hit real APIs only. Regression-guarded by `__tests__/no-demo-branch.test.ts`. | — |
| ~~`app/src/app/conversations/page.tsx`~~ | ✅ Demo branches removed 2026-04-26. Real `/api/conversations` only. Regression-guarded by `__tests__/no-demo-branch.test.ts`. | — |

## Files used for screenshots — not demo data, just UI fixtures in tests

| File | Purpose |
|------|---------|
| `app/e2e/demo/screenshots.spec.ts` | Playwright spec that navigates to `?demo=1` URLs and captures screenshots |
| `app/e2e/demo/golden-path.spec.ts` | Short demo recording spec |
| `app/e2e/demo/full-tour.spec.ts` | Long demo recording spec |
| `app/playwright.demo.config.ts` | 1080p config for demo recordings |
| `app/scripts/build-demo-video.sh` | Composer script |

These are dev/test artifacts and don't ship to production — but if a CI
test ever depends on `?demo=1` data, that's a smell. Tests should
exercise real APIs, not the demo branches.

## Pre-production cleanup checklist

When the time comes to remove demo data:

1. [ ] Search for `isDemoMode()` across both repos:
   ```sh
   grep -rn "isDemoMode" pulsar-frontend/ pulsar-flow-platform-main/app/src/
   ```
   Every callsite must be removed (or moved behind a feature flag if
   the populated empty-state UX is to be preserved as a real feature).

2. [ ] Delete the four `demoData.ts` files (paths in tables above).

3. [ ] Delete `app/src/lib/demo-mode.ts`.

4. [ ] Remove the `?demo=1` bypass in `TenantShell.tsx`.

5. [ ] Remove demo screenshots from any production marketing artifact
   that's been generated from `?demo=1` captures (every file in
   `app/demo-output/stills/` whose visible content includes mock
   patient names: Sawyer Mitchell, Ivanna Chen, Marcus Reyes, Priya
   Shah, Eleanor Park).

6. [ ] Update Playwright e2e specs that hardcoded mock patient names if
   any have leaked into the bug-hunt suite.

7. [ ] Update this file: change `status: live` to `status: archived`.

## Sample-data preservation option

If we decide to keep populated empty-state UX as a real feature (e.g.
a "Preview with sample data" button on first-load empty modules), the
demo fixtures can be repurposed:

- Move `demoData.ts` → `sampleData.ts`
- Replace `?demo=1` gating with an explicit user-clicked "Show sample"
  toggle that only renders client-side (never persists to DB)
- Add a clear "Sample preview" banner on screens showing this data

This preserves the engineering work while making it production-safe.

## Mock patient names used (cross-module)

Same patient names are used across mocks for narrative consistency.
Searchable identifier list:

- Sawyer Mitchell — `+14015551234` — PatNum 4827
- Ivanna Chen — `+14015552876` — PatNum 5103
- Marcus Reyes — `+14015553301` — PatNum 5240
- Priya Shah — `+14015556077` — PatNum 4982
- Eleanor Park — `+14015557720` — PatNum 5510
- Unmatched caller — `+14015558814` — no PatNum

Plus fictitious staff names (Maya, Dr. Patel, Linda Park).

If any of these names show up in a customer-facing screen unprompted,
that's a regression that means demo data is leaking past `?demo=1`.
