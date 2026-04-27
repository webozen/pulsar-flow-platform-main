import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { createOrUpdateFlowFromYaml, listFlows } from '@/lib/kestra'
import { generateKestraYaml } from '@/lib/workflow-generator'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { namespaceFor } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

/**
 * Lists workflows for the active tenant. Two sources unioned:
 *   1. Kestra namespace `dental.<slug>` — anything deployed there, including
 *      tenant-sync platform flows AND user-created builder flows after deploy.
 *   2. `flowcore.workflows` rows where `clinic_id = slug` — used by the
 *      Edit builder for round-trip (the structured form the user authored
 *      can't be reconstructed from raw Kestra YAML, so we keep the source
 *      definition here).
 *
 * Result is keyed by Kestra flow id; if both sources have the same id we
 * prefer the flowcore row's metadata (name/description/trigger_sql/actions
 * authored by the user) but the live `is_enabled` from Kestra.
 */
export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    const ns = namespaceFor(slug)

    let flows: KestraFlowSummary[] = []
    try { flows = (await listFlows(ns)) as KestraFlowSummary[] } catch {}

    let dbRows: Array<Record<string, unknown>> = []
    try {
      dbRows = await query(
        'SELECT * FROM flowcore.workflows WHERE clinic_id = $1 ORDER BY created_at DESC',
        [slug],
      )
    } catch {}

    const dbByFlowId = new Map<string, Record<string, unknown>>()
    for (const row of dbRows) {
      const fid = (row.kestra_flow_id as string) || (row.name as string)
      if (fid) dbByFlowId.set(fid, row)
    }

    const seen = new Set<string>()
    const merged: Array<Record<string, unknown>> = []
    for (const f of flows) {
      seen.add(f.id)
      const dbRow = dbByFlowId.get(f.id)
      if (dbRow) {
        merged.push({
          ...dbRow,
          kestra_namespace: ns,
          kestra_flow_id: f.id,
          is_enabled: !f.disabled,            // live state from Kestra wins
          action_mode: 'on_approval',
          editable_in_builder: true,
        })
      } else {
        merged.push({ ...mapKestraFlowToUiWorkflow(f, ns), editable_in_builder: true, platform_managed: true })
      }
    }
    // Builder rows that haven't deployed to Kestra yet (race / failed deploy)
    for (const [fid, row] of dbByFlowId) {
      if (seen.has(fid)) continue
      merged.push({
        ...row,
        kestra_namespace: ns,
        kestra_flow_id: fid,
        is_enabled: false,
        action_mode: 'on_approval',
        editable_in_builder: true,
      })
    }
    return NextResponse.json(merged)
  } catch (e) {
    return authErrorResponse(e)
  }
}

interface KestraFlowSummary {
  id: string
  namespace?: string
  description?: string
  disabled?: boolean
  triggers?: Array<{ cron?: string; type?: string }>
  tasks?: Array<{ id: string; type?: string }>
  labels?: Record<string, string> | Array<{ key: string; value: string }>
}

function mapKestraFlowToUiWorkflow(f: KestraFlowSummary, ns: string) {
  const cron = f.triggers?.find((t) => t.cron)?.cron ?? ''
  // Build a builder-shaped action count by walking the YAML's task tree.
  // Avoids the misleading "3 actions" badge when those 3 Kestra tasks are
  // really {Fetch + Log + ForEach{Pause+Log}} which round-trips to 0
  // builder actions (the test flow's true shape).
  const builderActions = countBuilderActions((f.tasks ?? []) as Array<{ id: string; type?: string; tasks?: unknown; then?: unknown; uri?: unknown }>)
  const hasApproval = containsPause((f.tasks ?? []) as Array<{ type?: string; tasks?: unknown; then?: unknown }>)
  return {
    id: f.id,
    name: f.id,
    description: f.description ?? null,
    trigger_type: cron ? 'schedule' : 'manual',
    trigger_cron: cron,
    trigger_sql: '',
    actions: new Array(builderActions).fill(null),
    is_enabled: !f.disabled,
    kestra_flow_id: f.id,
    kestra_namespace: ns,
    action_mode: hasApproval ? 'on_approval' : 'immediate',
  }
}

function countBuilderActions(tasks: Array<{ id: string; type?: string; tasks?: unknown; then?: unknown; uri?: unknown }>): number {
  let count = 0
  for (const t of tasks) {
    const type = String(t.type ?? '')
    if (type.endsWith('flow.ForEach')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count += countBuilderActions(((t as any).tasks ?? []) as Array<{ id: string; type?: string }>)
      continue
    }
    if (type.endsWith('flow.If')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count += countBuilderActions(((t as any).then ?? []) as Array<{ id: string; type?: string }>)
      continue
    }
    if (type.endsWith('flow.Pause')) continue            // approval-mode flag, not an action
    if (type.endsWith('log.Log')) continue
    if (type.endsWith('http.Request')) {
      const uri = String((t as { uri?: unknown }).uri ?? '')
      if (/ShortQuery/i.test(uri)) continue              // OD fetch isn't a user action
      count += 1
      continue
    }
    if (type.endsWith('MailSend')) { count += 1; continue }
  }
  return count
}

function containsPause(tasks: Array<{ type?: string; tasks?: unknown; then?: unknown }>): boolean {
  for (const t of tasks) {
    const type = String(t.type ?? '')
    if (type.endsWith('flow.Pause')) return true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (((t as any).tasks ?? (t as any).then) as unknown[]) ?? []
    if (Array.isArray(sub) && containsPause(sub as Array<{ type?: string }>)) return true
  }
  return false
}

export async function POST(req: Request) {
  try {
    const { slug } = requireAuth(req)
    const namespace = namespaceFor(slug)
    const data = await req.json()

    if (!data.name || !data.triggerSql) {
      return NextResponse.json({ error: 'name and triggerSql are required' }, { status: 400 })
    }

    // Plan B: clinic_id stores the slug as opaque text (FK to flowcore.clinics
    // dropped). This is the only DB row we keep — needed because the builder
    // UI's structured action list can't be losslessly reconstructed from the
    // generated Kestra YAML, so we cache it for round-trip on Edit.
    const workflow = await queryOne(
      `INSERT INTO flowcore.workflows
        (clinic_id, name, description, trigger_type, trigger_cron, trigger_sql, actions, is_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        slug, data.name, data.description || null,
        data.triggerType || 'schedule', data.triggerCron || '0 7 * * *',
        data.triggerSql, JSON.stringify(data.actions || []), data.isEnabled !== false,
      ]
    )

    const wf = workflow as Record<string, unknown>
    try {
      const workflowDef = {
        id: wf.id as string, name: data.name, description: data.description,
        triggerType: data.triggerType, triggerCron: data.triggerCron || '0 7 * * *',
        triggerSql: data.triggerSql, actionMode: data.actionMode,
        actions: data.actions || [], namespace,
        taskTitle: data.taskTitle, taskPriority: data.taskPriority,
        taskAssignedTo: data.taskAssignedTo, concurrencyLimit: data.concurrencyLimit,
        timeoutDuration: data.timeoutDuration, errorNotificationEmail: data.errorNotificationEmail,
        dedupEnabled: data.dedupEnabled, dedupField: data.dedupField,
      }
      const { parent, worker } = generateKestraYaml(workflowDef, { pair: true })
      const workerFlow = await createOrUpdateFlowFromYaml(worker)
      let primaryFlowId = workerFlow?.id
      if (parent) {
        const parentFlow = await createOrUpdateFlowFromYaml(parent)
        primaryFlowId = parentFlow?.id || primaryFlowId
      }
      await query('UPDATE flowcore.workflows SET kestra_flow_id = $1 WHERE id = $2', [primaryFlowId || data.name, wf.id])
    } catch (err) {
      console.error('Kestra deploy failed:', err)
    }

    return NextResponse.json(workflow, { status: 201 })
  } catch (e) {
    return authErrorResponse(e)
  }
}
