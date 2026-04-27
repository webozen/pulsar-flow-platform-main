-- 003_drop_dead_schema.sql — Phase 1 + Phase 2 cleanup
--
-- Plan B + post-subflow architecture leftovers. None of these tables
-- or columns are read or written by application code (verified via
-- grep before this migration was authored).
--
--   Phase 1 (dead tables — never written, never read):
--     flowcore.users
--     flowcore.email_attachments
--     flowcore.email_messages
--     flowcore.email_opt_outs
--
--   Phase 2 (dead columns on flowcore.clinics):
--     - Plan A secrets that moved to Kestra KV:
--         twilio_sid, smtp_host, smtp_port, smtp_username, smtp_from,
--         opendental_api_url, opendental_api_key
--     - Pulsar-owned facts (mirror, not source):
--         billing_email, front_desk_email, phone, updated_at
--     - Derivable from slug:
--         kestra_namespace  (== `dental.<slug>`, computed by namespaceFor)
--
-- After this migration `flowcore.clinics` keeps only what the inbound
-- Twilio webhook routing (number → slug) and the dashboard "active
-- clinics" tile actually need:
--     id, name, slug, timezone, is_active, twilio_from_number, created_at

BEGIN;

-- Phase 1: dead tables -------------------------------------------------
DROP TABLE IF EXISTS flowcore.email_attachments CASCADE;
DROP TABLE IF EXISTS flowcore.email_opt_outs   CASCADE;
DROP TABLE IF EXISTS flowcore.email_messages   CASCADE;
DROP TABLE IF EXISTS flowcore.users            CASCADE;

-- Phase 2: dead columns ------------------------------------------------
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS twilio_sid;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS smtp_host;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS smtp_port;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS smtp_username;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS smtp_from;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS opendental_api_url;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS opendental_api_key;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS billing_email;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS front_desk_email;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS phone;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS updated_at;
ALTER TABLE flowcore.clinics DROP CONSTRAINT IF EXISTS clinics_kestra_namespace_key;
ALTER TABLE flowcore.clinics DROP COLUMN IF EXISTS kestra_namespace;

COMMIT;
