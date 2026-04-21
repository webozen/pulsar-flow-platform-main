-- Minimal Open Dental schema + test data for integration testing.
-- This is NOT a complete Open Dental schema — only the tables and columns
-- referenced by Flowcore's YAML workflows.

-- Patients
CREATE TABLE IF NOT EXISTS patient (
    PatNum        BIGINT AUTO_INCREMENT PRIMARY KEY,
    FName         VARCHAR(100),
    LName         VARCHAR(100),
    Email         VARCHAR(255),
    WirelessPhone VARCHAR(20),
    HmPhone       VARCHAR(20),
    PatStatus     TINYINT DEFAULT 0  -- 0=Active
);

-- Recalls (hygiene/perio due dates)
CREATE TABLE IF NOT EXISTS recall (
    RecallNum     BIGINT AUTO_INCREMENT PRIMARY KEY,
    PatNum        BIGINT NOT NULL,
    DateDue       DATE,
    RecallTypeNum BIGINT DEFAULT 1,
    IsDisabled    TINYINT DEFAULT 0
);

-- Appointments
CREATE TABLE IF NOT EXISTS appointment (
    AptNum      BIGINT AUTO_INCREMENT PRIMARY KEY,
    PatNum      BIGINT NOT NULL,
    AptDateTime DATETIME,
    AptStatus   TINYINT DEFAULT 1,  -- 1=Scheduled
    Confirmed   BIGINT DEFAULT 0
);

-- Procedure codes
CREATE TABLE IF NOT EXISTS procedurecode (
    CodeNum   BIGINT AUTO_INCREMENT PRIMARY KEY,
    ProcCode  VARCHAR(15),
    Descript  VARCHAR(255)
);

-- Procedure log (treatment plans)
CREATE TABLE IF NOT EXISTS procedurelog (
    ProcNum    BIGINT AUTO_INCREMENT PRIMARY KEY,
    PatNum     BIGINT NOT NULL,
    CodeNum    BIGINT NOT NULL,
    ProcDate   DATE,
    ProcStatus TINYINT DEFAULT 1  -- 1=Treatment Planned
);

-- Insurance carriers
CREATE TABLE IF NOT EXISTS carrier (
    CarrierNum  BIGINT AUTO_INCREMENT PRIMARY KEY,
    CarrierName VARCHAR(255),
    Phone       VARCHAR(30)
);

-- Insurance plans
CREATE TABLE IF NOT EXISTS insplan (
    PlanNum      BIGINT AUTO_INCREMENT PRIMARY KEY,
    CarrierNum   BIGINT NOT NULL,
    SubscriberID VARCHAR(50)
);

-- Claims
CREATE TABLE IF NOT EXISTS claim (
    ClaimNum    BIGINT AUTO_INCREMENT PRIMARY KEY,
    PatNum      BIGINT NOT NULL,
    PlanNum     BIGINT NOT NULL,
    ClaimStatus CHAR(1) DEFAULT 'S',  -- S=Sent, W=Waiting, R=Received
    DateSent    DATE,
    ClaimFee    DECIMAL(10,2) DEFAULT 0,
    InsPayAmt   DECIMAL(10,2) DEFAULT 0
);

-- Definition table (used for confirmation status lookups)
CREATE TABLE IF NOT EXISTS definition (
    DefNum   BIGINT AUTO_INCREMENT PRIMARY KEY,
    Category INT,
    ItemName VARCHAR(50)
);

-- ============================================================
-- TEST DATA
-- ============================================================

-- Procedure codes
INSERT INTO procedurecode (CodeNum, ProcCode, Descript) VALUES
    (1, 'D0120', 'Periodic Oral Evaluation'),
    (2, 'D1110', 'Prophylaxis - Adult'),
    (3, 'D2750', 'Crown - Porcelain Fused to High Noble Metal'),
    (4, 'D7140', 'Extraction, Erupted Tooth');

-- Carrier
INSERT INTO carrier (CarrierNum, CarrierName, Phone) VALUES
    (1, 'Delta Dental', '(800) 765-6003'),
    (2, 'MetLife Dental', '(800) 942-0854');

-- Insurance plans
INSERT INTO insplan (PlanNum, CarrierNum, SubscriberID) VALUES
    (1, 1, 'DD-123456'),
    (2, 2, 'ML-789012');

-- Confirmed status definition
INSERT INTO definition (DefNum, Category, ItemName) VALUES
    (1, 2, 'Not Called'),
    (2, 2, 'Confirmed');

-- Patients
INSERT INTO patient (PatNum, FName, LName, Email, WirelessPhone, HmPhone, PatStatus) VALUES
    (1, 'Alice',   'Johnson',  'alice@example.com',   '+14155550101', '(415) 555-0100', 0),
    (2, 'Bob',     'Smith',    'bob@example.com',     '+14155550102', NULL,              0),
    (3, 'Carol',   'Williams', NULL,                  '+14155550103', NULL,              0),
    (4, 'David',   'Brown',    'david@example.com',   NULL,           '(415) 555-0104', 0),
    (5, 'Eve',     'Davis',    'eve@example.com',     '+14155550105', NULL,              0);

-- Overdue recalls (Alice and Bob are overdue, no future appointments)
INSERT INTO recall (RecallNum, PatNum, DateDue, RecallTypeNum, IsDisabled) VALUES
    (1, 1, DATE_SUB(CURDATE(), INTERVAL 30 DAY), 1, 0),  -- Alice: 30 days overdue
    (2, 2, DATE_SUB(CURDATE(), INTERVAL 60 DAY), 1, 0),  -- Bob: 60 days overdue
    (3, 3, DATE_SUB(CURDATE(), INTERVAL 10 DAY), 1, 0),  -- Carol: 10 days overdue (no email)
    (4, 5, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1, 0);  -- Eve: not overdue (future)

-- Upcoming appointments (unconfirmed)
INSERT INTO appointment (AptNum, PatNum, AptDateTime, AptStatus, Confirmed) VALUES
    (1, 1, DATE_ADD(NOW(), INTERVAL 36 HOUR), 1, 1),  -- Alice: tomorrow, unconfirmed
    (2, 5, DATE_ADD(NOW(), INTERVAL 24 HOUR), 1, 2);  -- Eve: tomorrow, confirmed

-- Stale claims (Bob has a 45-day-old claim)
INSERT INTO claim (ClaimNum, PatNum, PlanNum, ClaimStatus, DateSent, ClaimFee, InsPayAmt) VALUES
    (1, 2, 1, 'S', DATE_SUB(CURDATE(), INTERVAL 45 DAY), 850.00, 0),   -- Bob: stale
    (2, 5, 2, 'R', DATE_SUB(CURDATE(), INTERVAL 20 DAY), 200.00, 200); -- Eve: received (ok)

-- Unscheduled treatment plans (Carol has a crown planned 21 days ago, no appointment)
INSERT INTO procedurelog (ProcNum, PatNum, CodeNum, ProcDate, ProcStatus) VALUES
    (1, 3, 3, DATE_SUB(CURDATE(), INTERVAL 21 DAY), 1),  -- Carol: crown, 21 days old
    (2, 4, 4, DATE_SUB(CURDATE(), INTERVAL 7 DAY),  1);  -- David: extraction, only 7 days (too soon)
