import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// NOTE (Next.js 16):
// - This file replaces `middleware.ts`. In v16 the file convention was renamed
//   to `proxy.ts` and the exported function must be named `proxy`.
// - With `basePath: '/automation'` in next.config.ts, NextURL tracks the base
//   path separately (req.nextUrl.basePath), and `req.nextUrl.pathname` is the
//   already-stripped path. So the prefixes below are written WITHOUT the
//   `/automation` prefix — they refer to internal routes.
// - The `config.matcher` below is similarly evaluated against the stripped path.

const PUBLIC_PREFIXES = [
  '/login',
  '/api/twilio',
  '/api/auth',
  '/portal',
  '/_next',
  '/favicon',
]

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname

  // API routes handle their own auth via requireAuth(req) — don't interfere.
  // This covers everything served at /automation/api/* from the browser's perspective.
  if (path.startsWith('/api/')) {
    return NextResponse.next()
  }

  if (PUBLIC_PREFIXES.some(p => path.startsWith(p))) {
    return NextResponse.next()
  }

  // Page routes: require pulsar_jwt cookie. This cookie is now set directly by
  // the Pulsar backend on tenant login with Path=/, so it is visible here as
  // soon as the user signs in at the frontend origin (same origin via the Vite
  // reverse proxy / prod reverse proxy).
  const token = req.cookies.get('pulsar_jwt')?.value
  if (!token) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
