-- Pulsar ⇄ flow-platform sync state on existing flowcore.clinics rows.
--
-- Why each column:
--   pulsar_synced_at  — last time Pulsar pushed lifecycle for this slug; the
--                       reconcile job uses it to detect drift.
--   pulsar_modules    — whichever Pulsar modules are active for the tenant; we
--                       store it locally so the toggle-flow logic can be
--                       evaluated without round-tripping to Pulsar.
--   suspended_at      — set when Pulsar suspends the tenant; routes refuse to
--                       run flows while non-null.

ALTER TABLE flowcore.clinics
    ADD COLUMN IF NOT EXISTS pulsar_synced_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS pulsar_modules   TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_clinics_pulsar_synced_at
    ON flowcore.clinics (pulsar_synced_at);
