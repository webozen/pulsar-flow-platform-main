---
status: stable
---
# ADR-009: Open Dental API over Direct MySQL

## Status
Accepted

## Context
The original design had Kestra connecting directly to Open Dental's MySQL database via JDBC triggers. This required:
- Installing the Kestra MySQL JDBC plugin (not included in the base image)
- Direct MySQL credentials for each clinic (security risk)
- Network access from Kestra to each clinic's MySQL server
- Managing MySQL connection pooling and timeouts

Open Dental provides a REST API with a `PUT /queries/ShortQuery` endpoint that accepts SQL queries and returns JSON results. The API enforces read-only access and handles authentication via API keys.

## Decision
Use the Open Dental API (`PUT /queries/ShortQuery`) instead of direct MySQL JDBC connections. All data source queries go through HTTP requests using Kestra's built-in `io.kestra.plugin.core.http.Request` task.

## Consequences

### Positive
- **No plugins needed** — uses Kestra's built-in HTTP task, no MySQL JDBC plugin to install
- **More secure** — API keys instead of database credentials, read-only enforced by Open Dental
- **Simpler networking** — HTTP to an API endpoint vs. MySQL protocol to a database port
- **Response as JSON** — every field becomes a Kestra template variable (`{{ outputs.taskId.body[0].FName }}`)
- **Portable pattern** — any data source with a REST API works the same way (not tied to MySQL)

### Negative
- **100 row limit** — Open Dental API returns max 100 rows per call (pagination via `?Offset=N`)
- **HTTP overhead** — slightly higher latency than direct DB connection
- **Depends on Open Dental API availability** — if their API server is down, workflows fail

### Neutral
- SQL queries remain the same — the API accepts standard SQL via `SqlCommand` field
- The pattern generalizes: any business software with a query API can be a data source
