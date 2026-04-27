import { queryOne, initDb } from './db'
import { setKV } from './kestra'
import { namespaceFor } from './tenant-sync'

/** Thin clinic row shape post-Phase 2. The flow-platform DB no longer
 *  stores per-tenant secrets (Twilio, OpenDental, SMTP) — those live
 *  in Kestra KV under `dental.<slug>`. The fields kept here support
 *  inbound webhook routing (twilio_from_number → slug) and the
 *  dashboard "active clinics" tile. */
export interface ClinicRow {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  twilio_from_number: string | null
}

export async function getOrCreateClinic(slug: string): Promise<ClinicRow> {
  await initDb()

  const existing = await queryOne<ClinicRow>(
    'SELECT id, name, slug, timezone, is_active, twilio_from_number FROM flowcore.clinics WHERE slug = $1',
    [slug]
  )
  if (existing) return existing

  const namespace = namespaceFor(slug)
  const clinic = await queryOne<ClinicRow>(
    `INSERT INTO flowcore.clinics (name, slug, timezone)
     VALUES ($1, $2, $3)
     RETURNING id, name, slug, timezone, is_active, twilio_from_number`,
    [slug, slug, 'America/New_York']
  )
  if (!clinic) throw new Error('Failed to create clinic')

  // Bootstrap Kestra namespace KV with the minimum a deployed flow needs.
  try {
    await setKV(namespace, 'clinic_name', slug)
    await setKV(namespace, 'app_url', process.env.PUBLIC_APP_URL || 'http://localhost:3002')
  } catch {
    // Non-fatal: namespace gets created on first flow deploy regardless.
  }

  return clinic
}
