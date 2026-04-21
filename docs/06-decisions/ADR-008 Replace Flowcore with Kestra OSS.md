# ADR-008: Replace Flowcore Engine with Kestra OSS

## Status

Accepted

## Context

Flowcore v0.1 was a custom Java/Spring Boot workflow engine (~3,800 LOC) built to automate dental practice workflows triggered by Open Dental's MySQL database. It provided:

- SQL polling triggers
- Linear action sequences (email, SMS, webhook, delay)
- Human approval gates
- Multi-tenancy at the scheduler level
- Template-based dedup via correlation keys

While functional, the engine was missing critical features needed for production dental workflows:

- No conditional branching (If/Switch)
- No retry/backoff on failures
- No cron triggers
- No UI for monitoring or managing workflows
- No webhook/API triggers
- Linear-only execution (no parallel, no loops)

Building these features would take months. Meanwhile, Kestra OSS (Apache 2.0) provides all of them out of the box, plus 1,200+ integration plugins, a visual UI, execution replay, and an active open-source community.

## Decision

Replace the custom Flowcore engine with Kestra OSS. Redefine all workflows as Kestra YAML flow files. Use Kestra namespaces for per-clinic multi-tenancy.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Keep building Flowcore** | Years of work to reach feature parity with Kestra. Time better spent on dental domain intelligence. |
| **Temporal** | Requires a separate server cluster. Not embeddable. Massive operational overhead for small dental practices. |
| **Camunda / Flowable** | Requires BPMN XML. Overkill and wrong abstraction for our use case. |
| **n8n** | Source-available (not truly open source). Weaker multi-tenancy. JSON-based (harder to version control). |

## Consequences

### Positive

- Gain branching, retries, cron, ForEach, parallel execution immediately
- Built-in UI for monitoring, debugging, and manual approval
- 1,200+ plugins for future integrations (AI, cloud storage, messaging)
- Smaller codebase: ~4 YAML flows + 2 scripts vs 3,800 LOC of Java
- Faster iteration on new workflows (YAML vs Java code)

### Negative

- Multi-tenancy in OSS is namespace-based (soft isolation), not enterprise-grade tenant isolation
- DB-level dedup requires a custom `dental_automation_log` table and first-task check pattern
- No ReValidator SPI equivalent — re-validation is implemented as a re-query task after each Pause
- External dependency on Kestra project's maintenance and release cycle
- Docker Compose required (vs embedded library in v0.1)

### Neutral

- Approval gates work differently: Kestra's Pause task replaces Flowcore's ApprovalTask entity
- Template resolution changes from `{{var}}` to Pebble `{{ var }}` syntax
