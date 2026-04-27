/**
 * Resolve the active tenant from the Pulsar JWT, NO database round-trip.
 * Replacement for the legacy `getOrCreateClinic(slug)` helper which used to
 * lazy-insert a row into `flowcore.clinics`. Under Plan B, Pulsar's MySQL
 * `public_tenants` is the only authoritative tenant store and the Kestra
 * namespace is fully derivable from the slug, so the flow-platform's local
 * `flowcore.clinics` rows are not needed.
 *
 * Routes that used to call `getOrCreateClinic(slug)` and read fields off the
 * returned row should call {@link tenantFromRequest} instead and use
 * `ctx.namespace` / `ctx.slug`. Anything else (twilio_sid, smtp_host, …) now
 * lives in the per-tenant Kestra namespace KV; the routes that need it should
 * read it from there directly via the kestra.ts helpers.
 */
import { requireAuth } from './pulsar-auth'
import { namespaceFor } from './tenant-sync'

export interface TenantContext {
  slug: string
  namespace: string
}

export function tenantFromRequest(req: Request): TenantContext {
  const { slug } = requireAuth(req)
  return { slug, namespace: namespaceFor(slug) }
}

/**
 * Drop-in shape for legacy code that destructures `clinic.kestra_namespace`
 * etc. off the row. The synthetic clinic uses the slug as its `id` so the
 * existing UI's URL pattern `/clinics/[id]/...` becomes `/clinics/[slug]/...`
 * naturally, no rename of route directories.
 */
export interface SyntheticClinic {
  id: string                 // == slug
  slug: string
  name: string               // == slug (real name lives in pulsar-backend's public_tenants)
  kestra_namespace: string
  timezone: string
  is_active: boolean
  // null placeholders so destructuring doesn't crash legacy components
  phone: null
  opendental_api_url: null
  opendental_api_key: null
  twilio_sid: null
  twilio_from_number: null
  smtp_host: null
  smtp_port: null
  smtp_username: null
  smtp_from: null
  billing_email: null
  front_desk_email: null
}

export function syntheticClinicFromSlug(slug: string): SyntheticClinic {
  return {
    id: slug,
    slug,
    name: slug,
    kestra_namespace: namespaceFor(slug),
    timezone: 'America/New_York',
    is_active: true,
    phone: null,
    opendental_api_url: null,
    opendental_api_key: null,
    twilio_sid: null,
    twilio_from_number: null,
    smtp_host: null,
    smtp_port: null,
    smtp_username: null,
    smtp_from: null,
    billing_email: null,
    front_desk_email: null,
  }
}
