import { NextResponse } from 'next/server'
import { requireSyncSecret, tenantStatus } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const guard = requireSyncSecret(req)
  if (guard) return guard
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })
  try {
    const result = await tenantStatus(slug)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
