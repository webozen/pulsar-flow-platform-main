---
status: stable
---
# Workflow

> A YAML flow definition in Kestra that ties a trigger to a sequence of tasks with branching, delays, and approval gates.

## Why it exists
Dental practices need to declare "when X happens in Open Dental, do Y then Z then maybe wait a day and do W". A workflow is the unit of that declaration — stored as a YAML file, version-controlled in Git, and deployed to Kestra.

## Shape
Each workflow is a `.yml` file in `kestra/flows/dental/` with:
- `id` — unique flow identifier
- `namespace` — clinic scope (e.g., `dental.clinic-a`)
- `triggers` — what fires it ([[Trigger]])
- `tasks` — ordered sequence with branching (`If`, `Switch`, `ForEach`, `Pause`)
- `labels` — metadata tags (e.g., `workflow-type: recall-reminder`)

## Lifecycle
Flows are loaded into Kestra via the API or mounted from the filesystem. Triggers fire automatically based on their schedule or polling interval. Each trigger match creates an execution (run) visible in the Kestra UI.

## The four dental workflows
1. **recall-reminder** — overdue recall outreach with SMS → delay → email escalation
2. **appointment-reminder** — multi-stage confirmation (48h, 24h, 2h before)
3. **claims-followup** — stale insurance claims with human approval gate
4. **treatment-followup** — unscheduled treatment plans with escalation to front desk

## See also
- [[Trigger]]
- [[Action]]
- [[Execution Mode]]
- [[Correlation Key]]
