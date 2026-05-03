---
status: stable
last-reviewed: 2026-05-02
---
# Tenant Isolation

> Each dental clinic runs in its own Kestra namespace with separate configuration, secrets, and execution history. The orchestrator UI is the single entry point for tenant lifecycle in this repo.

## Why it exists
A multi-location dental group needs clinic-level isolation. Clinic A's workflows, credentials, and patient data must be invisible to Clinic B.

## Shape
- Each clinic = one Kestra **namespace** (e.g., `dental.clinic-a`, `dental.clinic-b`)
- Per-namespace **KV variables**: clinic name, phone, contact emails, Open Dental API URL
- Per-namespace **secrets**: `TWILIO_AUTH_TOKEN`, `SMTP_PASSWORD`, `OPENDENTAL_DB_PASSWORD`, etc.
- Per-namespace **flows** and **executions** — every read/write goes through `namespace=dental.<slug>`

## How tenants get created
There is **no shell script** for onboarding (`setup.sh` and `add-clinic.sh` are dead references in old docs and do not exist in this repo). The flow is one of:

1. **Through pulsar-backend** (production path). An admin POSTs to `pulsar-backend` `/api/admin/tenants`. Backend creates the per-tenant MySQL DB and emits a `TenantCreated` event. Its `automation-sync` module POSTs the tenant payload to the orchestrator at `/api/automation/tenant-sync/*` (signed with `PULSAR_AUTOMATION_SYNC_SECRET`). The orchestrator inserts a row in `flowcore.clinics` and provisions the Kestra namespace.

2. **Directly via the orchestrator UI** (local-dev / convenience). Navigate to `/clinics/new` (proxied as `/automation/clinics/new`) and fill the form. Same end state as path 1 minus the backend's tenant DB.

In both cases the orchestrator:
- Inserts `flowcore.clinics`
- Calls `PUT /api/v1/namespaces/{ns}` (Kestra) to create the namespace
- Calls `PUT /api/v1/namespaces/{ns}/kv/{key}` for each KV value
- Workflows are deployed **on demand** when the operator clicks Deploy on a workflow — they are not staged ahead of time

## Where per-tenant credentials live

| Credential class | Owner | Storage |
|---|---|---|
| Runtime credentials Kestra needs at task execution time (Twilio token, SMTP password, OD DB password) | Orchestrator | Kestra namespace **secrets** (set via the Secrets UI) |
| Public-ish runtime config (clinic name, phone, OD API URL) | Orchestrator | Kestra namespace **KV** |
| Per-tenant business credentials for non-automation features (Gemini BYOK, OpenDental, Twilio, Plaud) | **pulsar-backend** | MySQL `pulsar_t_<slug>.tenant_credentials` |

The orchestrator never reads `tenant_credentials` from MySQL — that's pulsar-backend's table. The two systems converge only via the tenant-sync channel.

## Common mistakes
- Forgetting to set Kestra namespace secrets after onboarding — flows will fail on first trigger with "secret not found"
- Re-using one Open Dental endpoint URL for multiple clinics — each clinic has its own server and its own ShortQuery URL
- Not running the per-clinic `dental_automation_log` migration (`scripts/sql/V1__dental_automation_log.sql`) against the clinic's MySQL — dedup checks will fail

## See also
- [[Workflow]]
- [[Adding a New Tenant]]
- [[Platform Architecture]]
