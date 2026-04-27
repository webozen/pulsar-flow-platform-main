import { Pool } from "pg";

const globalForDb = globalThis as unknown as { pool: Pool | undefined };

export function getPool(): Pool {
  if (!globalForDb.pool) {
    globalForDb.pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://kestra:k3stra_dev@localhost:5432/kestra",
    });
  }
  return globalForDb.pool;
}

// One-shot guard: every API route currently calls `await initDb()` defensively.
// Running 11 CREATE TABLE IF NOT EXISTS statements on every request adds
// 100-300ms latency for no useful work — the schema is already created by
// `node scripts/migrate-pg.mjs`. Cache the first invocation per Node process.
let initOnce: Promise<void> | null = null;
export async function initDb(): Promise<void> {
  if (initOnce) return initOnce;
  initOnce = doInit().catch((e) => { initOnce = null; throw e; });
  return initOnce;
}

async function doInit() {
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS flowcore`);

  // Clinics — thin index for inbound webhook routing (Twilio number →
  // slug) plus the dashboard's "active clinics" tile. Per-tenant
  // secrets (Twilio, OpenDental, SMTP) live in Kestra KV under
  // `dental.<slug>`. Phase 2 cleanup dropped Plan A leftover columns.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.clinics (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      timezone TEXT DEFAULT 'America/New_York',
      twilio_from_number TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Workflows — per-clinic workflow definitions, stored here and synced to Kestra
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.workflows (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      -- Trigger: what fires this workflow
      trigger_type TEXT NOT NULL DEFAULT 'schedule',
      trigger_cron TEXT DEFAULT '0 7 * * *',
      trigger_sql TEXT,
      -- Actions: what happens (ordered JSON array)
      actions JSONB NOT NULL DEFAULT '[]',
      -- State
      is_enabled BOOLEAN DEFAULT true,
      kestra_flow_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(clinic_id, name)
    )
  `);

  // SMS Conversations — two-way messaging threads per phone number per clinic
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.sms_messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      body TEXT NOT NULL,
      twilio_sid TEXT,
      pat_num TEXT,
      execution_id TEXT,
      keyword TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sms_messages_clinic_from_idx ON flowcore.sms_messages(clinic_id, from_number, created_at DESC)`);

  // Opt-outs — patients who replied STOP
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.sms_opt_outs (
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (clinic_id, phone_number)
    )
  `);

  // Phone lookup cache — avoid paying for repeat Twilio Lookup API calls
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.phone_lookups (
      phone_number TEXT PRIMARY KEY,
      valid BOOLEAN NOT NULL,
      line_type TEXT,
      carrier TEXT,
      country_code TEXT,
      raw JSONB,
      looked_up_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // (Removed: email_messages, email_attachments, email_opt_outs — Phase 1
  // dead-schema drop. Email feature isn't shipped; tables had zero
  // INSERTs in code. Reintroduce when email actually goes live.)

  // Voice calls — outbound IVR calls (press 1 to confirm, etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.voice_calls (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      twilio_sid TEXT,
      to_number TEXT NOT NULL,
      from_number TEXT,
      status TEXT,
      pat_num TEXT,
      execution_id TEXT,
      response_digit TEXT,
      duration_sec INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    )
  `);

  // (Removed: flowcore.users — Phase 1 dead-schema drop. Auth lives in
  // pulsar-backend's `pulsar_platform.public_tenants` and tenant JWT;
  // flow-platform never had its own user store.)

  // Approval audit log — one row per Approve/Skip click. Compliance
  // surface: answers "who approved the SMS to patient X on date Y"
  // even after Kestra retention rotates the execution.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.approval_audit (
      id            BIGSERIAL PRIMARY KEY,
      ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      slug          TEXT NOT NULL,
      actor_email   TEXT,
      actor_role    TEXT,
      action        TEXT NOT NULL CHECK (action IN ('approve','skip')),
      execution_id  TEXT NOT NULL,
      flow_id       TEXT,
      payload       JSONB
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS approval_audit_slug_ts_idx ON flowcore.approval_audit (slug, ts DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS approval_audit_exec_idx ON flowcore.approval_audit (execution_id)`);
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}
