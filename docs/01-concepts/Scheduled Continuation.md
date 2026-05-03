---
status: stable
last-reviewed: 2026-05-02
---
# Scheduled Continuation

> A paused worker subflow that will automatically resume after a specified duration.

## Why it exists
A workflow like "send a reminder, wait 3 days, send another" is the normal case. Kestra's `Pause` task with a `delay` property handles this natively — the engine persists the execution state and resumes it when the duration elapses.

## How it works

```yaml
- id: wait_3_days
  type: io.kestra.plugin.core.flow.Pause
  delay: P3D
```

Kestra persists the execution state in its Postgres backend. After 3 days, the worker continues with the next task. This survives Kestra restarts.

## Re-validation after resume
After any pause, Flowcore workers re-query Open Dental over HTTP (per [[ADR-009 Open Dental API over Direct MySQL]]) to check if the situation resolved:

```yaml
- id: recheck_appointment
  type: io.kestra.plugin.core.http.Request
  uri: "{{ kv('source_api_url') }}/queries/ShortQuery"
  method: PUT
  headers:
    Authorization: "ODFHIR {{ kv('source_api_key') }}"
    Content-Type: application/json
  body: |
    {"SqlCommand": "SELECT COUNT(*) AS has_appt FROM appointment WHERE PatNum = {{ inputs.record.PatNum }} AND AptStatus = 1 AND AptDateTime > NOW()"}
```

This prevents stale actions (e.g., sending a follow-up email to a patient who already scheduled).

## Durations used (template defaults)

| Template | Pause | Purpose |
|------|-------|---------|
| recall-reminder | P3D | Wait before email follow-up |
| appointment-reminder | P1D, PT22H | Between SMS → email → final SMS |
| treatment-followup | P7D | Wait before escalation to front desk |

The operator can tune these in the workflow editor — they aren't baked into static YAML.

## See also
- [[Approval Task]] — pause without duration (waits for human)
- [[Workflow]]
