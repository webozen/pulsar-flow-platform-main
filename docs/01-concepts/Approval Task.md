---
status: stable
last-reviewed: 2026-05-02
---
# Approval Task

> A human-gated pause: a worker subflow halts and waits for someone to approve (or reject) it from the Pulsar UI before continuing.

## Why it exists
Some workflows shouldn't act automatically. Insurance claim follow-ups, for example, need a billing-team member to review before sending notifications. Approval gates make human-in-the-loop a first-class pattern.

## How it works in Kestra
A `Pause` task with **no `delay` property** inside the worker subflow waits indefinitely:

```yaml
- id: approval_gate
  type: io.kestra.plugin.core.flow.Pause
  # No delay = waits for human resume
```

Because each row is its own worker execution (see [[Workflow]]), exactly one paused gate exists per execution. That sidesteps Kestra OSS 0.19.x's `taskRunId`-on-resume bug — resuming the *execution* is unambiguous.

## How approvals are surfaced
The Pulsar UI's **Approvals inbox** (`/automation/approvals`) is the primary path:

1. The orchestrator polls Kestra for executions in `PAUSED` state in the user's namespace
2. Each paused execution becomes a card showing the row, action plan, and clinic context
3. Clicking Approve calls `POST /api/approvals/{executionId}/resume` on the orchestrator, which:
   - Verifies the JWT (issued by `pulsar-backend`)
   - Rate-limits via a token bucket
   - `POST`s `/api/v1/executions/{id}/resume` on Kestra
   - `INSERT`s into `flowcore.approval_audit`
4. Clicking Reject calls the matching `/kill` route — the worker terminates without acting

The Kestra OSS UI itself is reachable on `:8080` for engineers, but day-to-day approvers use the Pulsar UI.

## After approval
The worker re-queries the data source to check if the situation changed while it was paused (the claim may have been paid in the meantime). This re-validation prevents stale actions.

## Where it's used
Most commonly the **claims-followup** template uses an approval gate. Any workflow with `actionMode = on_approval` will get one — the orchestrator emits the `Pause` automatically.

## See also
- [[Execution Mode]]
- [[Scheduled Continuation]] — pause with duration (automatic resume)
- [[Workflow]]
- [[System Overview]] §2 — full UI-to-Twilio approval journey
