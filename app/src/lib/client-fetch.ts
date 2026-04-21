/**
 * Wraps fetch() with the Pulsar JWT Authorization header.
 * Use this in all 'use client' components instead of raw fetch() for /api/* calls.
 */
export function clientFetch(url: string, options?: RequestInit): Promise<Response> {
  const jwt =
    typeof window !== 'undefined' ? (sessionStorage.getItem('pulsar.jwt') ?? '') : ''

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...options?.headers,
    },
  })
}
