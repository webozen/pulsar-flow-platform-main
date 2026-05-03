---
status: stable
last-reviewed: 2026-05-02
---
# Correlation Key

> A deduplication strategy using a per-clinic `dental_automation_log` table to prevent duplicate patient outreach.

## Why it exists
Without dedup, a patient could receive the same recall reminder every time the cron fires. The correlation-key pattern ensures each patient is contacted at most once per configured window.

## How it works
Workflows that need dedup add an HTTP query at the top of the worker subflow that hits the data source with a `SELECT COUNT(*)` against `dental_automation_log`:

```yaml
- id: check_dedup
  type: io.kestra.plugin.core.http.Request
  uri: "{{ kv('source_api_url') }}/queries/ShortQuery"
  method: PUT
  headers:
    Authorization: "ODFHIR {{ kv('source_api_key') }}"
    Content-Type: application/json
  body: |
    {"SqlCommand": "SELECT COUNT(*) AS cnt FROM dental_automation_log WHERE patient_id = {{ inputs.record.PatNum }} AND workflow_type = 'recall_reminder' AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)"}
```

If `cnt > 0`, the worker exits early via an `If` condition. After successful outreach, the worker `INSERT`s a row into the same log via another HTTP call. (Open Dental's ShortQuery is read-only by default; clinics that need writes provision a separate API key with the audit-log table whitelisted.)

## Dedup windows (template defaults)

| Template | Window |
|----------|--------|
| recall-reminder | 30 days |
| appointment-reminder | 3 days (per appointment) |
| claims-followup | 60 days (per claim) |
| treatment-followup | 30 days |

These are starting points — the operator can tune them in the workflow editor.

## The `dental_automation_log` table
Lives in each clinic's Open Dental MySQL. Schema in `scripts/sql/V1__dental_automation_log.sql`. Indexed on `(patient_id, workflow_type, created_at)` for fast lookups.

## See also
- [[Trigger]]
- [[Workflow]]
- [[ADR-009 Open Dental API over Direct MySQL]]
