---
status: stable
---
# Adding a New Tenant

A tenant is a business (e.g., a dental clinic) with its own isolated data, workflows, and configuration.

## Via the App UI

1. Log in as ADMIN at `/login`
2. Go to **Clinics** → **Add Clinic**
3. Fill in:
   - **Name** and **Slug** (slug becomes the Kestra namespace: `dental.{slug}`)
   - **Data Source API URL** and **API Key** (e.g., Open Dental API endpoint)
   - **Twilio** credentials for SMS
   - **SMTP** credentials for email
   - **Routing** emails (billing team, front desk)
4. Click **Create Clinic**

The app will:
- Save the clinic to Postgres
- Create a Kestra namespace `dental.{slug}`
- Push all config as KV variables to that namespace

## Via API

```bash
curl -X POST http://localhost:3000/api/clinics \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Dental",
    "slug": "downtown-dental",
    "opendentalApiUrl": "https://their-server/api/v1",
    "opendentalApiKey": "their-api-key",
    "twilioSid": "ACxxx",
    "twilioFromNumber": "+1555..."
  }'
```

## After Creating

1. Go to the clinic detail page → click **Sync to Kestra** to push config
2. Go to **Workflows** → **Create Workflow** to add automations
3. Share the portal URL (`/portal/{slug}`) with clinic staff

## What Gets Isolated Per Tenant

- Kestra namespace (separate flows, executions, KV store)
- Workflow definitions in Postgres
- Execution history
- Approval queue (filterable by clinic)
- Portal view

## See Also

- [[Tenant Isolation]]
- [[Creating a Workflow]]
