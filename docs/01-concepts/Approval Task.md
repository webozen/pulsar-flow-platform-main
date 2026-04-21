---
status: stable
---
# Approval Task

> A human-gated pause: a workflow halts and waits for someone to click "Resume" before continuing.

## Why it exists
Some workflows shouldn't act automatically. Insurance claim follow-ups, for example, need a billing team member to review before sending notifications. Approval gates make human-in-the-loop a first-class pattern.

## How it works in Kestra
A `Pause` task with **no `delay` property** waits indefinitely:

```yaml
- id: await_billing_review
  type: io.kestra.plugin.core.flow.Pause
  # No delay = waits for human resume
```

The execution appears as "Paused" in Kestra's UI. A team member reviews the execution details (trigger data, patient info, claim details) and clicks "Resume" to continue, or terminates the execution to reject.

## After approval
The flow re-queries Open Dental to check if the situation changed while waiting (the claim may have been paid in the meantime). This re-validation prevents stale actions.

## Where it's used
Currently only the **claims-followup** workflow uses an approval gate. Other workflows run automatically with dedup and re-validation as safety nets.

## See also
- [[Execution Mode]]
- [[Scheduled Continuation]] — pause with duration (automatic resume)
- [[Workflow]]
