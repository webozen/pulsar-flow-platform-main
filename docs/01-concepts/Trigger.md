---
status: stable
last-reviewed: 2026-05-02
---
# Trigger

> An event source that fires a workflow. Kestra supports cron schedules, webhooks, and (via plugins) JDBC polling and many more. Flowcore's generated flows use **cron** as the default and **webhook** for manual-mode workflows.

## Why it exists
Workflows need something to start them. Triggers connect external events (time-based schedules, incoming webhooks) to workflow execution.

## Types used in Flowcore

### Cron Schedule Trigger
The default for every generated parent flow. The orchestrator fills `cron` from the workflow's `triggerCron` column (e.g. `0 7 * * *` for 7am daily).

```yaml
triggers:
  - id: scheduled
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "0 7 * * *"
    timezone: "{{ kv('timezone') }}"
```

After the trigger fires, the very next task in the parent flow is an HTTP `Request` against the data source (Open Dental ShortQuery API or equivalent). See [[ADR-009 Open Dental API over Direct MySQL]] for why we don't poll the database directly.

### Webhook Trigger
Used for `actionMode = manual` workflows — they don't have a parent flow at all; the **worker** flow is triggered directly with a record in the body.

```yaml
triggers:
  - id: webhook
    type: io.kestra.plugin.core.trigger.Webhook
    key: "{{ workflow.id }}-manual-{{ kv('webhook_token') }}"
```

## Lifecycle
Kestra manages trigger state automatically. Cron triggers fire at the specified time. Webhook triggers fire on inbound POST. Each trigger firing creates a new execution. The parent flow then fans out via `ForEach` so that each row of the query result becomes its **own** worker execution — see [[Workflow]].

## Common mistakes
- Forgetting to filter by active patients (`PatStatus = 0`) in SQL queries
- Setting cron intervals too frequent — `* * * * *` on a large patient table will create load
- Not including `LIMIT` in SQL queries — Open Dental's ShortQuery returns max 100 rows per call but other data sources may not be capped

## See also
- [[Workflow]]
- [[Correlation Key]]
- [[ADR-009 Open Dental API over Direct MySQL]]
