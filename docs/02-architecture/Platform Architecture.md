---
status: stable
last-reviewed: 2026-05-02
---
# Platform Architecture

## Overview

Flowcore is a three-layer system inside this repo (plus a fourth tier — pulsar-backend — that lives in a sibling repo and is covered in [[System Overview]]).

```
┌─────────────────────────────────────────────┐
│  LAYER 1: Next.js Orchestrator (app/, :3002) │
│                                              │
│  What it owns:                               │
│  - Tenants (flowcore.clinics)                │
│  - Workflow definitions (flowcore.workflows) │
│  - Approval audit trail                      │
│  - Approvals UI, dashboard, clinic portal    │
│  - JWT verification (issued by pulsar-backend)│
│  - Workflow YAML generation                  │
│                                              │
│  What it does NOT own:                       │
│  - Identity / tenant lifecycle (pulsar-backend) │
│  - Workflow execution (Kestra)               │
│  - Per-tenant business credentials —         │
│    those live in pulsar-backend's            │
│    pulsar_t_<slug>.tenant_credentials table  │
│  - Data-source queries (HTTP tasks at runtime)│
└──────────────┬──────────────────────────────┘
               │ Kestra REST API
               │  - PUT generated YAML flows
               │  - Set namespace KV / secrets
               │  - List/resume/kill executions
               │
┌──────────────▼──────────────────────────────┐
│  LAYER 2: Kestra OSS (orchestration engine)  │
│                                              │
│  What it owns:                               │
│  - Workflow execution on schedule            │
│  - Namespace-based tenant isolation          │
│  - Pause/resume (delays + approvals)         │
│  - Execution history + logs                  │
│                                              │
│  What it does NOT own:                       │
│  - Business logic (that's the orchestrator)  │
│  - Data source access (that's HTTP tasks)    │
└──────────────┬──────────────────────────────┘
               │ HTTP (PUT /queries/ShortQuery)
               │
┌──────────────▼──────────────────────────────┐
│  LAYER 3: Data Source API                    │
│                                              │
│  Examples:                                   │
│  - Open Dental API (dental)                  │
│  - Any REST API that accepts SQL/queries     │
│  - Custom business APIs                      │
│                                              │
│  Returns JSON rows → Kestra uses as          │
│  template variables in actions               │
└─────────────────────────────────────────────┘
```

## How They Connect

### Orchestrator → Kestra

The Next.js orchestrator communicates with Kestra exclusively via its REST API (`app/src/lib/kestra.ts`):

| Operation | Kestra Endpoint | When |
|-----------|----------------|------|
| Deploy workflow | `PUT /api/v1/flows/{ns}/{id}` (YAML, generated on the fly) | User clicks Deploy in the workflow editor |
| Set tenant config | `PUT /api/v1/namespaces/{ns}/kv/{key}` | Clinic created/updated, Secrets UI save |
| List executions | `GET /api/v1/executions/search` | Approvals inbox, dashboard, portal |
| Resume execution | `POST /api/v1/executions/{id}/resume` | Approval approved |
| Kill execution | `POST /api/v1/executions/{id}/kill` | Approval rejected |
| Toggle flow | `PUT /api/v1/flows/{ns}/{id}` | Workflow enabled/disabled |

Workflow YAML is **generated at deploy time** from `flowcore.workflows` rows — there are no hand-written `.yml` workflow files in this repo. Generation lives in `app/src/lib/workflow-generator.ts`. Each workflow compiles to a parent + worker subflow pair (one execution per row, see the comment header in `workflow-generator.ts` for why).

### Kestra → Data Source

Kestra flows use `io.kestra.plugin.core.http.Request` (built-in, no plugins needed):

```yaml
- id: query_data
  type: io.kestra.plugin.core.http.Request
  uri: "{{ kv('source_api_url') }}/queries/ShortQuery"
  method: PUT
  headers:
    Authorization: "ODFHIR {{ kv('source_api_key') }}"
    Content-Type: application/json
  body: |
    {"SqlCommand": "SELECT ..."}
```

Response JSON rows become available as `{{ outputs.query_data.body[0].FieldName }}` in subsequent tasks — and inside the per-row worker subflow as `{{ inputs.record.FieldName }}`.

### Orchestrator ↔ pulsar-backend

The Spring Boot service at `localhost:18080` and the orchestrator at `localhost:3002` share two static secrets:

| Secret | Used for |
|---|---|
| `PULSAR_JWT_SECRET` | Backend issues JWT cookies. Orchestrator verifies them in `app/src/lib/pulsar-auth.ts`. |
| `PULSAR_AUTOMATION_SYNC_SECRET` | Backend `tenant-sync` module POSTs tenant payloads to `/api/automation/tenant-sync/*`. Orchestrator verifies the shared HMAC-style secret before processing. |

Both must be byte-identical between the two systems or the platform won't work. See `app/src/lib/tenant-sync.ts` for the receiver side.

## Multi-Tenancy Model

See [[Tenant Isolation]] for details. Summary:

- Each tenant = one Kestra **namespace** (e.g., `dental.smile-dental`)
- Namespace has its own **KV variables** (clinic name, phone, contact emails, OD API URL)
- Namespace has its own **secrets** (Twilio token, SMTP password, OD DB password)
- Namespace has its own **flows** (deployed by the orchestrator)
- Namespace has its own **execution history** (isolated)
- The orchestrator manages tenants in Postgres `flowcore.*`, syncs config to Kestra
- **Per-tenant business credentials** (Gemini BYOK, etc.) are owned by `pulsar-backend` in MySQL `pulsar_t_<slug>.tenant_credentials` — the orchestrator only knows about runtime KV / secrets needed by Kestra

## Workflow Lifecycle

```
User edits workflow in /clinics/{slug}/workflows/{id}
  → Orchestrator saves to Postgres (flowcore.workflows)
  → Orchestrator generates Kestra YAML (app/src/lib/workflow-generator.ts)
    (parent flow + per-row worker subflow)
  → Orchestrator deploys YAML to Kestra namespace via REST API
  → Kestra runs the parent flow on schedule
  → Parent flow calls data source API, gets rows
  → ForEach over rows → spawns one worker execution per row
  → Worker execution runs the action sequence (SMS, email, pause, approval)
  → Results visible in /approvals (paused) or /portal/{slug}/executions (history)
```

## What's Generic vs Business-Specific

| Component | Generic (reusable) | Business-specific |
|-----------|-------------------|-------------------|
| Kestra engine | Yes | No |
| Orchestrator framework (auth, CRUD, dashboard) | Yes | No |
| Workflow YAML generator | Yes (SQL trigger + actions) | No |
| Kestra API client | Yes | No |
| Clinic form field labels | No | "Open Dental API URL" |
| Sample SQL in UI placeholders | No | Dental table names |
| Workflow templates | No | Dental-specific in `workflow-templates.ts` |

See [[Adapting for a New Vertical]] for how to reuse this for non-dental businesses.
