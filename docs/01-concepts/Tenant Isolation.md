---
status: stable
---
# Tenant Isolation

> Each dental clinic runs in its own Kestra namespace with separate configuration, secrets, and execution history.

## Why it exists
A multi-location dental group needs clinic-level isolation. Clinic A's workflows, credentials, and patient data must be invisible to Clinic B.

## Shape
- Each clinic = one Kestra **namespace** (e.g., `dental.clinic-a`, `dental.clinic-b`)
- Per-namespace **KV variables**: clinic name, phone, Twilio credentials, SMTP config, Open Dental JDBC URL
- Per-namespace **secrets**: database passwords, API tokens
- Per-namespace **executions**: each clinic's workflow runs are scoped to its namespace

## How it works
1. `scripts/add-clinic.sh clinic-a` reads `kestra/namespace-configs/clinic-a.yml`
2. Sets KV variables in the `dental.clinic-a` namespace via Kestra API
3. Deploys all 4 workflow YAML files into that namespace (with namespace overridden)
4. Secrets are set separately via Kestra's secrets API

## Flow templates
The base flows live in `kestra/flows/dental/` under the `dental` namespace. When onboarding a clinic, the `add-clinic.sh` script copies each flow into the clinic's namespace, replacing `namespace: dental` with `namespace: dental.clinic-a`.

## Common mistakes
- Forgetting to set secrets after running `add-clinic.sh` — flows will fail on first trigger
- Using the same Open Dental JDBC URL for multiple clinics — each clinic has its own MySQL instance
- Not running the `dental_automation_log` migration against the clinic's MySQL

## See also
- [[Workflow]]
- `scripts/add-clinic.sh`
- `kestra/namespace-configs/`
