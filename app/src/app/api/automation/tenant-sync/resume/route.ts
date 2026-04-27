import { NextResponse } from 'next/server'
import { requireSyncSecret, resumeTenant } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard = requireSyncSecret(req)
  if (guard) return guard
  const body = await req.json().catch(() => ({}))
  if (!body?.slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })
  try {
    const modules = Array.isArray(body.modules) ? body.modules.map(String) : undefined
    const result = await resumeTenant(String(body.slug), modules)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
