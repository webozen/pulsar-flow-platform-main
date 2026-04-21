---
status: stable
---
# Creating a Workflow

A workflow is an automation: run a SQL query on a schedule, and for each result row, execute a sequence of actions (SMS, email, delay, approval gate).

## Steps

1. Go to **Clinics** → select a clinic → **Workflows** → **Create Workflow**
2. Fill in:
   - **Name** — e.g., "Overdue Recall Reminders"
   - **Description** — what this workflow does
3. Configure the **Trigger**:
   - **Cron schedule** — when to run (default: `0 7 * * *` = 7am daily)
   - **SQL Query** — the query sent to the data source API
4. Add **Actions** — what happens for each result row:
   - **SMS** — send a text message via Twilio
   - **Email** — send an email
   - **Delay** — pause for a duration (e.g., `P3D` = 3 days)
   - **Approval Gate** — pause until a human approves
5. Click **Create & Deploy**

## Template Variables

Every column from your SQL query result becomes a template variable:

```
SQL: SELECT p.FName, p.Email, p.WirelessPhone FROM patient p WHERE ...

Available in actions:
  {{ taskrun.value.FName }}          → "Alice"
  {{ taskrun.value.Email }}          → "alice@example.com"
  {{ taskrun.value.WirelessPhone }}  → "+14155550101"
```

Clinic config is available via `kv()`:
```
  {{ kv('clinic_name') }}        → "Smile Dental Care"
  {{ kv('clinic_phone') }}       → "(415) 555-1234"
```

## Example: Recall Reminder

**SQL:**
```sql
SELECT p.PatNum, p.FName, p.LName, p.Email, p.WirelessPhone, r.DateDue
FROM recall r
JOIN patient p ON p.PatNum = r.PatNum
WHERE r.DateDue < CURDATE()
  AND r.IsDisabled = 0
  AND p.PatStatus = 0
LIMIT 100
```

**Actions:**
1. SMS → `Hi {{ taskrun.value.FName }}, this is {{ kv('clinic_name') }}. You're due for a dental visit. Call us at {{ kv('clinic_phone') }}.`
2. Delay → `P3D` (wait 3 days)
3. Email → Subject: `{{ taskrun.value.FName }}, time for your checkup` / Body with clinic info

## What Happens Under the Hood

1. App saves the workflow to Postgres
2. App generates a Kestra YAML flow from your config
3. App deploys the YAML to the clinic's Kestra namespace via API
4. Kestra runs the flow on your cron schedule
5. The flow calls the data source API with your SQL
6. For each result row, it executes your action sequence
7. Results appear in the clinic portal at `/portal/{slug}/executions`

## See Also

- [[Action]]
- [[Trigger]]
- [[Execution Mode]]
