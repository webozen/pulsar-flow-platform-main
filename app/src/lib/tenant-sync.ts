/**
 * Server-to-server tenant lifecycle bridge from pulsar-backend.
 *
 * Identity model: Pulsar's `slug` is the only tenant identity. We do NOT
 * keep a parallel `flowcore.clinics` row — Pulsar already owns the
 * authoritative tenant registry in `pulsar_platform.public_tenants` (MySQL),
 * and per-tenant data lives in `pulsar_t_<slug>` MySQL DBs. The flow-platform
 * is a thin Kestra-facing service: it deploys flows into a per-slug
 * Kestra namespace and pushes credentials there, nothing more.
 *
 * Auth model: shared static secret in `X-Pulsar-Sync-Secret` header. Pulsar
 * generates the secret at deploy time and stores the same value here in
 * `PULSAR_AUTOMATION_SYNC_SECRET`. No tenant JWT — these calls reach us
 * before the tenant is necessarily active (provisioning) or after they're
 * gone (suspending/deleting).
 */
import { NextResponse } from 'next/server'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createOrUpdateFlowFromYaml,
  deleteFlow,
  listFlows,
  setKV,
  toggleFlow,
} from './kestra'

const FLOWS_DIR = process.env.PULSAR_FLOWS_DIR
  ?? path.resolve(process.cwd(), '..', 'kestra', 'flows', 'dental')

/** Module IDs (from Pulsar) that map to *shipped* dental Kestra flows.
 *  Empty by design — the platform does not ship any pre-built workflows
 *  any more. Tenants build workflows via the in-app builder
 *  (`/clinics/[slug]/workflows/new`), which writes a row to
 *  `flowcore.workflows` and POSTs YAML straight to Kestra. Module
 *  activation here is now purely a feature gate; nothing to enable.
 *
 *  Re-introduce a flow id below ONLY if it's a code-shipped seed/demo
 *  fixture intended to deploy uniformly to every tenant. The pinning
 *  test in __tests__/tenant-sync.test.ts will fail loudly the moment
 *  this map gains entries that aren't paired with their YAML on disk.
 */
export const FLOWS_BY_MODULE: Record<string, string[]> = {
  automation: [],
}

/** Loose Kestra flow shape — the REST API returns much more than this but
 *  we only ever read `id` and `disabled` on the response side. */
type KestraFlow = { id: string; disabled?: boolean }

export function requireSyncSecret(req: Request): NextResponse | null {
  const expected = process.env.PULSAR_AUTOMATION_SYNC_SECRET ?? ''
  const got = req.headers.get('x-pulsar-sync-secret') ?? ''
  if (!expected) {
    return NextResponse.json({ error: 'sync_secret_not_configured' }, { status: 500 })
  }
  if (got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

/** Slug → Kestra namespace. Pulsar slugs are URL-safe; we prefix with
 *  `dental.` because Kestra namespaces are hierarchical and the dental
 *  vertical's flows live under that root. Other verticals (realtor, salon)
 *  will get their own roots when their flows are added. */
export function namespaceFor(slug: string): string {
  return `dental.${slug}`
}

/** Read every .yml file in the dental flows directory and return
 *  `{ id, yaml }` pairs with the namespace already substituted. */
export function loadDentalFlows(slug: string): Array<{ id: string; yaml: string }> {
  const ns = namespaceFor(slug)
  let files: string[]
  try {
    files = readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  } catch (e) {
    throw new Error(`flows_dir_unreadable: ${FLOWS_DIR}: ${(e as Error).message}`)
  }
  return files.map((file) => {
    const raw = readFileSync(path.join(FLOWS_DIR, file), 'utf8')
    // Shipped YAMLs hardcode `namespace: dental`. Rewrite EVERY line
    // matching that exactly — top-level flow namespace AND any nested
    // `namespace: dental` inside a Subflow task block (which references
    // a deployed flow's namespace; that ref must also point at the
    // tenant-prefixed namespace). The regex preserves leading
    // whitespace so the YAML structure stays intact.
    const yaml = raw.replace(
      /^(\s*)namespace:\s*dental\s*$/gm,
      (_m, lead) => `${lead}namespace: ${ns}`,
    )
    const idMatch = raw.match(/^id:\s*(\S+)\s*$/m)
    if (!idMatch) throw new Error(`flow_missing_id: ${file}`)
    return { id: idMatch[1], yaml }
  })
}

/** Idempotent: deploy all dental flows into the tenant's Kestra namespace,
 *  toggle each based on whether `automation` is in the active modules,
 *  set sane KV defaults. Safe to call repeatedly (admin "Re-sync" button). */
export async function provisionTenant(input: {
  slug: string
  name?: string
  contactEmail?: string
  modules: string[]
}) {
  const ns = namespaceFor(input.slug)
  const desired = computeDesiredFlowSet(input.modules)

  // KV defaults so flows can render without runtime errors. Tenant fills the
  // rest via /tenant-sync/secrets (push-from-Pulsar).
  await setKV(ns, 'clinic_name', input.name ?? input.slug).catch(() => {})
  await setKV(ns, 'timezone', 'America/New_York').catch(() => {})
  await setKV(ns, 'app_url', process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').catch(() => {})

  const flows = loadDentalFlows(input.slug)
  const deployed: Array<{ id: string; disabled: boolean }> = []
  const errors: Array<{ id: string; error: string }> = []
  for (const { id, yaml } of flows) {
    try {
      await createOrUpdateFlowFromYaml(yaml)
      const disabled = !desired.has(id)
      // Just-deployed flows default to enabled; we explicitly disable when
      // `automation` isn't active for this tenant.
      await toggleFlow(ns, id, disabled).catch(() => {})
      deployed.push({ id, disabled })
    } catch (e) {
      errors.push({ id, error: (e as Error).message })
    }
  }

  return { slug: input.slug, namespace: ns, flowsDeployed: deployed, errors }
}

export async function applyModuleChange(slug: string, modules: string[]) {
  const ns = namespaceFor(slug)
  const desired = computeDesiredFlowSet(modules)
  const all = (await listFlows(ns).catch(() => [])) as KestraFlow[]
  const results: Array<{ id: string; disabled: boolean }> = []
  for (const f of all) {
    const disabled = !desired.has(f.id)
    await toggleFlow(ns, f.id, disabled).catch(() => {})
    results.push({ id: f.id, disabled })
  }
  return { slug, namespace: ns, toggled: results }
}

export async function suspendTenant(slug: string) {
  const ns = namespaceFor(slug)
  const all = (await listFlows(ns).catch(() => [])) as KestraFlow[]
  for (const f of all) await toggleFlow(ns, f.id, true).catch(() => {})
  return { slug, namespace: ns, suspendedFlows: all.map((f) => f.id) }
}

/** Resume can't recover the prior module set — Pulsar must re-send it.
 *  In practice the lifecycle listener calls `applyModuleChange` right
 *  after `resume` with the tenant's current modules from MySQL. */
export async function resumeTenant(slug: string, modules?: string[]) {
  if (modules && modules.length > 0) {
    return applyModuleChange(slug, modules)
  }
  // Fallback: re-enable every deployed flow. Caller is expected to push
  // module state right after for the canonical re-toggle.
  const ns = namespaceFor(slug)
  const all = (await listFlows(ns).catch(() => [])) as KestraFlow[]
  for (const f of all) await toggleFlow(ns, f.id, false).catch(() => {})
  return { slug, namespace: ns, resumedFlows: all.map((f) => f.id) }
}

export async function deleteTenant(slug: string) {
  const ns = namespaceFor(slug)
  const flows = (await listFlows(ns).catch(() => [])) as KestraFlow[]
  for (const f of flows) await deleteFlow(ns, f.id).catch(() => {})
  return { slug, namespace: ns, deletedFlows: flows.map((f) => f.id) }
}

export async function pushTenantSecrets(slug: string, secrets: Record<string, string>) {
  const ns = namespaceFor(slug)
  const written: string[] = []
  const errors: Array<{ key: string; error: string }> = []
  // Kestra OSS doesn't expose /secrets writable API (Enterprise only). Store
  // every "secret" as namespace KV. Convention: lowercase the key on its way
  // in so flows reference it as kv('opendental_developer_key') consistently.
  for (const [rawKey, v] of Object.entries(secrets)) {
    const k = rawKey.toLowerCase()
    try {
      await setKV(ns, k, v)
      written.push(k)
    } catch (e) {
      errors.push({ key: k, error: (e as Error).message })
    }
  }
  return { slug, namespace: ns, written, errors }
}

export async function tenantStatus(slug: string) {
  const ns = namespaceFor(slug)
  const flows = (await listFlows(ns).catch(() => [])) as KestraFlow[]
  return {
    slug,
    namespace: ns,
    flows: flows.map((f) => ({ id: f.id, disabled: !!f.disabled })),
  }
}

function computeDesiredFlowSet(modules: string[]): Set<string> {
  const out = new Set<string>()
  for (const m of modules) for (const f of FLOWS_BY_MODULE[m] ?? []) out.add(f)
  return out
}
