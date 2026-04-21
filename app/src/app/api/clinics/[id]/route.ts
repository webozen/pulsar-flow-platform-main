import { NextResponse } from 'next/server'
import { query, queryOne, initDb } from '@/lib/db'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'

export const dynamic = 'force-dynamic'

async function getOwnedClinic(req: Request, id: string) {
  const { slug } = requireAuth(req)
  await initDb()
  const clinic = await queryOne<Record<string, unknown>>(
    'SELECT * FROM flowcore.clinics WHERE id = $1 AND slug = $2',
    [id, slug]
  )
  if (!clinic) throw Object.assign(new Error('Not found'), { status: 404 })
  return clinic
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const clinic = await getOwnedClinic(req, id)
    return NextResponse.json(clinic)
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return authErrorResponse(e)
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await getOwnedClinic(req, id)
    const data = await req.json()
    await query(
      `UPDATE flowcore.clinics SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        timezone = COALESCE($3, timezone),
        opendental_api_url = COALESCE($4, opendental_api_url),
        opendental_api_key = COALESCE($5, opendental_api_key),
        twilio_sid = COALESCE($6, twilio_sid),
        twilio_from_number = COALESCE($7, twilio_from_number),
        smtp_host = COALESCE($8, smtp_host),
        smtp_port = COALESCE($9, smtp_port),
        smtp_username = COALESCE($10, smtp_username),
        smtp_from = COALESCE($11, smtp_from),
        billing_email = COALESCE($12, billing_email),
        front_desk_email = COALESCE($13, front_desk_email),
        updated_at = now()
      WHERE id = $14`,
      [
        data.name || null, data.phone || null, data.timezone || null,
        data.opendentalApiUrl || null, data.opendentalApiKey || null,
        data.twilioSid || null, data.twilioFromNumber || null,
        data.smtpHost || null, data.smtpPort ? parseInt(data.smtpPort) : null,
        data.smtpUsername || null, data.smtpFrom || null,
        data.billingEmail || null, data.frontDeskEmail || null,
        id,
      ]
    )
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return authErrorResponse(e)
  }
}
