---
status: stable
---
# Trigger

> An event source that fires a workflow. Kestra supports JDBC polling, cron schedules, webhooks, and more.

## Why it exists
Workflows need something to start them. Triggers connect external events (database changes, time-based schedules, incoming webhooks) to workflow execution.

## Types used in Flowcore

### JDBC MySQL Trigger
Polls Open Dental's MySQL database on an interval. Fires when the SQL query returns rows.

```yaml
triggers:
  - id: poll_overdue_recalls
    type: io.kestra.plugin.jdbc.mysql.Trigger
    url: "{{ kv('opendental_jdbc_url') }}"
    username: "{{ kv('opendental_db_user') }}"
    password: "{{ secret('OPENDENTAL_DB_PASSWORD') }}"
    sql: |
      SELECT p.PatNum, p.FName, ...
      FROM recall r JOIN patient p ON ...
      WHERE r.DateDue < CURDATE()
    interval: PT5M
    fetchType: FETCH_ONE
```

### Cron Schedule Trigger
Fires on a cron schedule. Used by appointment-reminder (7am daily).

```yaml
triggers:
  - id: morning_check
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "0 7 * * *"
    timezone: "{{ kv('timezone') }}"
```

## Lifecycle
Kestra manages trigger state automatically. JDBC triggers track what's been seen. Cron triggers fire at the specified time. Each trigger firing creates a new execution.

## Common mistakes
- Forgetting to filter by active patients (`PatStatus = 0`) in SQL queries
- Setting intervals too short — `PT1M` on a large table will create load
- Not including `LIMIT` in SQL queries — unbounded result sets can overwhelm

## See also
- [[Workflow]]
- [[Correlation Key]]
