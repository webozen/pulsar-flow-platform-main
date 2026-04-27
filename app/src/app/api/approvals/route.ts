import { NextResponse } from 'next/server'
import { listExecutions } from '@/lib/kestra'
import { requireAuth, authErrorResponse } from '@/lib/pulsar-auth'
import { namespaceFor } from '@/lib/tenant-sync'

export const dynamic = 'force-dynamic'

interface ExecLite {
  id: string
  namespace: string
  flowId: string
  state?: { current: string }
  labels?: Array<{ key: string; value: string }>
  startDate?: string
  inputs?: Record<string, unknown>
  taskRunList?: Array<{
    id: string
    taskId: string
    state: { current: string }
  }>
}

/**
 * GET /api/approvals
 *
 * Returns one item per PAUSED execution that's marked as approval-card
 * material via its labels. We filter on:
 *
 *     labels[approval-queue-card] = "true"
 *
 * NOT a hardcoded list of flowIds — workflows are runtime, built by
 * tenants in the builder UI. Whichever flow generates an approval card
 * declares it via this label (the workflow generator emits it for any
 * flow that includes a Pause step). New approval-driven workflows just
 * work; no code change required to surface them in the queue.
 *
 * Kestra propagates flow-level labels onto every execution of that
 * flow, so the label is present on the exec object directly — no
 * separate flow lookup.
 *
 * Resume/skip targets the whole execution (Kestra OSS 0.19's
 * per-taskRun resume scoping is broken — see the subflow-per-row
 * architecture in workflow-generator.ts).
 */
export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    const data = await listExecutions({
      namespace: namespaceFor(slug),
      state: 'PAUSED',
      size: 100,
    })
    const execs = (data?.results ?? []) as ExecLite[]
    const items = execs
      .filter((e) => hasApprovalCardLabel(e.labels))
      .map((e) => {
        const gate = (e.taskRunList ?? []).find(
          (t) => t.taskId === 'approval_gate' && t.state?.current === 'PAUSED',
        )
        return {
          executionId: e.id,
          namespace: e.namespace,
          flowId: e.flowId,
          state: e.state?.current ?? 'PAUSED',
          labels: e.labels ?? [],
          startedAt: e.startDate ?? null,
          taskRunId: gate?.id ?? null,
          // Workflow generator emits worker flows with `inputs.record`;
          // accept legacy `inputs.row` too for any older shipped flow.
          recordPreview: parseRow(e.inputs?.record ?? e.inputs?.row),
        }
      })
    return NextResponse.json(items)
  } catch (e) {
    return authErrorResponse(e)
  }
}

/** True iff the execution carries the `approval-queue-card: "true"`
 *  label. Workflows that include a human approval step set this so the
 *  approval queue surfaces them automatically. */
export function hasApprovalCardLabel(labels: Array<{ key: string; value: string }> | undefined): boolean {
  if (!labels) return false
  return labels.some((l) => l.key === 'approval-queue-card' && l.value === 'true')
}

function parseRow(v: unknown): Record<string, unknown> | null {
  if (!v) return null
  if (typeof v === 'object') return v as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(v))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
