---
status: stable
last-reviewed: 2026-05-02
---
# Action

> A Kestra task that executes one step of a workflow — calling an API, sending email, pausing, or branching.

## Why it exists
Every side effect a workflow can take is a task. Kestra provides 1,200+ built-in task types. Flowcore uses a focused subset; the orchestrator's workflow generator only emits these.

## Tasks emitted by the workflow generator

| Task Type | Purpose | Example |
|-----------|---------|---------|
| `io.kestra.plugin.core.http.Request` | Open Dental ShortQuery API; Twilio SMS API; any REST data source | PUT to `/queries/ShortQuery`; POST to Twilio Messages API |
| `io.kestra.plugin.notifications.mail.MailSend` | Send email via SMTP | Recall reminder email |
| `io.kestra.plugin.core.flow.Pause` | Delay (`delay: P3D`) or human approval gate (no `delay`) | Wait 3 days, or wait for billing-team approval |
| `io.kestra.plugin.core.flow.If` | Conditional branching | "If patient has email, send it" |
| `io.kestra.plugin.core.flow.Switch` | Multi-way branch | Route by contact method |
| `io.kestra.plugin.core.flow.ForEach` | Loop over rows in the parent flow | Fan out one worker subflow per appointment |
| `io.kestra.plugin.core.flow.Subflow` | Dispatch a row to the per-row worker | Parent → `{flowId}-run` with `inputs.record` |

JDBC tasks (`io.kestra.plugin.jdbc.mysql.Query` etc.) are **not** used by generated workflows — per [[ADR-009 Open Dental API over Direct MySQL]], all data-source access happens over HTTP.

## Action types in the UI (`actions` column)
The orchestrator's UI offers these action types, each of which compiles to one or more Kestra tasks:

| UI action type | Compiles to |
|---|---|
| `sms` | `Request` (POST Twilio Messages API) |
| `email` | `MailSend` |
| `pause` (with `duration`) | `Pause` with `delay` |
| `condition` | `If` |
| `approval` | `Pause` with no `delay` (worker is now human-gated) |

## Template resolution
Task configs use Kestra's Pebble template engine. Inside a worker subflow, the row is available as `inputs.record`:

- `{{ inputs.record.FName }}` — column from the data-source query
- `{{ kv('clinic_name') }}` — namespace KV value
- `{{ secret('TWILIO_AUTH_TOKEN') }}` — namespace secret

## See also
- [[Workflow]]
- [[Trigger]]
- [[Execution Mode]]
- [[ADR-009 Open Dental API over Direct MySQL]]
