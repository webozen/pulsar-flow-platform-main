---
status: stable
last-reviewed: 2026-05-02
---
# Adding a New Tenant

A tenant is a business (e.g., a dental clinic) with its own isolated data, workflows, and configuration. Onboarding is **fully UI-driven** — there is no `setup.sh` or `add-clinic.sh` script in this repo (those references in older docs are dead).

There are two paths, depending on whether `pulsar-backend` is in the loop.

## Path 1 — Production (via pulsar-backend)

This is how real tenants are created in deployed environments.

1. Admin POSTs to `pulsar-backend` at `/api/admin/tenants` with slug, name, and active modules
2. Backend's `TenantProvisioningService` creates the per-tenant MySQL DB `pulsar_t_<slug>` and runs Flyway migrations for each active module
3. Backend's `automation-sync` module emits a `TenantCreated` event and POSTs the tenant payload to the orchestrator at `/api/automation/tenant-sync/*`
   - The request is signed with `PULSAR_AUTOMATION_SYNC_SECRET` (must match between the two systems)
4. Orchestrator's `tenant-sync` receiver:
   - Inserts a row in `flowcore.clinics`
   - Calls Kestra `PUT /api/v1/namespaces/dental.<slug>` to create the namespace
   - Seeds default KV values

After this, no workflows are deployed yet. Workflows are deployed on demand from the workflow editor (see [[Creating a Workflow]]).

## Path 2 — Direct via the orchestrator UI (local-dev / convenience)

For local development or when you want to skip the backend round-trip:

1. Log in at `/automation/login` (or click through from `pulsar-frontend`)
2. Go to **Clinics** → **Add Clinic**
3. Fill in:
   - **Name** and **Slug** (the slug becomes the Kestra namespace: `dental.{slug}`)
   - **Data Source API URL** and **API Key** (e.g., Open Dental ShortQuery endpoint)
   - **Twilio** credentials for SMS
   - **SMTP** credentials for email
   - **Routing** emails (billing team, front desk)
4. Click **Create Clinic**

The orchestrator will:
- Insert the clinic row in `flowcore.clinics`
- Create the Kestra namespace `dental.<slug>`
- Push public-ish config as KV values (clinic name, phone, contact emails, source API URL/key)
- Push secrets (Twilio token, SMTP password, OD DB password) as Kestra namespace secrets

## After Creating

1. Open the clinic detail page → verify Kestra config under the Secrets tab
2. Go to **Workflows** → **Create Workflow** → pick a template → Deploy. Generated YAML is `PUT` to `dental.<slug>`.
3. Share the portal URL (`/automation/portal/{slug}`) with clinic staff

## Where credentials actually live

| Credential | Lives in |
|---|---|
| Twilio auth token, SMTP password, OD DB password (used by Kestra at task execution time) | Kestra namespace **secrets** (this repo) |
| Clinic name, phone, contact emails, OD ShortQuery URL | Kestra namespace **KV** (this repo) |
| Per-tenant business credentials for Pulsar features outside automation (Gemini BYOK, OpenDental, Twilio, Plaud) | **pulsar-backend's** MySQL `pulsar_t_<slug>.tenant_credentials` (sibling repo) |

The orchestrator never reads `tenant_credentials` from MySQL. The two systems converge only via the tenant-sync channel and the shared JWT secret.

## What Gets Isolated Per Tenant

- Kestra namespace (separate flows, executions, KV, secrets)
- Workflow definitions in Postgres `flowcore.workflows` (filtered by `clinicId`)
- Execution history (Kestra filters by namespace at every read)
- Approvals inbox (filterable by clinic)
- Portal view

## See Also

- [[Tenant Isolation]]
- [[Creating a Workflow]]
- [[Local Development]]
