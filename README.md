# Flowcore — Dental Practice Automation on Kestra

Workflow automation for dental practices, powered by [Kestra](https://kestra.io) OSS. Watches Open Dental's MySQL database for events and triggers automated workflows — recall reminders, appointment confirmations, insurance follow-ups, and treatment plan outreach.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose                                  │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  PostgreSQL   │◄───│  Kestra OSS           │  │
│  │  (metadata)   │    │  - 4 YAML workflows   │  │
│  └──────────────┘    │  - Namespace/clinic    │  │
│                       │  - Approval gates      │  │
│                       │  - Scheduled pauses    │  │
│                       └──────┬────────────────┘  │
└──────────────────────────────┼───────────────────┘
                               │ JDBC poll
                     ┌─────────▼─────────┐
                     │  Open Dental MySQL │  (external, per clinic)
                     │  patient, recall,  │
                     │  appointment, etc. │
                     └───────────────────┘
```

**Multi-tenancy:** Each clinic is a Kestra namespace (e.g., `dental.clinic-a`) with its own config, secrets, and isolated workflow executions.

## Workflows

| Flow | Trigger | What It Does |
|------|---------|-------------|
| **Recall Reminder** | JDBC poll every 5min | Overdue recalls → SMS → wait 3 days → email if no appointment |
| **Appointment Reminder** | Cron 7am daily | Unconfirmed appointments → SMS 48h → email 24h → final SMS 2h |
| **Claims Follow-Up** | JDBC poll daily | Stale claims >30 days → human approval gate → billing notification |
| **Treatment Follow-Up** | JDBC poll daily | Unscheduled treatments >14 days → SMS + email → wait 7 days → escalate |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Access to a clinic's Open Dental MySQL (read-only user)
- Twilio account (for SMS)
- SMTP credentials (for email)

### Setup

```bash
# 1. Start the platform
./scripts/setup.sh

# 2. Onboard a clinic
./scripts/add-clinic.sh clinic-a

# 3. Set secrets (Kestra API)
KESTRA=http://localhost:8080
NS=dental.clinic-a
curl -X PUT "$KESTRA/api/v1/namespaces/$NS/secrets/OPENDENTAL_DB_PASSWORD" \
  -H 'Content-Type: application/json' -d '"your-password"'
curl -X PUT "$KESTRA/api/v1/namespaces/$NS/secrets/TWILIO_AUTH_TOKEN" \
  -H 'Content-Type: application/json' -d '"your-token"'
curl -X PUT "$KESTRA/api/v1/namespaces/$NS/secrets/SMTP_PASSWORD" \
  -H 'Content-Type: application/json' -d '"your-password"'

# 4. Run the dedup table migration against the clinic's MySQL
mysql -h <host> -u <user> -p <db> < scripts/sql/V1__dental_automation_log.sql

# 5. Open Kestra UI
open http://localhost:8080
```

## Project Structure

```
├── docker-compose.yml              # Kestra + Postgres
├── .env.example                    # Environment template
├── kestra/
│   ├── application.yml             # Kestra server config
│   ├── flows/dental/               # YAML workflow definitions
│   │   ├── recall-reminder.yml
│   │   ├── appointment-reminder.yml
│   │   ├── claims-followup.yml
│   │   └── treatment-followup.yml
│   └── namespace-configs/          # Per-clinic configuration
│       ├── clinic-a.yml
│       └── clinic-b.yml
├── scripts/
│   ├── setup.sh                    # Bootstrap the platform
│   ├── add-clinic.sh               # Onboard a new clinic
│   └── sql/
│       └── V1__dental_automation_log.sql  # Dedup/audit table
├── tests/
│   └── seed-data.sql               # Test data for integration testing
└── docs/                           # Documentation (Obsidian vault)
```

## Documentation

Open `docs/` in [Obsidian](https://obsidian.md) or browse the markdown files directly. Start with `docs/00-start-here.md`.
