import { NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { listExecutions } from '@/lib/kestra'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const data = await listExecutions({ namespace: clinic.kestra_namespace, state: 'PAUSED', size: 50 })
    return NextResponse.json(data?.results || [])
  } catch (e) {
    return authErrorResponse(e)
  }
}
