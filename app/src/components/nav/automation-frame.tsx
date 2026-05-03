'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Page-level wrapper for the orchestrator's three top-level destinations
 * (Dashboard / Workflows / Approvals). Mirrors the title + tabs pattern
 * from `pulsar-frontend/modules-fe/content-ui/src/ContentPage.tsx` so the
 * Automation surface reads as another module page, not a separate app.
 *
 * The clinic-name avatar that lived on the workflows page header is
 * deliberately removed — clinic context is implicit from the URL and the
 * sub-tabs (Workflows / Triggers / Reports / Audit Log) below this strip,
 * mirroring how Content keeps category context inside its tabs.
 */

type Tab = 'dashboard' | 'workflows' | 'approvals'

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'dashboard', label: '🏠 Dashboard', href: '/dashboard' },
  { id: 'workflows', label: '⚡ Workflows', href: '/workflows' },
  { id: 'approvals', label: '✅ Approvals', href: '/approvals' },
]

export function AutomationFrame({ active, children }: { active?: Tab; children: React.ReactNode }) {
  const pathname = usePathname()

  // If the caller didn't specify, infer from the URL. Workflows-related
  // URLs all start with /clinics/<slug>/workflows or /workflows; the
  // explicit prop takes priority for cases where inference is wrong.
  const resolved: Tab =
    active ??
    (pathname.startsWith('/approvals')
      ? 'approvals'
      : pathname.startsWith('/dashboard') || pathname === '/'
        ? 'dashboard'
        : 'workflows')

  return (
    <div>
      {/* Compact header — title + inline tagline on a single block with
          tight margin. Previous (text-2xl + tagline below + mb-6) was
          adding ~110px of chrome that pushed the dashboard's content
          (3 stat cards + 2 performance cards) past viewport on common
          window heights, spawning a page scrollbar. text-xl + mb-3
          keeps the visual hierarchy without forcing scroll. */}
      <div className="mb-3 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: 'var(--p-ink)' }}>
          ⚡ Automation
        </h1>
        <p className="text-sm" style={{ color: 'var(--p-slate)' }}>
          Workflows, approvals, and operational dashboards for your clinic.
        </p>
      </div>

      <div
        className="rounded-xl shadow-sm border overflow-hidden"
        style={{ backgroundColor: 'var(--p-surface)', borderColor: 'var(--p-border)' }}
      >
        {/* Tab strip width fits the 3 tabs comfortably on any viewport
            ≥ ~360px. Dropping `overflow-x-auto` removes the chance of
            a phantom scrollbar gutter appearing at the top-right when
            the OS is set to "always show scrollbars". `flex-wrap`
            handles the rare narrow-viewport case by stacking tabs. */}
        <div className="flex flex-wrap border-b" style={{ borderColor: 'var(--p-border)' }}>
          {TABS.map(t => {
            const isActive = resolved === t.id
            return (
              <Link
                key={t.id}
                href={t.href}
                className="px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors -mb-px border-b-2"
                style={
                  isActive
                    ? { color: 'var(--p-accent)', borderColor: 'var(--p-accent)' }
                    : { color: 'var(--p-slate)', borderColor: 'transparent' }
                }
              >
                {t.label}
              </Link>
            )
          })}
        </div>

        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
