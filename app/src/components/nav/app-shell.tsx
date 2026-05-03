'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useBranding } from '@/lib/use-branding'
import { clientFetch } from '@/lib/client-fetch'

/**
 * Top chrome — mirrors `pulsar-frontend/apps/web/src/shells/TenantShell.tsx`
 * so the user doesn't visually leave Pulsar when they cross into the
 * orchestrator. Two rows:
 *
 *   Row 1 (header): Pulsar logo + appName (left)  ·  module switcher
 *                   (Content / Automation* / Translate / Ask AI / OpenDental) +
 *                   gear ⚙ + Sign out (right). The non-Automation tabs
 *                   deep-link back to `pulsarBase/t/<slug>/<modulePath>`.
 *
 *   Row 2 (sub-nav): Dashboard / Workflows / Approvals — the orchestrator's
 *                    own internal sections, kept off the top header so the
 *                    chrome stays single-row like the tenant shell.
 *
 * The slug for back-links comes from `/clinics/<slug>/...` URLs; pages
 * outside that scope (Dashboard, Approvals) fall back to the Pulsar root,
 * which HomeRedirect bounces to the user's tenant.
 */

// Module switcher — static dental-domain list mirroring
// pulsar-frontend's `moduleRegistry.ts`. Kept hardcoded to avoid a
// cross-repo import; if the tenant has a module deactivated, the link
// still resolves through Pulsar's TenantShell which only renders
// active ones.
const MODULES = [
  { id: 'content',             label: 'Content',     path: '/content' },
  { id: 'automation',          label: 'Automation',  path: '/automation', current: true },
  { id: 'translate',           label: 'Translate',   path: '/translate' },
  { id: 'opendental-ai',       label: 'Ask AI',      path: '/opendental-ai' },
  { id: 'opendental-calendar', label: 'OpenDental',  path: '/opendental-calendar' },
] as const

export function AppShell({ children, userName: _userName }: { children: React.ReactNode; userName?: string | null }) {
  const pathname = usePathname()
  const pulsarBase = process.env.NEXT_PUBLIC_PULSAR_APP_URL || 'http://localhost:5173'
  const branding = useBranding()

  // Slug comes from /clinics/<slug>/... URLs when present; on the
  // tenant-global pages (/dashboard, /approvals) the URL doesn't carry
  // it, so fall back to the JWT-derived slug from /api/auth/me. Cached
  // in component state so the breadcrumb appears as soon as the fetch
  // resolves and stays consistent across nav clicks.
  const slugMatch = pathname.match(/^\/clinics\/([^/]+)/)
  const [meSlug, setMeSlug] = useState<string | null>(null)
  useEffect(() => {
    if (slugMatch) return
    let cancelled = false
    // clientFetch prepends `/automation` so the request goes through
    // Vite's /automation/* proxy → Next.js /api/auth/me. A bare fetch
    // would hit `localhost:5173/api/auth/me`, which Vite proxies to
    // Spring (port 18080), where this endpoint doesn't exist.
    clientFetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.slug) setMeSlug(d.slug) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  const slug = slugMatch ? slugMatch[1] : meSlug

  const appName = branding?.appName ?? 'Pulsar'
  // Tenant brand override or default to the Pulsar accent (#0EA5E9 — same
  // as `--p-accent` in pulsar-frontend's tokens.css).
  const primary = branding?.primaryColor ?? 'var(--p-accent)'

  // Where to send each module switcher tab. Automation stays in this app;
  // everything else goes back to the Pulsar React shell.
  function moduleHref(m: (typeof MODULES)[number]): string {
    if (m.id === 'automation') return '/automation'
    return slug ? `${pulsarBase}/t/${slug}${m.path}` : pulsarBase
  }
  function settingsHref(): string {
    return slug ? `${pulsarBase}/t/${slug}/settings` : `${pulsarBase}/login`
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--p-canvas)]">
      {/* Single-row chrome — same h-14 as TenantShell, full-width (no
          max-w container) so the wordmark/nav sit flush at the edges
          and the perceived header size matches the other modules. */}
      <header
        className="sticky top-0 z-50 h-14 border-b px-6 flex items-center justify-between bg-[var(--p-surface)]"
        style={{ borderColor: 'var(--p-border)' }}
      >
        {/* Left: logo + app name + slug breadcrumb. Mirrors TenantShell
            — clicking the wordmark goes to the tenant's Pulsar home
            (cross-app full page nav, NOT the orchestrator's /dashboard).
            The slug appears as a slate-colored breadcrumb after the
            wordmark so the clinic context is visible on every page;
            suppressed when it duplicates the displayed brand name (a
            tenant with `branding.appName = "Acme Dental"` shouldn't
            then also see "· acme" appended). */}
        <a
          href={slug ? `${pulsarBase}/t/${slug}` : pulsarBase}
          className="flex items-center gap-2.5"
        >
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={appName}
              className="h-7 w-auto rounded object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : null}
          <span className="text-base font-semibold" style={{ color: 'var(--p-ink)' }}>{appName}</span>
          {slug && slug.toLowerCase() !== appName.toLowerCase() && (
            <>
              <span className="text-base" style={{ color: 'var(--p-mute)' }}>·</span>
              <span className="text-base font-medium" style={{ color: 'var(--p-slate)' }}>{slug}</span>
            </>
          )}
        </a>

        {/* Right: module switcher + gear + sign out */}
        <nav className="flex items-center gap-1 text-sm">
          {MODULES.map(m => {
            const isActive = m.id === 'automation'
            const baseClass = 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors'
            if (isActive) {
              return (
                <span
                  key={m.id}
                  className={baseClass}
                  style={{ backgroundColor: 'var(--p-accent-soft)', color: primary }}
                >
                  {m.label}
                </span>
              )
            }
            return (
              <a
                key={m.id}
                href={moduleHref(m)}
                className={`${baseClass} hover:bg-[var(--p-surface-2)]`}
                style={{ color: 'var(--p-slate)' }}
              >
                {m.label}
              </a>
            )
          })}
          <a
            href={settingsHref()}
            title="Settings"
            aria-label="Settings"
            className="ml-2 p-1.5 rounded-md hover:bg-[var(--p-surface-2)] transition-colors"
            style={{ color: 'var(--p-slate)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </a>
          <a
            href={`${pulsarBase}/login`}
            className="ml-2 px-3 py-1.5 rounded-md hover:bg-[var(--p-surface-2)] transition-colors text-sm"
            style={{ color: 'var(--p-slate)' }}
          >
            Sign out
          </a>
        </nav>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5">{children}</div>
      </main>
    </div>
  )
}
