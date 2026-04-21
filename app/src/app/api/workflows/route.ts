import { NextResponse } from 'next/server'
import { query, queryOne, initDb } from '@/lib/db'
import { createOrUpdateFlowFromYaml } from '@/lib/kestra'
import { generateKestraYaml } from '@/lib/workflow-generator'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const rows = await query(
      'SELECT w.*, c.kestra_namespace FROM flowcore.workflows w JOIN flowcore.clinics c ON c.id = w.clinic_id WHERE w.clinic_id = $1 ORDER BY w.created_at DESC',
      [clinic.id]
    )
    return NextResponse.json(rows)
  } catch (e) {
    return authErrorResponse(e)
  }
}

export async function POST(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const data = await req.json()

    if (!data.name || !data.triggerSql) {
      return NextResponse.json({ error: 'name and triggerSql are required' }, { status: 400 })
    }

    const workflow = await queryOne(
      `INSERT INTO flowcore.workflows
        (clinic_id, name, description, trigger_type, trigger_cron, trigger_sql, actions, is_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        clinic.id, data.name, data.description || null,
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
        actions: data.actions || [], namespace: clinic.kestra_namespace,
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
