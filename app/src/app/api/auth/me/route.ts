import { NextResponse } from 'next/server'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { namespaceFor } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

/**
 * Returns the canonical tenant identity straight from the Pulsar JWT.
 * The Workflows / Edit pages call this on mount to compare against the
 * URL's `[id]` param — if a stale URL (e.g. a bookmarked legacy UUID
 * route from before the slug-keyed Plan B refactor) points at the wrong
 * tenant, the client redirects to the right URL instead of rendering
 * an empty page against the wrong Kestra namespace.
 */
export async function GET(req: Request) {
  try {
    const { slug, email, role } = requireAuth(req)
    return NextResponse.json({
      slug,
      email,
      role,
      kestra_namespace: namespaceFor(slug),
    })
  } catch (e) {
    return authErrorResponse(e)
  }
}
