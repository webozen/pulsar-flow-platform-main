'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBranding } from '@/lib/use-branding'

// `Conversations` was a multi-clinic chat thread browser keyed by phone
// number, populated from `flowcore.sms_messages` / `flowcore.voice_calls`.
// Those tables aren't being written under Plan B yet, so the page would be
// empty. Hidden from nav until the per-tenant MySQL message tables ship.
const links = [
  { href: '/dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  // `/workflows` is a tenant-scoped redirect → `/clinics/<slug>/workflows`
  // (existing slug-keyed page). Adding it to the nav so a tenant user has
  // a single click to their workflows from anywhere in the app.
  { href: '/workflows', label: 'Workflows', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { href: '/approvals', label: 'Approvals', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

export function AppShell({ children, userName }: { children: React.ReactNode; userName?: string | null }) {
  const pathname = usePathname()
  const pulsarBase = process.env.NEXT_PUBLIC_PULSAR_APP_URL || 'http://localhost:5173'
  const branding = useBranding()

  // Deep-link "Back to Pulsar" to the tenant home so the user lands inside
  // their already-authenticated tenant shell instead of bouncing through
  // the unauthenticated `/` → `/login` redirect. Slug comes from the URL —
  // every page under /clinics/<slug>/ has it; routes without a slug fall
  // back to the root and rely on Pulsar's HomeRedirect to land them.
  const slugMatch = pathname.match(/^\/clinics\/([^/]+)/)
  const slug = slugMatch ? slugMatch[1] : null
  const pulsarUrl = slug ? `${pulsarBase}/t/${slug}` : pulsarBase

  // Branded chrome — logo + app name fall back to the legacy "Pulsar
  // Flow" treatment when the branding endpoint isn't reachable. The
  // active-tab background uses the tenant primary color (CSS var
  // `--pulsar-primary` is set by useBranding) so each clinic feels
  // distinct from the others.
  const appName = branding?.appName ?? 'Pulsar Flow'
  // Default to sky-500 (#0EA5E9) — matches the design.md `accent` token
  // in pulsar-frontend so all three apps read as one product. Tenants
  // can still override via branding.primaryColor.
  const primary = branding?.primaryColor ?? '#0EA5E9'

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: '#FDFAF6' }}>
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              {branding?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logoUrl}
                  alt={appName}
                  className="h-8 w-8 rounded-lg object-contain"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold"
                  style={{ backgroundColor: primary }}
                >
                  {appName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-base font-bold text-gray-900">{appName}</span>
            </div>
            <nav className="hidden sm:flex items-center border-l border-gray-200 pl-8 gap-1">
              {links.map((link) => {
                const active = pathname.startsWith(link.href)
                return (
                  <Link key={link.href} href={link.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active ? 'border' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                    style={
                      active
                        ? {
                            // Tinted active tab using the tenant brand color.
                            backgroundColor: `${primary}14`, // ~8% alpha
                            color: primary,
                            borderColor: `${primary}33`, // ~20% alpha
                          }
                        : undefined
                    }
                  >
                    <NavIcon d={link.icon} />
                    {link.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {userName && (
              <div className="hidden sm:flex items-center gap-2">
                <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: '#E0F2FE', color: '#0284C7' }}>
                  {userName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-gray-700">{userName}</span>
              </div>
            )}
            <div className="border-l border-gray-200 pl-3">
              <a href={pulsarUrl}>
                <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-900 text-sm">
                  ← Back to Pulsar
                </Button>
              </a>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
