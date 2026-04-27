import { NextResponse } from 'next/server'
import { pushTenantSecrets, requireSyncSecret } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard = requireSyncSecret(req)
  if (guard) return guard
  const body = await req.json().catch(() => ({}))
  if (!body?.slug || !body?.secrets) {
    return NextResponse.json({ error: 'slug_and_secrets_required' }, { status: 400 })
  }
  try {
    const result = await pushTenantSecrets(String(body.slug), body.secrets as Record<string, string>)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
