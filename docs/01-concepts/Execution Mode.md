---
status: stable
---
# Execution Mode

> How a workflow run is initiated and whether it requires human intervention.

## Why it exists
Not every workflow should run unattended. Some are fire-and-forget; some need human review before acting.

## Modes in Kestra

| Mode | How It Works | Flowcore Example |
|------|-------------|-----------------|
| **Automatic** | Trigger fires → tasks execute immediately | recall-reminder, appointment-reminder, treatment-followup |
| **Approval-gated** | Trigger fires → tasks run until a `Pause` (no duration) → human resumes via UI/API | claims-followup |
| **Manual** | No trigger — flow is executed via Kestra UI or API only | Ad-hoc workflows |

## Approval gates in practice
The claims-followup flow uses a `Pause` task with no `delay` property. This halts execution indefinitely until someone clicks "Resume" in the Kestra UI or calls the resume API endpoint. After resuming, the flow re-queries Open Dental to check if the claim has been resolved while waiting.

## See also
- [[Approval Task]]
- [[Workflow]]
