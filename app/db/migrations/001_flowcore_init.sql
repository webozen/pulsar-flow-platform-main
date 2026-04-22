-- Initial flowcore schema. Pulled from the canonical deployment 2026-04-21.
-- Runs inside a transaction; if any statement fails nothing is applied.

CREATE SCHEMA IF NOT EXISTS flowcore;

CREATE TABLE IF NOT EXISTS flowcore.clinics (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    phone text,
    timezone text DEFAULT 'America/New_York'::text,
    kestra_namespace text NOT NULL,
    opendental_api_url text,
    opendental_api_key text,
    twilio_sid text,
    twilio_from_number text,
    smtp_host text,
    smtp_port integer DEFAULT 587,
    smtp_username text,
    smtp_from text,
    billing_email text,
    front_desk_email text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT clinics_pkey PRIMARY KEY (id),
    CONSTRAINT clinics_slug_key UNIQUE (slug),
    CONSTRAINT clinics_kestra_namespace_key UNIQUE (kestra_namespace)
);

CREATE TABLE IF NOT EXISTS flowcore.users (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text,
    email text NOT NULL,
    password text,
    role text DEFAULT 'STAFF'::text,
    clinic_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id)
);

CREATE TABLE IF NOT EXISTS flowcore.workflows (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    clinic_id text NOT NULL,
    name text NOT NULL,
    description text,
    trigger_type text DEFAULT 'schedule'::text NOT NULL,
    trigger_cron text DEFAULT '0 7 * * *'::text,
    trigger_sql text,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_enabled boolean DEFAULT true,
    kestra_flow_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workflows_pkey PRIMARY KEY (id),
    CONSTRAINT workflows_clinic_id_name_key UNIQUE (clinic_id, name),
    CONSTRAINT workflows_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flowcore.sms_messages (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    clinic_id text NOT NULL,
    direction text NOT NULL,
    from_number text NOT NULL,
    to_number text NOT NULL,
    body text NOT NULL,
    twilio_sid text,
    pat_num text,
    execution_id text,
    keyword text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sms_messages_pkey PRIMARY KEY (id),
    CONSTRAINT sms_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
    CONSTRAINT sms_messages_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sms_messages_clinic_from_idx ON flowcore.sms_messages (clinic_id, from_number, created_at DESC);

CREATE TABLE IF NOT EXISTS flowcore.sms_opt_outs (
    clinic_id text NOT NULL,
    phone_number text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sms_opt_outs_pkey PRIMARY KEY (clinic_id, phone_number),
    CONSTRAINT sms_opt_outs_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flowcore.email_messages (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    clinic_id text NOT NULL,
    direction text NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    subject text,
    body_text text,
    body_html text,
    sendgrid_message_id text,
    pat_num text,
    execution_id text,
    keyword text,
    spam_score numeric,
    status text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_messages_pkey PRIMARY KEY (id),
    CONSTRAINT email_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
    CONSTRAINT email_messages_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS email_messages_clinic_from_idx ON flowcore.email_messages (clinic_id, from_address, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_sg_msg_idx ON flowcore.email_messages (sendgrid_message_id);

CREATE TABLE IF NOT EXISTS flowcore.email_attachments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    email_message_id text NOT NULL,
    filename text NOT NULL,
    content_type text,
    size_bytes integer,
    storage_path text,
    opendental_doc_num text,
    uploaded_to_opendental_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_attachments_pkey PRIMARY KEY (id),
    CONSTRAINT email_attachments_email_message_id_fkey FOREIGN KEY (email_message_id) REFERENCES flowcore.email_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flowcore.email_opt_outs (
    clinic_id text NOT NULL,
    email_address text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_opt_outs_pkey PRIMARY KEY (clinic_id, email_address),
    CONSTRAINT email_opt_outs_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flowcore.phone_lookups (
    phone_number text NOT NULL,
    valid boolean NOT NULL,
    line_type text,
    carrier text,
    country_code text,
    raw jsonb,
    looked_up_at timestamp with time zone DEFAULT now(),
    CONSTRAINT phone_lookups_pkey PRIMARY KEY (phone_number)
);

CREATE TABLE IF NOT EXISTS flowcore.voice_calls (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    clinic_id text NOT NULL,
    twilio_sid text,
    to_number text NOT NULL,
    from_number text,
    status text,
    pat_num text,
    execution_id text,
    response_digit text,
    duration_sec integer,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT voice_calls_pkey PRIMARY KEY (id),
    CONSTRAINT voice_calls_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES flowcore.clinics(id) ON DELETE CASCADE
);
