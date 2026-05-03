---
status: stable
last-reviewed: 2026-05-02
---
# Execution Flow

> End-to-end: scheduled trigger → HTTP query → ForEach → per-row worker → optional pause → resume → action(s).

This page describes what happens **inside Kestra** for a single row. For the cross-system flow (UI click → resume → Twilio), see [[System Overview]] §2.

## Sequence

```mermaid
sequenceDiagram
    participant K as Kestra (parent flow)
    participant W as Kestra (worker subflow)
    participant OD as Open Dental API
    participant T as Twilio (SMS)
    participant M as SMTP (Email)
    participant U as Approvals UI (Human)

    Note over K: Trigger fires (cron)
    K->>OD: PUT /queries/ShortQuery (read-only SQL)
    OD-->>K: JSON rows
    Note over K: ForEach rows → spawn one worker per row<br/>Parent finishes (wait: false)

    W->>W: inputs.record = JSON-stringified row

    alt Has approval gate (claims-followup, etc.)
        W-->>U: PAUSED (visible in /approvals)
        U->>W: Resume (Pulsar UI → /api/approvals/{id}/resume)
    end

    alt Has scheduled delay (recall/treatment/appointment)
        Note over W: Pause P3D / P1D / P7D<br/>Kestra persists state
        W->>OD: Re-query patient status (re-validation)
    end

    alt Should act
        W->>T: POST Twilio Messages API
        T-->>W: 201 Created
    end

    alt Has email step
        W->>M: SMTP send
        M-->>W: ack
    end

    Note over W: Execution → SUCCESS<br/>Visible in portal history
```

## Key invariants

1. **One execution per row.** The parent flow fans out via `ForEach`; each row is its own worker execution. This makes Approve/Reject in the UI unambiguous (Kestra OSS 0.19.x ignores `taskRunId` on resume — see [[System Overview]] §2).

2. **Re-validate after pause.** After any delay or human approval, the worker re-queries the data source to check if the situation resolved (e.g., the patient already booked, the claim was paid). This prevents stale actions.

3. **Namespace isolation.** Each clinic runs in its own Kestra namespace (`dental.<slug>`) with separate KV variables, secrets, and execution history. See [[Tenant Isolation]].

4. **At-least-once semantics.** Workflow templates that need stronger dedup pair the action with a per-clinic `dental_automation_log` lookup (see [[Correlation Key]]).

## Trigger types

| Trigger | When to use | Notes |
|---------|------------|-------|
| `io.kestra.plugin.core.trigger.Schedule` (cron) | Default for every generated workflow | The orchestrator fills in cron from `flowcore.workflows.triggerCron`. |
| `io.kestra.plugin.core.trigger.Webhook` | Manual / event-driven workflows | Used when `actionMode = manual`. |

JDBC polling triggers are not used — per [[ADR-009 Open Dental API over Direct MySQL]], data-source reads happen as HTTP requests inside the parent flow, not as the trigger itself.

## Task types used

| Kestra Task | Purpose |
|-------------|---------|
| `io.kestra.plugin.core.http.Request` | Open Dental ShortQuery API; Twilio Messages API |
| `io.kestra.plugin.notifications.mail.MailSend` | Email via SMTP |
| `io.kestra.plugin.core.flow.Pause` | Delay (with `delay`) or human approval (no `delay`) |
| `io.kestra.plugin.core.flow.If` | Conditional branching (e.g., "if email present") |
| `io.kestra.plugin.core.flow.Switch` | Multi-way branching |
| `io.kestra.plugin.core.flow.ForEach` | Iterate over query result rows in the parent |
| `io.kestra.plugin.core.flow.Subflow` | Spawn the per-row worker execution |
