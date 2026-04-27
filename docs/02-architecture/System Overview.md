---
status: stable
last-reviewed: 2026-04-25
---
# System Overview

Pulsar is a multi-tenant SaaS for dental-practice (and, by design, any vertical that has a "rows + actions" automation shape) operations. Three repos make up the running system.

> [!note] Why three repos
> The split is deliberate: **identity + per-tenant data** is owned by a Java/Spring service that other Pulsar modules can plug into; the **automation experience** runs on its own Next.js + Kestra stack so workflow tooling can move at a different speed; the **end-user UI** is a Vite/React SPA that consumes the backend API and embeds the automation app via a portal route. Each repo has its own deploy unit, its own tests, and its own on-call surface.

## Repos at a Glance

| Repo | Role | Stack | Owns |
|------|------|-------|------|
| `pulsar-backend` | Identity, tenants, modules, sync | Java 21 · Spring Boot 3.3.4 · Gradle 8.10 · MySQL 8 · Flyway | Admin, JWT issuance, per-tenant MySQL DBs, module migrations, tenant-sync to flow-platform |
| `pulsar-flow-platform-main` | Automation: build, run, approve | Next.js 16 · React 19 · Postgres 15 · Kestra 0.19.11 · Playwright + Vitest | Workflow YAML generator, Kestra deploy, approvals queue, Twilio webhooks |
| `pulsar-frontend` | End-user SPA | React 18 · Vite 5 · Tailwind · pnpm workspaces · turbo | Login, dashboard, embedded `/automation` portal |

## 1 · System Overview

```
                     ┌──────────────────────────────────────┐
                     │           Browser (user)             │
                     └──────────────────────────────────────┘
                                       │
                                       │ https
                                       ▼
                ┌──────────────────────────────────────────────┐
                │  pulsar-frontend (Vite/React, :5173)         │
                │  - Login + dashboard                         │
                │  - Iframe / route-mounts /automation/*       │
                └──────────────────────────────────────────────┘
                          │                          │
              JWT-bearing │                          │ JWT-bearing
              REST calls  ▼                          ▼ REST calls
  ┌──────────────────────────────┐    ┌──────────────────────────────────┐
  │ pulsar-backend (:18080)      │    │ pulsar-flow-platform (:3002)     │
  │  Spring Boot · Java 21       │    │  Next.js 16 (app router)         │
  │                              │    │                                  │
  │  /api/admin/*                │◀──▶│  /automation/api/*               │
  │  /api/auth/*                 │tsync│  /automation/approvals          │
  │  /api/{module}/*  per-tenant │    │  /automation/builder             │
  │                              │    │                                  │
  │  ┌────────────────────────┐  │    │  ┌──────────────────────────┐    │
  │  │ MySQL 8 (:3316)        │  │    │  │ Postgres 15 (:5433)      │    │
  │  │  flowcore (control)    │  │    │  │  flowcore (audit, kv)    │    │
  │  │  pulsar_t_<slug>×N     │  │    │  └──────────────────────────┘    │
  │  └────────────────────────┘  │    │                                  │
  └──────────────────────────────┘    │           ▲      │               │
                                      │  REST API │      │ webhook       │
                                      │           │      ▼               │
                                      │  ┌─────────────────────────┐     │
                                      │  │ Kestra 0.19.11 (:8080)  │     │
                                      │  │  Postgres-backed queue  │     │
                                      │  └─────────────────────────┘     │
                                      └──────────────┬───────────────────┘
                                                     │ HTTP (per-tenant KV)
                                                     ▼
                                  ┌─────────────────────────────────────┐
                                  │  External services                  │
                                  │  - Open Dental ShortQuery API       │
                                  │  - Twilio (SMS / Voice)             │
                                  │  - RingCentral (voice + SMS)        │
                                  └─────────────────────────────────────┘
```

**Key boundaries**

- **Identity is one-way.** `pulsar-backend` mints JWTs (admin and tenant). The flow-platform never issues tokens — it only verifies them.
- **Tenant lifecycle is one-way.** `pulsar-backend` creates the tenant in MySQL, then `automation-sync` POSTs to the flow-platform's `/automation/api/tenants/sync` to provision the Kestra namespace + flows. The flow-platform never tells the backend a tenant exists.
- **Kestra is internal to the flow-platform.** Only Next.js routes touch Kestra. The frontend and backend never know Kestra exists.

## 2 · End-to-End Flow: Appointment Reminder Approval

The canonical journey — from a cron firing to a patient's phone ringing.

```
[T+0s]   Kestra cron fires `apt-reminder-demo` in namespace dental.acme-dental
              │
              ▼
[T+1s]   Parent flow runs HTTP query → Open Dental ShortQuery API
              GET 7-day appointment list
              │
              ▼
[T+2s]   ForEach over rows → spawn N child executions of `apt-reminder-row`
              (each child gets `inputs.row` = JSON-stringified appointment)
              parent finishes immediately (wait: false)
              │
              ▼
[T+3s]   Each child execution hits `approval_gate` (Pause task) and PAUSES
              N independent paused executions, one per appointment
              │
              ▼
[T+10s]  User opens /automation/approvals
              │
        ┌─────┴────────────────────────┐
        │ GET /automation/api/approvals│
        │  → Kestra:                   │
        │    GET /executions?          │
        │      namespace=dental.acme-..│
        │      &flowId=apt-reminder-row│
        │      &state=PAUSED           │
        │  → returns N cards           │
        └─────┬────────────────────────┘
              │
              ▼
[T+15s]  User clicks Approve on card #2
              │
              ▼
        ┌─────┴────────────────────────────────────────┐
        │ POST /automation/api/approvals/{exec2}/resume│
        │   1. JWT verified (claims slug + role)       │
        │   2. Rate-limit check (token bucket)         │
        │   3. POST Kestra /executions/{exec2}/resume  │
        │      (NO taskRunId — Kestra OSS bug)         │
        │   4. INSERT flowcore.approval_audit          │
        └─────┬────────────────────────────────────────┘
              │
              ▼
[T+16s]  Kestra resumes ONLY exec2 → runs `send_sms` task
              │
              ▼
[T+17s]  send_sms = HTTP POST Twilio Messages API
              From: kv('twilio_from_number') = +17406606649
              To:   +15198002773 (trial-account hardcoded)
              Body: rendered from inputs.row.FName etc.
              │
              ▼
[T+19s]  Twilio delivers SMS · child execution → SUCCESS
              │
              ▼
[T+20s]  /approvals page polls /outcome → chip flips to Sent
              user sees green toast top-right
```

> [!important] Subflow-per-row (vs. one-execution-many-Pauses)
> Kestra OSS 0.19.11 ignores `taskRunId` on `POST /executions/{id}/resume` — it resumes whichever paused gate is next in the FIFO queue. Approving "Sawyer" would send Ivanna's SMS. The fix is **architectural**: each row is its own execution with exactly one paused gate, so resuming the *execution* is unambiguous. See `apt-reminder-demo.yml` (parent fan-out) and `apt-reminder-row.yml` (child).

## 3 · Multi-Tenancy

Three identifiers, deterministically derived from one.

```
   slug = "acme-dental"            ← canonical (URL-safe, human-readable)
       │
       ├──▶ MySQL DB  = "pulsar_t_acme_dental"
       │          (slug.replace('-','_'), prefixed)
       │          owned by pulsar-backend
       │
       └──▶ Kestra ns = "dental.acme-dental"
                  ("<vertical>.<slug>")
                  owned by pulsar-flow-platform
```

**Per-tenant boundaries**

| Layer | Isolation primitive | Where |
|-------|---------------------|-------|
| Backend admin DB | Row in `flowcore.tenants` keyed by slug | `pulsar-backend/host-app` |
| Backend tenant DB | Whole MySQL database `pulsar_t_<slug>` with own Hikari pool | `kernel/TenantDataSources` |
| Backend module schema | Per-module `flyway_schema_history_<id>` table | `kernel/MigrationRunner` |
| Flow audit/KV | Postgres rows in `flowcore.*` filtered by slug | `app/src/lib/db.ts` |
| Workflow YAML | Kestra namespace `dental.<slug>` | `tenant-sync.ts` |
| Workflow secrets | Kestra namespace KV (`twilio_from_number`, `opendental_developer_key`, …) | Set at tenant-sync time |
| Execution history | Kestra filters by namespace at every read | All `/api/approvals/*` routes |

**Cross-tenant guards**

1. JWT claims carry `slug`. Every flow-platform route compares the slug in the URL or request body against the JWT.
2. The list approvals route filters on `namespace=namespaceFor(slug)` server-side — a forged exec ID still 404s if its namespace doesn't match the JWT's slug.
3. Kestra KV reads are namespace-scoped — there is no global KV.
4. Backend per-tenant Hikari pools are keyed by `dbName`, not slug — slugs cannot leak across DBs even if the tenant lookup is bypassed.

**Onboarding a new tenant** (high level — see `docs/03-guides/Adding a New Tenant.md` for the click-through):

1. Admin POSTs to `pulsar-backend` `/api/admin/tenants` with slug, name, modules
2. `TenantProvisioningService` creates `pulsar_t_<slug>` MySQL DB, runs Flyway for each active module
3. `automation-sync` module observes the `TenantCreated` event, POSTs the tenant payload to flow-platform `/automation/api/tenants/sync`
4. Flow-platform creates Kestra namespace `dental.<slug>`, deploys all `kestra/flows/dental/*.yml` (with namespace rewritten), seeds KV defaults

## Tech Stack Summary

**pulsar-backend**
- Java 21 · Spring Boot 3.3.4 · Gradle 8.10
- MySQL 8 (control + per-tenant), Flyway per-module migrations
- HikariCP, JDBC, Spring Security with custom JWT filter
- Multi-stage Docker build (eclipse-temurin:21-jdk → 21-jre runtime), non-root user

**pulsar-flow-platform-main/app**
- Next.js 16 (app router) · React 19 · TypeScript strict
- Postgres 15 (audit log, KV cache), Kestra 0.19.11 (Postgres-backed)
- Vitest 1.6 with global fetch guard · Playwright 1.48 for e2e
- shadcn/ui (Sonner, AlertDialog, Skeleton)
- Token-bucket rate limiter (in-memory, per-(slug,execId))

**pulsar-frontend**
- React 18 · Vite 5 · Tailwind
- pnpm workspaces · turbo build orchestration
- Vitest unit tests

## Where to go next

- [[Platform Architecture]] — flow-platform-internal layering (this doc supersedes it for cross-repo questions)
- [[Tenant Isolation]] — namespace + KV mechanics inside Kestra
- [[Execution Flow]] — single-execution lifecycle inside Kestra
- [[Adding a New Tenant]] — operator guide
- [[Local Development]] — running the full stack
