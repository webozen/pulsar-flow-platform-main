---
status: stable
---
# Execution Flow

> End-to-end: Kestra trigger → dedup check → actions → pause/resume → re-validate → escalate.

## Sequence

```mermaid
sequenceDiagram
    participant OD as Open Dental MySQL
    participant K as Kestra Engine
    participant T as Twilio (SMS)
    participant M as SMTP (Email)
    participant UI as Kestra UI (Human)

    Note over K: Trigger fires (JDBC poll or cron)
    K->>OD: SELECT overdue recalls / appointments / claims
    OD-->>K: Result rows

    K->>OD: Check dental_automation_log (dedup)
    OD-->>K: count = 0 (new)

    alt SMS available
        K->>T: POST /Messages.json
        T-->>K: 201 Created
    end

    K->>OD: INSERT into dental_automation_log

    alt Has approval gate (claims-followup)
        K->>UI: Pause execution (await human)
        UI-->>K: Resume (billing team approves)
        K->>OD: Re-check claim status (re-validate)
    end

    alt Has delay (recall/appointment/treatment)
        Note over K: Pause P3D / P1D / P7D
        K->>OD: Re-query patient status
        alt Still needs action
            K->>M: Send follow-up email
            K->>OD: Log escalation
        end
    end
```

## Key invariants

1. **Dedup first.** Every flow checks `dental_automation_log` before acting. A patient won't receive duplicate outreach within the configured window.

2. **Re-validate after pause.** After any delay or human approval, the flow re-queries Open Dental to check if the situation resolved. This prevents stale actions.

3. **Namespace isolation.** Each clinic runs in its own Kestra namespace with separate KV variables, secrets, and execution history.

4. **At-least-once semantics.** The dedup table mitigates duplicate sends on engine restart.

## Trigger types

| Trigger | Flows | Interval |
|---------|-------|----------|
| JDBC MySQL poll | recall-reminder, claims-followup, treatment-followup | PT5M to P1D |
| Cron schedule | appointment-reminder | 7am daily |

## Task types used

| Kestra Task | Purpose |
|-------------|---------|
| `io.kestra.plugin.jdbc.mysql.Trigger` | Poll Open Dental tables |
| `io.kestra.plugin.jdbc.mysql.Query` | Dedup check, re-validation, audit log insert |
| `io.kestra.plugin.core.http.Request` | Twilio SMS API |
| `io.kestra.plugin.notifications.mail.MailSend` | Email via SMTP |
| `io.kestra.plugin.core.flow.Pause` | Delay (with duration) or human approval (no duration) |
| `io.kestra.plugin.core.flow.If` | Conditional branching |
| `io.kestra.plugin.core.flow.Switch` | Multi-way branching |
| `io.kestra.plugin.core.flow.ForEach` | Iterate over query result rows |
