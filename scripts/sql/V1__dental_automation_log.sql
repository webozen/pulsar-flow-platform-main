-- Dental automation tracking table for dedup and audit.
-- Run this against each clinic's Open Dental MySQL instance.
-- This table is OUTSIDE Open Dental's core schema — it belongs to Flowcore.

CREATE TABLE IF NOT EXISTS dental_automation_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id      BIGINT NOT NULL,
    workflow_type   VARCHAR(64)  NOT NULL COMMENT 'recall_reminder, appointment_reminder, claims_followup, treatment_followup',
    channel         VARCHAR(32)  NOT NULL COMMENT 'sms, email, internal, sms_email',
    status          VARCHAR(32)  NOT NULL COMMENT 'sent, sent_48h, flagged, escalated, notified',
    metadata_json   TEXT                  COMMENT 'Flow-specific metadata (claim number, proc code, etc.)',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX ix_dedup (patient_id, workflow_type, created_at),
    INDEX ix_workflow (workflow_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
