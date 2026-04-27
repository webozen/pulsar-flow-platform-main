---
status: stable
---
# Start Here

Flowcore is a **multi-tenant workflow automation platform** built on [Kestra](https://kestra.io) OSS. The first vertical is dental practice automation (Open Dental), but the platform is designed to be industry-agnostic.

## Architecture at a Glance

```
Next.js App (:3000)  →  Kestra Engine (:8080)  →  Data Source API (e.g., Open Dental)
     │                        │                          │
  Clinic CRUD             Runs YAML flows            Executes SQL queries
  Workflow builder        Namespace isolation         Returns data as JSON
  Dashboard + Portal      Scheduling + retries        Read-only access
  Auth + multi-tenancy    Pause / approval gates
```

## Reading order

### Architecture
1. [[System Overview]] — Cross-repo: backend + flow-platform + frontend, end-to-end flow, multi-tenancy
2. [[Platform Architecture]] — Flow-platform internals (app + Kestra + data source)
3. [[Execution Flow]] — End-to-end: trigger → query → actions → results

### Concepts
3. [[Tenant Isolation]] — Namespace-per-tenant multi-tenancy
4. [[Workflow]] — YAML flow definitions in Kestra
5. [[Trigger]] — Cron schedules + API-based SQL queries
6. [[Action]] — SMS, email, HTTP, pause, approval gates
7. [[Execution Mode]] — Auto, approval-gated, and manual
8. [[Correlation Key]] — Dedup strategy
9. [[Scheduled Continuation]] — Pause/resume mechanics
10. [[Approval Task]] — Human-in-the-loop

### Guides
11. [[Adding a New Tenant]] — How to onboard a new clinic/business
12. [[Creating a Workflow]] — Building automations via the UI
13. [[Adapting for a New Vertical]] — How to use Flowcore for non-dental businesses
14. [[Local Development]] — Running the full stack locally

### Decisions
- [[ADR-008 Replace Flowcore with Kestra OSS]]
- [[ADR-009 Open Dental API over Direct MySQL]]

## Where things live

```
docs/
├── 00-start-here.md          ← you are here
├── 01-concepts/              ← primitives, one page each
├── 02-architecture/          ← system design
├── 03-guides/                ← how-tos
└── 06-decisions/             ← ADRs
```
