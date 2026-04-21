---
status: stable
---
# Local Development

## Prerequisites
- Docker Desktop
- Node.js 20+
- npm

## Start the Stack

```bash
# 1. Start Postgres + Kestra
cp .env.example .env
docker compose up -d postgres kestra

# 2. (Optional) Start mock Open Dental API for testing
cd mock-opendental && npm install && node server.js &
# Runs on :4000, accepts PUT /queries/ShortQuery

# 3. Start the Next.js app
cd app
cp .env.local.example .env.local
npm install
npm run dev
# Runs on :3000
```

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| Next.js app | http://localhost:3000 | Admin UI + Clinic Portal |
| Kestra | http://localhost:8080 | Workflow engine UI + API |
| Postgres | localhost:5432 | Shared database |
| Mock Open Dental | http://localhost:4000 | Fake patient data for testing |

## First-Time Setup

1. Open http://localhost:3000/login
2. Click "Need an account? Sign up"
3. Register with any email/password (first user becomes ADMIN)
4. Go to Clinics → Add Clinic
5. Use `http://localhost:4000` as the Open Dental API URL and any string as API key
6. Create a workflow, verify it appears in Kestra UI at :8080

## Database

The app uses a `flowcore` schema in the same Postgres as Kestra. Tables are auto-created on first request (`initDb()` in `lib/db.ts`).

To reset the app's data without affecting Kestra:
```sql
DROP SCHEMA flowcore CASCADE;
```
Tables will be recreated on next app request.

## Project Structure

```
/
├── app/                    # Next.js application
│   ├── src/app/            # Pages and API routes
│   ├── src/lib/            # Core libraries
│   │   ├── db.ts           # Postgres queries (app data)
│   │   ├── kestra.ts       # Kestra REST API client
│   │   ├── auth.ts         # NextAuth configuration
│   │   └── workflow-generator.ts  # YAML generator
│   └── src/components/     # React components
├── kestra/                 # Kestra config
│   └── application.yml     # Server configuration
├── mock-opendental/        # Mock data source for testing
├── docker-compose.yml      # Full stack
└── docs/                   # This documentation (Obsidian vault)
```

## Key Files

| File | What It Does |
|------|-------------|
| `app/src/lib/db.ts` | Database schema + queries. Tables auto-created. |
| `app/src/lib/kestra.ts` | All Kestra API interactions. |
| `app/src/lib/workflow-generator.ts` | Converts workflow definition → Kestra YAML. |
| `app/src/lib/auth.ts` | NextAuth with email/password + OAuth. |
| `kestra/application.yml` | Kestra server config (Postgres backend, no auth). |
| `docker-compose.yml` | Postgres + Kestra + app + mock API services. |

## Useful Commands

```bash
# Check all services
docker ps

# Kestra logs
docker logs flowcore-kestra -f

# Test Kestra API
curl http://localhost:8080/api/v1/flows/search

# Test mock Open Dental
curl -X PUT http://localhost:4000/queries/ShortQuery \
  -H "Authorization: ODFHIR test" \
  -H "Content-Type: application/json" \
  -d '{"SqlCommand": "SELECT * FROM patient"}'

# Reset everything
docker compose down -v
```
