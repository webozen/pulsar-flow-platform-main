import { NextResponse } from 'next/server'
import { requireSyncSecret, suspendTenant } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard = requireSyncSecret(req)
  if (guard) return guard
  const body = await req.json().catch(() => ({}))
  if (!body?.slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })
  try {
    const result = await suspendTenant(String(body.slug))
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
