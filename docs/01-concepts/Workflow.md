---
status: stable
last-reviewed: 2026-05-02
---
# Workflow

> A YAML flow definition in Kestra that ties a trigger to a sequence of tasks with branching, delays, and approval gates. In Flowcore, these YAML files are **generated at deploy time** from a `flowcore.workflows` row — not hand-written.

## Why it exists
Dental practices need to declare "when X happens, do Y then Z then maybe wait a day and do W". A workflow is the unit of that declaration. In the orchestrator it's a typed `WorkflowDef` record (name, trigger cron, action mode, action sequence). At deploy time the orchestrator compiles it to Kestra YAML and `PUT`s it to Kestra.

## Shape (in the database)
A row in `flowcore.workflows` has, roughly:
- `id`, `clinicId`, `name`, `description`
- `triggerEvent`, `triggerCron` (or `webhook` for manual mode)
- `actionMode` — `immediate` | `on_approval` | `manual`
- `actions` — JSON array of `{ type: "sms" | "email" | "pause" | "condition" | "approval", ... }`
- `taskTitle`, `taskPriority` (used to render approval cards)

## Shape (after compilation, in Kestra)
The orchestrator's `app/src/lib/workflow-generator.ts` emits a **pair** of flows per workflow:

- `{flowId}` — parent. Trigger (cron or webhook), HTTP query against the data source, `ForEach` over the rows, `Subflow` to dispatch each row to the worker. Parent finishes immediately (`wait: false`).
- `{flowId}-run` — worker subflow. Takes `inputs.record` (the row), optionally pauses on an approval gate, then executes the action sequence with clean `{{ inputs.record.field }}` templating.

Both YAML documents include:
- `id` — flow identifier
- `namespace` — `dental.<slug>`
- `labels` — `workflow-type`, `clinic-slug`
- `tasks` — the compiled task list

## Lifecycle
1. Operator creates / edits a workflow at `/clinics/{slug}/workflows/{id}` (proxied as `/automation/clinics/...` from `pulsar-frontend`)
2. Orchestrator persists to Postgres
3. On Deploy, orchestrator generates parent + worker YAML and `PUT`s to `PUT /api/v1/flows/dental.<slug>/{id}` and `.../{id}-run`
4. Trigger fires automatically on its cron; each match becomes one parent execution → N worker executions

## The four dental workflow templates
Pre-built starting points in `app/src/lib/workflow-templates.ts`. The operator picks one in the UI, customises, and deploys — at which point it becomes a normal generated workflow like any other.

1. **Recall reminder** — overdue recall outreach with SMS → delay → email escalation
2. **Appointment reminder** — multi-stage confirmation (48h, 24h, 2h before)
3. **Claims follow-up** — stale insurance claims with human approval gate
4. **Treatment follow-up** — unscheduled treatment plans with escalation to front desk

These are *templates*, not static `.yml` files staged on disk. There is no `kestra/flows/dental/` directory.

## See also
- [[Trigger]]
- [[Action]]
- [[Execution Mode]]
- [[Correlation Key]]
- [[Platform Architecture]] — where the YAML generator fits
