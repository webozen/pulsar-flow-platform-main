import { queryOne, initDb } from './db'
import { setKV } from './kestra'

export interface ClinicRow {
  id: string
  name: string
  slug: string
  kestra_namespace: string
  phone: string | null
  timezone: string
  is_active: boolean
  opendental_api_url: string | null
  opendental_api_key: string | null
  twilio_sid: string | null
  twilio_from_number: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_username: string | null
  smtp_from: string | null
  billing_email: string | null
  front_desk_email: string | null
}

export async function getOrCreateClinic(slug: string): Promise<ClinicRow> {
  await initDb()

  const existing = await queryOne<ClinicRow>(
    'SELECT * FROM flowcore.clinics WHERE slug = $1',
    [slug]
  )
  if (existing) return existing

  const namespace = `dental.${slug}`
  const clinic = await queryOne<ClinicRow>(
    `INSERT INTO flowcore.clinics (name, slug, kestra_namespace, timezone)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [slug, slug, namespace, 'America/New_York']
  )
  if (!clinic) throw new Error('Failed to create clinic')

  // Bootstrap Kestra namespace with initial KV variables
  try {
    await setKV(namespace, 'clinic_name', slug)
    await setKV(namespace, 'app_url', process.env.PUBLIC_APP_URL || 'http://localhost:3002')
  } catch {
    // Non-fatal: namespace created on first workflow deploy
  }

  return clinic
}
