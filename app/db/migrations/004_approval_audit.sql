-- 004_approval_audit.sql
--
-- Compliance-grade audit trail for human approval decisions on the
-- approval queue. Every Approve and every Skip click writes one row
-- here, with the actor (from the JWT), the execution, and a snapshot
-- of the patient/payload context. Rows are append-only — Kestra moves
-- on, retention rotates, but this table answers "who approved the
-- SMS to patient X on date Y" indefinitely.
--
-- Storage lives in the same `flowcore` schema as the comms log so a
-- future audit page can JOIN sms_messages → approval_audit on the
-- execution_id and produce a full "approved → sent" lineage row.

CREATE TABLE IF NOT EXISTS flowcore.approval_audit (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug          TEXT NOT NULL,                                              -- which tenant
  actor_email   TEXT,                                                       -- from JWT
  actor_role    TEXT,                                                       -- from JWT
  action        TEXT NOT NULL CHECK (action IN ('approve','skip')),
  execution_id  TEXT NOT NULL,                                              -- Kestra exec
  flow_id       TEXT,
  payload       JSONB                                                       -- recordPreview etc.
);

CREATE INDEX IF NOT EXISTS approval_audit_slug_ts_idx ON flowcore.approval_audit (slug, ts DESC);
CREATE INDEX IF NOT EXISTS approval_audit_exec_idx ON flowcore.approval_audit (execution_id);
