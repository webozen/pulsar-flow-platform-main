---
status: stable
---
# Adapting for a New Vertical

Flowcore is designed as a multi-tenant workflow automation platform. The first vertical is dental (Open Dental), but the architecture is industry-agnostic.

## What's Already Generic

| Component | Location | Generic? |
|-----------|----------|----------|
| Kestra orchestration engine | `docker-compose.yml` | Yes — no business logic |
| Kestra API client | `app/src/lib/kestra.ts` | Yes — generic REST wrapper |
| Workflow YAML generator | `app/src/lib/workflow-generator.ts` | Yes — SQL trigger + actions |
| Database schema | `app/src/lib/db.ts` | Mostly — see "What to Change" |
| Auth system | `app/src/lib/auth.ts` | Yes |
| Dashboard | `app/src/app/dashboard/` | Yes — reads from Kestra API |
| Approval queue | `app/src/app/approvals/` | Yes — generic Kestra executions |
| Clinic portal | `app/src/app/portal/` | Yes — scoped to namespace |
| Workflow builder | `app/src/app/clinics/[id]/workflows/new/` | Yes — SQL + actions UI |

## What to Change for a New Vertical

### 1. Rename "clinic" to your domain term (~1 hour)

The word "clinic" appears in:
- Database table: `flowcore.clinics` → `flowcore.tenants` or `flowcore.businesses`
- API routes: `/api/clinics` → `/api/tenants`
- UI labels: "Add Clinic" → "Add Business"
- Kestra namespace prefix: `dental.` → `auto.` or `vet.` etc.

### 2. Rename data source fields (~30 min)

| Current | Generic |
|---------|---------|
| `opendental_api_url` | `source_api_url` |
| `opendental_api_key` | `source_api_key` |
| "Open Dental API" in UI | "Data Source API" |

### 3. Update UI placeholders (~30 min)

- SQL query placeholder in the workflow builder (currently shows dental table names)
- SMS/email message templates (currently reference dental terms)

### 4. Replace mock API (~1 hour)

The `mock-opendental/` directory has fake dental data. Replace with fake data for your vertical, or point at the real API.

### That's It

The workflow builder, execution engine, approval queue, dashboard, portal, multi-tenancy, and auth all work without any changes. The SQL queries that users write in the workflow builder are where the domain knowledge lives — not in the platform code.

## Example: Auto Repair Shop

**Tenant:** "Joe's Auto Repair"
**Data Source:** Shop management API (or direct SQL via API)
**SQL:** `SELECT c.name, c.phone, s.service_date, s.description FROM services s JOIN customers c ON c.id = s.customer_id WHERE s.service_date < DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`
**Action:** SMS → "Hi {{ taskrun.value.name }}, it's been 6 months since your last service at Joe's Auto. Time for a checkup!"

Same platform, different SQL, different SMS text. Zero code changes.

## Example: Veterinary Clinic

**Tenant:** "Happy Paws Vet"
**Data Source:** Vet practice management API
**SQL:** `SELECT p.pet_name, o.owner_name, o.phone, v.vaccine_name, v.due_date FROM vaccinations v JOIN pets p ON ... JOIN owners o ON ... WHERE v.due_date < CURDATE()`
**Action:** SMS → "Hi {{ taskrun.value.owner_name }}, {{ taskrun.value.pet_name }} is due for their {{ taskrun.value.vaccine_name }} vaccine."

## See Also

- [[Platform Architecture]]
- [[Tenant Isolation]]
