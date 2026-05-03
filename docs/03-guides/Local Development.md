---
status: stable
last-reviewed: 2026-05-02
---
# Local Development

## Prerequisites
- Docker Desktop (for Kestra + Postgres)
- Node.js 20 LTS (for the Next.js orchestrator)
- npm
- A reachable `pulsar-backend` on `localhost:18080` if you want JWT login + tenant-sync to work end-to-end. For pure orchestrator hacking, you can stub it out.

## Start the Stack

```bash
# 1. Start Postgres + Kestra (host repo root)
cp .env.example .env
docker compose up -d
# → Kestra UI on http://localhost:8080
# → Postgres on :5432 (kestra + flowcore schemas in one DB)

# 2. Apply the orchestrator's flowcore schema migrations
cd app
npm install
DATABASE_URL=postgresql://kestra:k3stra_dev@localhost:5432/kestra \
  npm run migrate

# 3. Start the Next.js orchestrator on :3002
cp .env.example .env.local                 # then edit secrets (see below)
PORT=3002 \
DATABASE_URL=postgresql://kestra:k3stra_dev@localhost:5432/kestra \
KESTRA_API_URL=http://localhost:8080 \
PULSAR_JWT_SECRET="<must equal pulsar-backend's PULSAR_JWT_SECRET>" \
PULSAR_AUTOMATION_SYNC_SECRET="<must equal pulsar-backend's value>" \
NEXT_PUBLIC_PULSAR_APP_URL=http://localhost:5173 \
npm run dev
```

Open the app at:
- **Through pulsar-frontend:** http://localhost:5173/t/<slug>/automation (the SPA reverse-proxies `/automation/*` to the orchestrator)
- **Direct:** http://localhost:3002/automation/login

## Cross-system contract

`PULSAR_JWT_SECRET` and `PULSAR_AUTOMATION_SYNC_SECRET` **must be byte-identical** between this repo and `pulsar-backend`. They're how the two systems trust each other:

| Secret | Used for |
|---|---|
| `PULSAR_JWT_SECRET` | The orchestrator validates JWT cookies issued by pulsar-backend. ≥32 chars in dev; production builds reject the public sentinel. |
| `PULSAR_AUTOMATION_SYNC_SECRET` | The backend signs `/api/automation/tenant-sync/*` calls with it. The orchestrator 401s without a match. |

If login redirects in a loop, mismatched JWT secret is the first thing to check.

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| Next.js orchestrator | http://localhost:3002/automation | Workflow editor, approvals inbox, clinic CRUD |
| Kestra | http://localhost:8080 | Workflow engine UI + API |
| Postgres | localhost:5432 | Shared DB — `kestra` schema + `flowcore` schema |
| pulsar-backend | http://localhost:18080 | Identity, tenant lifecycle (sibling repo) |
| pulsar-frontend | http://localhost:5173 | End-user SPA that mounts `/automation` (sibling repo) |

## First-time setup (no pulsar-backend running)

If you just want to poke the orchestrator without standing up the backend, you can dev-mode-bypass the JWT and create a clinic directly:

1. Open http://localhost:3002/automation/clinics/new
2. Fill in slug, name, OD API URL/key, Twilio creds, SMTP creds
3. Save — the orchestrator will create the Kestra namespace `dental.<slug>` and seed KV/secrets
4. Go to **Workflows → Create**, pick a template (recall, appointment, claims, treatment), and Deploy. The workflow generator emits a parent + worker subflow pair and `PUT`s them to Kestra.
5. Verify the flows appear at http://localhost:8080 in namespace `dental.<slug>`

There is no `setup.sh` and no `add-clinic.sh` — onboarding is fully UI-driven.

## Database

The orchestrator uses a `flowcore` schema in the same Postgres as Kestra. Schema migrations live in `app/db/migrations/` and are applied with `npm run migrate`.

To reset the orchestrator's data without affecting Kestra's queue tables:
```sql
DROP SCHEMA flowcore CASCADE;
```
Then re-run `npm run migrate`.

## Project Structure

```
/
├── app/                            # Next.js 16 orchestrator (entry point)
│   ├── src/app/                    # App Router pages + API routes
│   │   ├── api/
│   │   │   ├── workflows/          # CRUD + deploy/trigger
│   │   │   ├── clinics/            # tenant CRUD
│   │   │   ├── approvals/          # approval inbox + decisions
│   │   │   ├── automation/         # tenant-sync receiver from pulsar-backend
│   │   │   └── ...
│   │   ├── clinics/[id]/workflows/ # workflow editor UI
│   │   ├── approvals/              # approval inbox UI
│   │   └── portal/                 # tenant-scoped portal
│   ├── src/lib/
│   │   ├── workflow-generator.ts   # WorkflowDef → Kestra YAML (parent + worker)
│   │   ├── workflow-templates.ts   # Pre-built dental templates
│   │   ├── kestra.ts               # Kestra REST API client
│   │   ├── pulsar-auth.ts          # JWT verification (matches pulsar-backend)
│   │   ├── tenant-sync.ts          # tenant-sync receiver
│   │   └── db.ts                   # Postgres queries (orchestrator data)
│   └── db/migrations/              # flowcore schema
├── kestra/
│   ├── application.yml             # Kestra server config
│   └── namespace-configs/          # Optional static templates (the orchestrator
│                                   # generates these dynamically per workflow)
├── scripts/
│   └── sql/V1__dental_automation_log.sql   # Per-clinic dedup table for OD MySQL
├── docker-compose.yml              # Kestra + Postgres
└── docs/                           # Obsidian-style architecture + concept notes
```

There is **no** `kestra/flows/dental/` directory. Workflows are generated and `PUT` into Kestra at deploy time.

## Key Files

| File | What It Does |
|------|-------------|
| `app/src/lib/db.ts` | Postgres queries against `flowcore.*` |
| `app/src/lib/kestra.ts` | All Kestra API interactions |
| `app/src/lib/workflow-generator.ts` | `WorkflowDef` → Kestra YAML (parent + worker subflow pair) |
| `app/src/lib/workflow-templates.ts` | The 4 dental templates that pre-fill the editor |
| `app/src/lib/pulsar-auth.ts` | JWT verification against `PULSAR_JWT_SECRET` |
| `app/src/lib/tenant-sync.ts` | Receives tenant payloads from pulsar-backend |
| `kestra/application.yml` | Kestra server config (Postgres backend, no auth) |
| `docker-compose.yml` | Kestra + Postgres for local dev |

## Useful Commands

```bash
# Check all containers
docker ps

# Kestra logs
docker logs flowcore-kestra -f

# Test Kestra API
curl http://localhost:8080/api/v1/flows/search

# Full reset of Kestra + Postgres (destroys all flows and history)
docker compose down -v
```
