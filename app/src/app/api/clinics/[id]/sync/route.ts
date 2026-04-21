import { NextResponse } from 'next/server'
import { queryOne, initDb } from '@/lib/db'
import { syncClinicToKestra } from '@/lib/kestra'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug } = requireAuth(req)
    const { id } = await params
    await initDb()
    const clinic = await queryOne<Record<string, unknown>>(
      'SELECT * FROM flowcore.clinics WHERE id = $1 AND slug = $2',
      [id, slug]
    )
    if (!clinic) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const result = await syncClinicToKestra({
      kestraNamespace: clinic.kestra_namespace as string,
      name: clinic.name as string,
      phone: clinic.phone as string | null,
      timezone: (clinic.timezone as string) || 'America/New_York',
      opendentalApiUrl: clinic.opendental_api_url as string | null,
      opendentalApiKey: clinic.opendental_api_key as string | null,
      twilioSid: clinic.twilio_sid as string | null,
      twilioAuthToken: null,
      twilioFromNumber: clinic.twilio_from_number as string | null,
      smtpHost: clinic.smtp_host as string | null,
      smtpPort: clinic.smtp_port as number | null,
      smtpUsername: clinic.smtp_username as string | null,
      smtpFrom: clinic.smtp_from as string | null,
      billingEmail: clinic.billing_email as string | null,
      frontDeskEmail: clinic.front_desk_email as string | null,
    })
    return NextResponse.json({ kvVariables: result.synced })
  } catch (e) {
    return authErrorResponse(e)
  }
}
