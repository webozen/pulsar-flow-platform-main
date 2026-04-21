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

export async function initDb() {
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS flowcore`);

  // Clinics — each clinic is a tenant with its own Kestra namespace
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.clinics (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      phone TEXT,
      timezone TEXT DEFAULT 'America/New_York',
      kestra_namespace TEXT UNIQUE NOT NULL,
      -- Open Dental API (replaces direct MySQL)
      opendental_api_url TEXT,
      opendental_api_key TEXT,
      -- Twilio
      twilio_sid TEXT,
      twilio_from_number TEXT,
      -- SMTP
      smtp_host TEXT,
      smtp_port INT DEFAULT 587,
      smtp_username TEXT,
      smtp_from TEXT,
      -- Routing
      billing_email TEXT,
      front_desk_email TEXT,
      -- State
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
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

  // Email messages — parallel to sms_messages. Inbound via SendGrid Parse,
  // outbound via SendGrid Mail Send. Attachments stored separately.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.email_messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      sendgrid_message_id TEXT,
      pat_num TEXT,
      execution_id TEXT,
      keyword TEXT,
      spam_score NUMERIC,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_messages_clinic_from_idx ON flowcore.email_messages(clinic_id, from_address, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_messages_sg_msg_idx ON flowcore.email_messages(sendgrid_message_id)`);

  // Email attachments — one row per attachment on an inbound email
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.email_attachments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email_message_id TEXT NOT NULL REFERENCES flowcore.email_messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes INT,
      storage_path TEXT,
      opendental_doc_num TEXT,
      uploaded_to_opendental_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Email opt-outs — patients who unsubscribed or hard-bounced
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.email_opt_outs (
      clinic_id TEXT NOT NULL REFERENCES flowcore.clinics(id) ON DELETE CASCADE,
      email_address TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (clinic_id, email_address)
    )
  `);

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

  // Users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowcore.users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      role TEXT DEFAULT 'STAFF',
      clinic_id TEXT REFERENCES flowcore.clinics(id),
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
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
