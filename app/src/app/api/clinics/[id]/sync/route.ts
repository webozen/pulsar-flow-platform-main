import { NextResponse } from 'next/server'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'

export const dynamic = 'force-dynamic'

/**
 * No-op under Plan B + Phase 2 cleanup. The Plan A "sync clinic columns
 * to Kestra KV" pattern is gone — Kestra KV IS the source of truth for
 * per-tenant secrets (Twilio, OpenDental, SMTP, etc.). This route used
 * to push DB columns into KV; those columns no longer exist on
 * `flowcore.clinics`. Kept as a 200 no-op so the existing Settings
 * page button doesn't 404, with a `deprecated: true` flag so callers
 * know to migrate to direct KV management.
 */
export async function POST(req: Request) {
  try {
    requireAuth(req)
    return NextResponse.json({
      ok: true,
      deprecated: true,
      message: 'Per-tenant secrets live in Kestra KV directly; no DB→KV sync needed.',
    })
  } catch (e) {
    return authErrorResponse(e)
  }
}
