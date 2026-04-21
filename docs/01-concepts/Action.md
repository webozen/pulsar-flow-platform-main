---
status: stable
---
# Action

> A Kestra task that executes one step of a workflow — sending SMS, email, querying a database, pausing, or branching.

## Why it exists
Every side effect a workflow can take is a task. Kestra provides 1,200+ built-in task types. Flowcore uses a focused subset for dental automation.

## Tasks used in Flowcore

| Task Type | Purpose | Example |
|-----------|---------|---------|
| `io.kestra.plugin.core.http.Request` | Call external APIs (Twilio SMS) | POST to Twilio Messages API |
| `io.kestra.plugin.notifications.mail.MailSend` | Send email via SMTP | Recall reminder email |
| `io.kestra.plugin.jdbc.mysql.Query` | Query/write to MySQL | Dedup check, audit log insert |
| `io.kestra.plugin.core.flow.Pause` | Delay or human approval gate | Wait 3 days, or wait for billing team |
| `io.kestra.plugin.core.flow.If` | Conditional branching | "If patient has email, send it" |
| `io.kestra.plugin.core.flow.Switch` | Multi-way branch | Route by contact method |
| `io.kestra.plugin.core.flow.ForEach` | Loop over rows | Process each unconfirmed appointment |

## Template resolution
Task configs use Kestra's Pebble template engine: `{{ trigger.row.FName }}`, `{{ kv('clinic_name') }}`, `{{ secret('TWILIO_AUTH_TOKEN') }}`.

## See also
- [[Workflow]]
- [[Trigger]]
- [[Execution Mode]]
