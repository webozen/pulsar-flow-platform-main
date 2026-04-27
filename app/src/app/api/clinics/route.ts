import { NextResponse } from 'next/server'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { syntheticClinicFromSlug } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

/**
 * Under Plan B the flow-platform's `flowcore.clinics` table is no longer
 * authoritative — Pulsar's `public_tenants` is. This endpoint used to call
 * `getOrCreateClinic(slug)` which returned a row whose UUID `id` did not
 * match the slug-as-id contract that `[id]/route.ts` enforces — so the UI
 * would list a clinic with id `<uuid>` and then 404 on
 * `GET /api/clinics/<uuid>`. Synthesizing the same shape from the JWT slug
 * keeps LIST and BY-ID consistent and removes the lazy DB insert.
 */
export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    return NextResponse.json([syntheticClinicFromSlug(slug)])
  } catch (e) {
    return authErrorResponse(e)
  }
}
