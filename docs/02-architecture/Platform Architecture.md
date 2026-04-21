---
status: stable
---
# Platform Architecture

## Overview

Flowcore is a three-layer system:

```
┌─────────────────────────────────────────────┐
│  LAYER 1: App (Next.js)                      │
│                                              │
│  What it owns:                               │
│  - Tenants (clinics/businesses)              │
│  - Users + auth (email/password + OAuth)     │
│  - Workflow definitions (SQL + actions)       │
│  - Dashboard, approvals, clinic portal       │
│                                              │
│  What it does NOT own:                       │
│  - Workflow execution (that's Kestra)        │
│  - Data source queries (that's the API)      │
└──────────────┬──────────────────────────────┘
               │ Kestra REST API
               │  - Deploy YAML flows
               │  - Set namespace KV variables
               │  - List/resume/kill executions
               │
┌──────────────▼──────────────────────────────┐
│  LAYER 2: Kestra (orchestration engine)      │
│                                              │
│  What it owns:                               │
│  - Workflow execution on schedule            │
│  - Namespace-based tenant isolation          │
│  - Pause/resume (delays + approvals)         │
│  - Execution history + logs                  │
│                                              │
│  What it does NOT own:                       │
│  - Business logic (that's the app)           │
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

### App → Kestra

The app communicates with Kestra exclusively via its REST API (`lib/kestra.ts`):

| Operation | Kestra Endpoint | When |
|-----------|----------------|------|
| Deploy workflow | `POST /api/v1/flows` (YAML) | User creates/edits a workflow |
| Set tenant config | `PUT /api/v1/namespaces/{ns}/kv/{key}` | Clinic created/updated |
| List executions | `GET /api/v1/executions/search` | Dashboard, portal |
| Resume execution | `POST /api/v1/executions/{id}/resume` | Approval approved |
| Kill execution | `POST /api/v1/executions/{id}/kill` | Approval rejected |
| Toggle flow | `PUT /api/v1/flows/{ns}/{id}` | Workflow enabled/disabled |

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

Response JSON rows become available as `{{ outputs.query_data.body[0].FieldName }}` in subsequent tasks.

## Multi-Tenancy Model

See [[Tenant Isolation]] for details. Summary:

- Each tenant = one Kestra **namespace** (e.g., `dental.smile-dental`)
- Namespace has its own **KV variables** (API URL, credentials, config)
- Namespace has its own **flows** (deployed by the app)
- Namespace has its own **execution history** (isolated)
- The app manages tenants in Postgres, syncs config to Kestra

## Workflow Lifecycle

```
User creates workflow in app UI
  → App saves to Postgres (flowcore.workflows table)
  → App generates Kestra YAML (lib/workflow-generator.ts)
  → App deploys YAML to Kestra via REST API
  → Kestra runs the flow on schedule
  → Flow calls data source API, gets rows
  → For each row: sends SMS, email, pauses, etc.
  → Execution results visible in app portal
```

## What's Generic vs Business-Specific

| Component | Generic (reusable) | Business-specific |
|-----------|-------------------|-------------------|
| Kestra engine | Yes | No |
| App framework (auth, CRUD, dashboard) | Yes | No |
| Workflow YAML generator | Yes (SQL + actions) | No |
| Kestra API client | Yes | No |
| Clinic form field labels | No | "Open Dental API URL" |
| Sample SQL in UI placeholders | No | Dental table names |
| Mock data API | No | Fake patient data |

See [[Adapting for a New Vertical]] for how to reuse this for non-dental businesses.
