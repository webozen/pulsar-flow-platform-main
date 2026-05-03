---
status: stable
last-reviewed: 2026-05-02
---
# Adapting for a New Vertical

Flowcore is designed as a multi-tenant workflow automation platform. The first vertical is dental (Open Dental), but the architecture is industry-agnostic.

## What's Already Generic

| Component | Location | Generic? |
|-----------|----------|----------|
| Kestra orchestration engine | `docker-compose.yml` | Yes — no business logic |
| Kestra API client | `app/src/lib/kestra.ts` | Yes — generic REST wrapper |
| Workflow YAML generator | `app/src/lib/workflow-generator.ts` | Yes — emits a parent + worker pair from any `WorkflowDef` |
| Database schema | `app/db/migrations/` | Mostly — see "What to Change" |
| Auth (JWT verifier) | `app/src/lib/pulsar-auth.ts` | Yes — verifies any HS256 JWT issued by `pulsar-backend` |
| Tenant-sync receiver | `app/src/lib/tenant-sync.ts` | Yes — vertical-agnostic |
| Approval queue | `app/src/app/approvals/` | Yes — generic Kestra executions |
| Tenant portal | `app/src/app/portal/` | Yes — scoped to namespace |
| Workflow editor | `app/src/app/clinics/[id]/workflows/` | Yes — SQL + actions UI |

## What to Change for a New Vertical

### 1. Rename "clinic" to your domain term (~1 hour)

The word "clinic" appears in:
- Database table: `flowcore.clinics` → `flowcore.tenants` or `flowcore.businesses`
- API routes: `/api/clinics` → `/api/tenants`
- UI labels: "Add Clinic" → "Add Business"
- Kestra namespace prefix: `dental.` → `auto.` or `vet.` etc.

### 2. Rename data-source fields (~30 min)

The KV keys the workflow generator reads when emitting HTTP queries:

| Current (dental) | Generic |
|---------|---------|
| `source_api_url` (Open Dental ShortQuery base URL) | keep — already generic |
| `source_api_key` (Open Dental developer key) | keep — already generic |
| "Open Dental API" in UI | "Data Source API" |

The actual KV names in this repo are already generic (`source_api_url`, `source_api_key`). What's vertical-specific is the **UI labels** in the clinic form.

### 3. Replace the workflow templates (~2 hours)

`app/src/lib/workflow-templates.ts` ships with 4 dental templates. For a new vertical, replace these with vertical-appropriate ones (vaccinations due, services overdue, etc.). The orchestrator's editor reads from this file — pickers and pre-fills come for free.

### 4. Update UI placeholders (~30 min)

- SQL query placeholder in the workflow editor (currently shows dental table names like `recall`, `appointment`, `claim`)
- SMS / email message defaults (currently reference dental terms)

### 5. Decide on the dedup table

The dental `dental_automation_log` table ([[Correlation Key]]) is per-clinic and lives in the *data source's* database. For a new vertical:
- If the data source has a query API that allows `INSERT`, replicate this pattern with a vertical-named table
- If not, dedup can move into Postgres `flowcore.dedup` or be turned off entirely

### That's It

The workflow editor, execution engine, approval queue, tenant portal, multi-tenancy plumbing, JWT auth, and tenant-sync channel all work without any changes. The SQL queries that operators write in the editor are where the domain knowledge lives — not in the platform code.

## Example: Auto Repair Shop

**Tenant:** "Joe's Auto Repair"
**Data Source:** Shop management API (or direct SQL via API)
**SQL:** `SELECT c.name, c.phone, s.service_date, s.description FROM services s JOIN customers c ON c.id = s.customer_id WHERE s.service_date < DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`
**Action:** SMS → "Hi {{ inputs.record.name }}, it's been 6 months since your last service at Joe's Auto. Time for a checkup!"

Same platform, different SQL, different SMS text. Zero code changes — the operator just writes the workflow in the editor and clicks Deploy.

## Example: Veterinary Clinic

**Tenant:** "Happy Paws Vet"
**Data Source:** Vet practice management API
**SQL:** `SELECT p.pet_name, o.owner_name, o.phone, v.vaccine_name, v.due_date FROM vaccinations v JOIN pets p ON ... JOIN owners o ON ... WHERE v.due_date < CURDATE()`
**Action:** SMS → "Hi {{ inputs.record.owner_name }}, {{ inputs.record.pet_name }} is due for their {{ inputs.record.vaccine_name }} vaccine."

## See Also

- [[Platform Architecture]]
- [[Tenant Isolation]]
- [[Workflow]]
