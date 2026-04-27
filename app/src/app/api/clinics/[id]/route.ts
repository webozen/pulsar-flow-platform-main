import { NextResponse } from 'next/server'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { syntheticClinicFromSlug } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

/**
 * Under Plan B `[id]` IS the slug. The legacy implementation read a row
 * from flowcore.clinics; we now synthesize the same shape from the JWT slug
 * so the UI keeps rendering. Any param value that doesn't match the JWT
 * tenant is rejected as 404 to preserve the original ownership semantics.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug: jwtSlug } = requireAuth(req)
    const { id } = await params
    if (id !== jwtSlug) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(syntheticClinicFromSlug(jwtSlug))
  } catch (e) {
    return authErrorResponse(e)
  }
}

/**
 * PUT used to update flowcore.clinics fields (twilio_sid, smtp_host, …).
 * Under Plan B those secrets live in the tenant's Kestra namespace KV and
 * are pushed via `/api/automation/tenant-sync/secrets` from pulsar-backend
 * after the tenant onboards opendental-ai (or in future a dedicated
 * provider-credentials onboarding flow). The legacy PUT is a no-op now;
 * we return 200 with a deprecation note so existing UI buttons don't error.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug: jwtSlug } = requireAuth(req)
    const { id } = await params
    if (id !== jwtSlug) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({
      ok: true,
      deprecated: true,
      reason: 'Tenant config now lives in Pulsar (public_tenants) + Kestra namespace KV. ' +
              'Push provider creds via POST /api/automation/tenant-sync/secrets from pulsar-backend.',
    })
  } catch (e) {
    return authErrorResponse(e)
  }
}
