import { NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    return NextResponse.json([clinic])
  } catch (e) {
    return authErrorResponse(e)
  }
}
