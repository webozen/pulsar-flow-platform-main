---
status: stable
last-reviewed: 2026-05-02
---
# Start Here

Flowcore is a **multi-tenant workflow automation platform** built on [Kestra](https://kestra.io) OSS, fronted by a custom **Next.js orchestrator** that authors, deploys, and operates flows on behalf of tenants. The first vertical is dental practice automation (Open Dental), but the platform is designed to be industry-agnostic.

> [!note] Authoritative source
> The top-level `README.md` is the source of truth for the *current* architecture. These notes elaborate on it. If a doc here disagrees with the README, trust the README and file an issue against the doc.

## Architecture at a Glance

```
Next.js Orchestrator (:3002)  →  Kestra OSS (:8080)  →  Open Dental API
     │                               │                      │
  Tenant + workflow CRUD         Runs YAML flows         Executes SQL queries
  Workflow YAML generator        Namespace isolation     Returns rows as JSON
  Approval inbox + portal        Scheduling + retries    Read-only access
  JWT verification (from         Pause / approval gates
   pulsar-backend)               Postgres-backed queue
```

The Next.js app at `app/` is the **entry point**. It stores tenant + workflow metadata in its own `flowcore` schema (Postgres, alongside Kestra's own schema), compiles `WorkflowDef` records to Kestra YAML on demand via `app/src/lib/workflow-generator.ts`, and `PUT`s them to Kestra at deploy time. Per-tenant runtime credentials (OD API key, Twilio, SMTP) are stored as **Kestra namespace secrets / KV** — not as rows in the `flowcore` schema.

A separate Spring Boot service (`pulsar-backend`, port `18080`) owns identity and tenant lifecycle and pushes tenants into the orchestrator via a server-to-server `tenant-sync` channel. **Per-tenant business credentials** (Gemini, OpenDental, Twilio, Plaud) live in pulsar-backend's `pulsar_t_<slug>.tenant_credentials` table — not in this repo.

## Reading order

### Architecture
1. [[System Overview]] — Cross-repo: backend + flow-platform + frontend, end-to-end flow, multi-tenancy
2. [[Platform Architecture]] — Flow-platform internals (orchestrator + Kestra + data source)
3. [[Execution Flow]] — End-to-end: trigger → query → actions → results

### Concepts
3. [[Tenant Isolation]] — Namespace-per-tenant multi-tenancy
4. [[Workflow]] — Generated YAML flow definitions in Kestra
5. [[Trigger]] — Cron schedules + HTTP-based queries
6. [[Action]] — SMS, email, HTTP, pause, approval gates
7. [[Execution Mode]] — Auto, approval-gated, and manual
8. [[Correlation Key]] — Dedup strategy
9. [[Scheduled Continuation]] — Pause/resume mechanics
10. [[Approval Task]] — Human-in-the-loop

### Guides
11. [[Adding a New Tenant]] — How to onboard a new clinic/business via the UI
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
