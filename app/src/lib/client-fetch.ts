/**
 * Wraps fetch() with the Pulsar JWT Authorization header AND prepends the
 * Next.js basePath (`/automation`) to relative API URLs.
 *
 * Why prepend: this app is mounted under `/automation` (next.config.ts
 * `basePath`). When the user reaches us via Pulsar's Vite proxy at :5173,
 * a bare `/api/workflows` resolves to `http://localhost:5173/api/workflows`
 * — and Vite's `/api/*` proxy is wired to PULSAR-BACKEND, not this Next.js
 * app, so the call 404s. Always sending through the basepath routes the
 * request through Vite's `/automation/*` rule (→ Next.js) instead.
 *
 * Use this in every 'use client' component instead of raw fetch() for
 * `/api/*` calls.
 */
const BASE_PATH = '/automation'

function withBasePath(url: string): string {
  if (!url.startsWith('/')) return url
  if (url.startsWith(BASE_PATH + '/') || url === BASE_PATH) return url
  return BASE_PATH + url
}

export function clientFetch(url: string, options?: RequestInit): Promise<Response> {
  const jwt =
    typeof window !== 'undefined' ? (sessionStorage.getItem('pulsar.jwt') ?? '') : ''

  return fetch(withBasePath(url), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...options?.headers,
    },
  })
}
