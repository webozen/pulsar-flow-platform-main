---
status: stable
last-reviewed: 2026-05-02
---
# Execution Mode

> How a workflow run is initiated and whether it requires human intervention. Stored as `flowcore.workflows.actionMode`; the workflow generator emits different YAML for each.

## Why it exists
Not every workflow should run unattended. Some are fire-and-forget; some need human review before acting; some are only for ad-hoc, human-driven runs.

## Modes

| Mode (`actionMode`) | How It Works | Typical Template |
|------|-------------|-----------------|
| **`immediate`** | Cron trigger fires → parent queries data source → ForEach spawns worker per row → worker executes actions immediately | Recall reminder, appointment reminder, treatment follow-up |
| **`on_approval`** | Cron trigger fires → ForEach spawns worker per row → worker hits `Pause` (no `delay`) → human approves in `/automation/approvals` → actions execute | Claims follow-up |
| **`manual`** | No parent flow, no cron. The worker subflow is webhook-triggered with a record in the body | Ad-hoc one-off campaigns |

## Approval gates in practice
For `actionMode = on_approval`, the worker subflow includes a `Pause` task with no `delay` property right after the row is loaded. This halts the worker indefinitely until someone resumes it via:

- **The Pulsar UI** (`/automation/approvals`) — primary path; runs through the orchestrator's `POST /api/approvals/{id}/resume` route, which verifies JWT, rate-limits, then forwards to Kestra
- **The Kestra OSS UI** (`:8080`) — engineer-only fallback

After resuming, the worker re-queries the data source to check if the situation resolved while paused. See [[Approval Task]] for details.

## See also
- [[Approval Task]]
- [[Workflow]]
- [[System Overview]] §2 — end-to-end approval journey
