---
status: stable
last-reviewed: 2026-05-02
---
# Creating a Workflow

A workflow is an automation: run a SQL query (over HTTP) on a schedule, and for each result row, execute a sequence of actions (SMS, email, delay, approval gate). All authoring happens in the orchestrator UI; YAML is generated for you on Deploy.

## Steps

1. Go to **Clinics** → select a clinic → **Workflows** → **Create Workflow**
2. Optionally pick a **template** (Recall reminder, Appointment reminder, Claims follow-up, Treatment follow-up). Templates pre-fill the form; you can still customise.
3. Fill in:
   - **Name** — e.g., "Overdue Recall Reminders"
   - **Description** — what this workflow does
4. Configure the **Trigger**:
   - **Cron schedule** — when the parent flow runs (default: `0 7 * * *` = 7am daily)
   - **SQL Query** — the query the parent sends to the data source's `PUT /queries/ShortQuery`
5. Pick an **Execution Mode** ([[Execution Mode]]):
   - `immediate` — actions run as soon as the row is received
   - `on_approval` — worker pauses on a human gate before acting
   - `manual` — no cron; webhook-triggered ad-hoc runs
6. Add **Actions** — what happens for each result row:
   - **SMS** — send a text message via Twilio
   - **Email** — send an email via SMTP
   - **Delay** — pause for a duration (e.g., `P3D` = 3 days)
   - **Approval gate** — pause until a human approves (`on_approval` mode adds one automatically; you can also add inline)
   - **Condition** — branch on a row field
7. Click **Create & Deploy**. The orchestrator persists the workflow in `flowcore.workflows`, generates the parent + worker subflow YAML via `app/src/lib/workflow-generator.ts`, and `PUT`s both to Kestra.

## Template Variables

The parent flow runs your SQL query and the result rows are dispatched, one per worker execution, as `inputs.record`. Inside actions, every column from your SQL is a template variable:

```
SQL: SELECT p.FName, p.Email, p.WirelessPhone FROM patient p WHERE ...

Available in actions (worker subflow):
  {{ inputs.record.FName }}          → "Alice"
  {{ inputs.record.Email }}          → "alice@example.com"
  {{ inputs.record.WirelessPhone }}  → "+14155550101"
```

Clinic config is available via `kv()` (per-namespace KV), and per-namespace secrets via `secret()`:

```
  {{ kv('clinic_name') }}             → "Smile Dental Care"
  {{ kv('clinic_phone') }}            → "(415) 555-1234"
  {{ secret('TWILIO_AUTH_TOKEN') }}   → "<set in Secrets UI>"
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
1. SMS → `Hi {{ inputs.record.FName }}, this is {{ kv('clinic_name') }}. You're due for a dental visit. Call us at {{ kv('clinic_phone') }}.`
2. Delay → `P3D` (wait 3 days)
3. Email → Subject: `{{ inputs.record.FName }}, time for your checkup` / Body with clinic info

## What Happens Under the Hood

1. Orchestrator saves the workflow to Postgres (`flowcore.workflows`)
2. Orchestrator's workflow generator emits **two** Kestra YAML documents:
   - Parent `{flowId}` — Schedule trigger + HTTP Request to data source + ForEach + Subflow per row
   - Worker `{flowId}-run` — `inputs.record`, optional Pause for approvals, the action sequence
3. Orchestrator `PUT`s both to `/api/v1/flows/dental.<slug>/...`
4. Kestra runs the parent on your cron, parent fans out workers, each worker executes one row's action sequence
5. Paused workers (approval-mode) appear in `/automation/approvals`
6. Completed runs appear in the clinic portal at `/portal/{slug}/executions`

## See Also

- [[Action]]
- [[Trigger]]
- [[Execution Mode]]
- [[Workflow]]
- [[Platform Architecture]]
