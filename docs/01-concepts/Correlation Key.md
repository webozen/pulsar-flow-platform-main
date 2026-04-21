---
status: stable
---
# Correlation Key

> A deduplication strategy using the `dental_automation_log` table to prevent duplicate patient outreach.

## Why it exists
Without dedup, a patient could receive the same recall reminder every 5 minutes (on every trigger poll). The correlation key pattern ensures each patient is contacted at most once per configured window.

## How it works
Every workflow starts with a dedup check:

```yaml
- id: check_dedup
  type: io.kestra.plugin.jdbc.mysql.Query
  sql: |
    SELECT COUNT(*) as cnt
    FROM dental_automation_log
    WHERE patient_id = {{ trigger.row.PatNum }}
      AND workflow_type = 'recall_reminder'
      AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
```

If `cnt > 0`, the flow skips all business logic via an `If` condition. After successful outreach, a row is inserted into the log.

## Dedup windows

| Workflow | Window |
|----------|--------|
| recall-reminder | 30 days |
| appointment-reminder | 3 days (per appointment) |
| claims-followup | 60 days (per claim) |
| treatment-followup | 30 days |

## The `dental_automation_log` table
Lives in each clinic's Open Dental MySQL. Created by `scripts/sql/V1__dental_automation_log.sql`. Indexed on `(patient_id, workflow_type, created_at)` for fast lookups.

## See also
- [[Trigger]]
- [[Workflow]]
