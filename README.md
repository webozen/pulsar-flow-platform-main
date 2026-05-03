# Flowcore — Pulsar Workflow Automation Platform

Workflow automation for vertical SaaS deployments (dental today, more coming),
powered by [Kestra](https://kestra.io) OSS as the workflow engine and a custom
**Next.js orchestrator app** that authors, deploys, and operates the flows on
behalf of tenants.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Docker Compose                                                         │
│                                                                         │
│  ┌──────────────┐         ┌────────────────────────┐                    │
│  │  PostgreSQL   │◄────────│  Kestra OSS            │                    │
│  │   (kestra +   │         │  - workflow runtime    │                    │
│  │    flowcore   │         │  - per-tenant ns       │                    │
│  │    schemas)   │         │  - approval gates      │                    │
│  └──────────────┘         │  - schedules            │                    │
│        ▲                   └────────────────────────┘                    │
│        │                              ▲                                  │
│        │                              │ deploys YAML                     │
│        │                              │ at runtime                       │
│        │                   ┌──────────┴─────────────┐                    │
│        └───────────────────┤  Next.js Orchestrator  │                    │
│                            │  (app/, port 3002)     │                    │
│                            │  - workflow generator  │                    │
│                            │  - clinics + secrets   │                    │
│                            │  - approval inbox      │                    │
│                            │  - playbook chat       │                    │
│                            └────────────┬───────────┘                    │
│                                         │ JWT + tenant-sync              │
└─────────────────────────────────────────┼────────────────────────────────┘
                                          │
                                ┌─────────▼──────────┐         ┌──────────────────┐
                                │   pulsar-backend    │         │ Open Dental MySQL │
                                │   (Spring Boot,     │         │ (external,         │
                                │   port 18080)       │         │  per clinic)       │
                                └─────────────────────┘         └──────────────────┘
```

The Next.js app at `app/` is the entry point — it stores tenant + workflow
metadata in its own `flowcore` schema (Postgres, alongside Kestra's own
schema), compiles `WorkflowDef` records to Kestra YAML on demand via
`app/src/lib/workflow-generator.ts`, and POSTs them to Kestra (`:8080`) at
deploy time. The Pulsar backend (`pulsar-backend`, port `18080`) calls the
orchestrator at `/api/automation/tenant-sync/*` with a shared HMAC-style
secret to keep tenant state aligned across the two systems.

**Multi-tenancy.** Each clinic is a Kestra namespace (e.g.,
`dental.clinic-a`) plus a `flowcore.clinics` row plus per-tenant secrets
in Kestra's namespace KV. Workflow generation, deployment, and execution
state are scoped per-namespace.

## Quick start (dev loop)

### Prerequisites

- Docker + Docker Compose (for Kestra + Postgres)
- Node 20 LTS (for the Next.js orchestrator app)
- A reachable `pulsar-backend` on `localhost:18080` (cookie/JWT issuer)
- (Optional, per-tenant runtime) Open Dental MySQL read-only access; Twilio;
  SMTP — those go into Kestra namespace secrets at clinic-onboard time.

### Bring everything up

```bash
# 1. Kestra + Postgres
docker compose up -d
# → Kestra UI on http://localhost:8080
# → Postgres on :5432 (kestra + flowcore schemas)

# 2. Apply Next.js app's flowcore schema
cd app
npm install
DATABASE_URL=postgresql://kestra:k3stra_dev@localhost:5432/kestra npm run migrate

# 3. Run the orchestrator (Next.js, port 3002)
cp .env.example .env.local                # edit JWT secret to match pulsar-backend
PORT=3002 \
DATABASE_URL=postgresql://kestra:k3stra_dev@localhost:5432/kestra \
KESTRA_API_URL=http://localhost:8080 \
PULSAR_JWT_SECRET="<must equal pulsar-backend's PULSAR_JWT_SECRET>" \
PULSAR_AUTOMATION_SYNC_SECRET="<must equal pulsar-backend's value>" \
NEXT_PUBLIC_PULSAR_APP_URL=http://localhost:5173 \
npm run dev
# → http://localhost:3002/automation
```

Open `http://localhost:5173/t/<slug>/automation` (with `pulsar-frontend`
running) — the Pulsar UI proxies `/automation` to the Next.js orchestrator.
Or hit `http://localhost:3002/automation/login` directly.

### Onboarding a new clinic

Done **through the Next.js UI** at `/automation/clinics`. The orchestrator:
- Creates a `flowcore.clinics` row.
- Provisions a Kestra namespace `dental.<slug>` and writes per-clinic config
  via the Kestra API.
- Surfaces the Secrets management UI for `OPENDENTAL_DB_PASSWORD`,
  `TWILIO_AUTH_TOKEN`, `SMTP_PASSWORD` — values are stored as Kestra namespace
  secrets, not in Postgres.
- Once you create a workflow in the UI, the orchestrator compiles it to
  Kestra YAML and `PUT`s it to `/api/v1/flows/dental.<slug>/<id>`.

There is no `setup.sh` or `add-clinic.sh` — those are dead references in
older docs. The full onboarding is UI-driven.

## Project structure

```
docker-compose.yml              # Kestra (v0.19.x) + Postgres
kestra/
  application.yml               # Kestra server config
  namespace-configs/            # Static per-clinic YAML templates (optional;
                                # the orchestrator generates these dynamically)
app/                            # Next.js 16 orchestrator (the entry point)
  src/app/
    api/
      workflows/                # CRUD + deploy/trigger
      clinics/                  # tenant CRUD
      approvals/                # approval inbox + decisions
      playbook/                 # AnythingLLM-backed chat
      automation/               # tenant-sync receiver from pulsar-backend
      ...
    clinics/[id]/workflows/     # workflow editor UI
    approvals/                  # approval inbox UI
    settings/                   # branding, secrets
  src/lib/
    workflow-generator.ts       # WorkflowDef → Kestra YAML
    workflow-templates.ts       # opinionated templates per vertical
    kestra.ts                   # Kestra API client
    pulsar-auth.ts              # JWT verification (matches pulsar-backend)
    tenant-sync.ts              # state replicator from pulsar-backend
  db/migrations/                # flowcore schema (clinics, workflows, approval_audit, …)
scripts/
  sql/V1__dental_automation_log.sql  # Dedup table for OD MySQL (per-clinic)
docs/                           # Obsidian-style architecture + concept notes
```

## Workflows (today)

The four dental workflow templates ship as compiled output of
`app/src/lib/workflow-templates.ts` — not as static YAML files:

| Template | Trigger (default) | What it does |
|---|---|---|
| Recall reminder | JDBC poll every 5min | Overdue recalls → SMS → wait 3 days → email if no appointment |
| Appointment reminder | Cron 7am daily | Unconfirmed appointments → SMS 48h → email 24h → final SMS 2h |
| Claims follow-up | JDBC poll daily | Stale claims >30 days → human approval gate → billing notification |
| Treatment follow-up | JDBC poll daily | Unscheduled treatments >14 days → SMS + email → wait 7 days → escalate |

Each is editable in the UI (action sequence, trigger schedule, manual mode).
Deploy compiles to a parent + per-row worker subflow pair (see the comment
header in `workflow-generator.ts` for why).

## Required environment variables

| Var | Required when | Notes |
|---|---|---|
| `DATABASE_URL` | always | Postgres DSN. Same DB as Kestra; flowcore lives in its own schema. |
| `KESTRA_API_URL` | always | Default `http://localhost:8080`. |
| `PULSAR_JWT_SECRET` | always | **Must equal** `pulsar-backend`'s value. JWT cookies issued by Pulsar are validated here. ≥32 chars. |
| `PULSAR_AUTOMATION_SYNC_SECRET` | always | Static shared secret on the `tenant-sync` server-to-server channel. Must equal `pulsar-backend`'s. |
| `NEXT_PUBLIC_PULSAR_APP_URL` | always | Used for "Back to Pulsar" link. Default `http://localhost:5173`. |
| `PUBLIC_APP_URL` | optional | Used in TwiML callbacks. Default `http://localhost:3002`. |
| `ANYTHINGLLM_API_KEY` | optional | For the playbook chat tab. Today shared across tenants; can be set in the Pulsar admin's `/admin/platform-settings` UI as of 2026-05. |

## Tests

```bash
cd app
npm test                         # vitest
npm run test:e2e                 # playwright
```

## Documentation

Detailed architecture and concept notes live in `docs/` (Obsidian vault
layout). Start with `docs/00-start-here.md`. Some pages still reference
the older "4 hand-written YAML workflows + setup.sh" model — those are
known-stale and queued for a follow-up cleanup; this README is
authoritative on the current architecture.
