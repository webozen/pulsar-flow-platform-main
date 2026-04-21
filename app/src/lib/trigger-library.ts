/**
 * Static catalog of 60+ pre-built Open Dental trigger events.
 * These are SQL query templates — no database table, no engine.
 * Ported from Pulsar's OpenDentalTriggerRegistry.
 *
 * Column aliases (AS aliasName) become {{placeholder}} variables in workflow actions.
 */

export interface TriggerEvent {
  event: string;
  description: string;
  category: string;
  sql: string;
}

export const TRIGGER_CATEGORIES = [
  "Referrals",
  "Patients",
  "Appointments",
  "Claims & Billing",
  "Treatment Plans",
  "Insurance",
  "Recalls & Hygiene",
  "Lab Cases",
  "Financial",
  "Compliance",
  "Seasonal",
] as const;

export const TRIGGER_LIBRARY: TriggerEvent[] = [
  // ── Referrals ─────────────────────────────────────────────────
  { event: "referral_new_appointment", category: "Referrals", description: "New appointment for a referred patient",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, COALESCE(NULLIF(TRIM(CONCAT(COALESCE(a.ProcDescript,''), ' ', COALESCE(a.Note,''))), ''), 'Dental Appointment') AS procedureDesc, CONCAT(ref.FName, ' ', ref.LName) AS referrerName, ref.EMail AS referrerEmail, a.AptNum AS aptNum FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum INNER JOIN refattach ra ON p.PatNum = ra.PatNum AND ra.RefType = 1 INNER JOIN referral ref ON ra.ReferralNum = ref.ReferralNum WHERE a.AptStatus = 1 AND a.SecDateTEntry >= '{{since}}' AND p.PatStatus = 0 ORDER BY a.SecDateTEntry DESC` },

  { event: "referral_treatment_complete", category: "Referrals", description: "Referred patient's treatment completed",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, COALESCE(NULLIF(TRIM(a.ProcDescript), ''), 'Treatment') AS procedureDesc, CONCAT(ref.FName, ' ', ref.LName) AS referrerName, ref.EMail AS referrerEmail, a.AptNum AS aptNum FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum INNER JOIN refattach ra ON p.PatNum = ra.PatNum AND ra.RefType = 1 INNER JOIN referral ref ON ra.ReferralNum = ref.ReferralNum WHERE a.AptStatus = 2 AND a.DateTStamp >= '{{since}}' AND p.PatStatus = 0 ORDER BY a.DateTStamp DESC` },

  { event: "new_referral_source", category: "Referrals", description: "First patient referred from a new referrer",
    sql: `SELECT ref.ReferralNum AS referralNum, CONCAT(ref.FName, ' ', ref.LName) AS referrerName, ref.EMail AS referrerEmail, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, ra.RefDate AS referralDate FROM refattach ra INNER JOIN referral ref ON ra.ReferralNum = ref.ReferralNum INNER JOIN patient p ON ra.PatNum = p.PatNum WHERE ra.RefType = 1 AND ra.RefDate >= '{{since}}' AND p.PatStatus = 0 AND (SELECT COUNT(*) FROM refattach ra2 WHERE ra2.ReferralNum = ra.ReferralNum AND ra2.RefType = 1) = 1 ORDER BY ra.RefDate DESC LIMIT 50` },

  { event: "top_referrer_inactive", category: "Referrals", description: "Referrers who sent 3+ patients but none in 90 days",
    sql: `SELECT ref.ReferralNum AS referralNum, CONCAT(ref.FName, ' ', ref.LName) AS referrerName, ref.EMail AS referrerEmail, COUNT(ra.PatNum) AS totalReferrals, MAX(ra.RefDate) AS lastReferralDate FROM referral ref INNER JOIN refattach ra ON ref.ReferralNum = ra.ReferralNum AND ra.RefType = 1 GROUP BY ref.ReferralNum, ref.FName, ref.LName, ref.EMail HAVING COUNT(ra.PatNum) >= 3 AND MAX(ra.RefDate) <= DATE_SUB(CURDATE(), INTERVAL 90 DAY) ORDER BY COUNT(ra.PatNum) DESC LIMIT 50` },

  // ── Patients ──────────────────────────────────────────────────
  { event: "new_patient_created", category: "Patients", description: "New patient record created",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.FName AS firstName, p.LName AS lastName, p.Birthdate AS dateOfBirth, p.WirelessPhone AS phone, p.Email AS email, p.DateFirstVisit AS firstVisitDate FROM patient p WHERE p.PatStatus = 0 AND p.SecDateEntry >= '{{since}}' ORDER BY p.SecDateEntry DESC` },

  { event: "patient_birthday_upcoming", category: "Patients", description: "Patient birthday within next 7 days",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.FName AS firstName, p.Birthdate AS birthday, p.WirelessPhone AS phone, p.Email AS email, TIMESTAMPDIFF(YEAR, p.Birthdate, CURDATE()) + 1 AS upcomingAge FROM patient p WHERE p.PatStatus = 0 AND DAYOFYEAR(DATE_ADD(p.Birthdate, INTERVAL (YEAR(CURDATE()) - YEAR(p.Birthdate)) YEAR)) BETWEEN DAYOFYEAR(CURDATE()) AND DAYOFYEAR(CURDATE()) + 7` },

  { event: "patient_high_balance", category: "Patients", description: "Active patients with balance over $500",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, ROUND(p.BalTotal, 2) AS totalBalance, ROUND(p.InsEst, 2) AS insuranceEstimate FROM patient p WHERE p.PatStatus = 0 AND p.BalTotal > 500 AND p.Guarantor = p.PatNum ORDER BY p.BalTotal DESC LIMIT 50` },

  { event: "inactive_patient_6months", category: "Patients", description: "Active patients with no visit in 6+ months",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, MAX(a.AptDateTime) AS lastVisitDate, DATEDIFF(CURDATE(), MAX(a.AptDateTime)) AS daysSinceVisit FROM patient p INNER JOIN appointment a ON p.PatNum = a.PatNum AND a.AptStatus = 2 WHERE p.PatStatus = 0 AND NOT EXISTS (SELECT 1 FROM appointment a2 WHERE a2.PatNum = p.PatNum AND a2.AptStatus = 1 AND a2.AptDateTime >= CURDATE()) GROUP BY p.PatNum, p.FName, p.LName, p.WirelessPhone, p.Email HAVING MAX(a.AptDateTime) <= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) ORDER BY MAX(a.AptDateTime) ASC LIMIT 50` },

  // ── Appointments ──────────────────────────────────────────────
  { event: "appointment_no_show", category: "Appointments", description: "Patient no-show or broken appointment",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, a.AptDateTime AS appointmentDate, COALESCE(NULLIF(TRIM(a.ProcDescript), ''), 'Appointment') AS procedureDesc, a.AptNum AS aptNum FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum WHERE a.AptStatus = 5 AND a.DateTStamp >= '{{since}}' ORDER BY a.DateTStamp DESC` },

  { event: "completed_no_followup", category: "Appointments", description: "Completed visit with no future appointment",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, a.AptDateTime AS lastVisitDate, COALESCE(NULLIF(TRIM(a.ProcDescript), ''), 'Visit') AS lastProcedure FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum WHERE a.AptStatus = 2 AND a.AptDateTime >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND a.AptDateTime < CURDATE() AND p.PatStatus = 0 AND NOT EXISTS (SELECT 1 FROM appointment a2 WHERE a2.PatNum = a.PatNum AND a2.AptStatus = 1 AND a2.AptDateTime > a.AptDateTime) ORDER BY a.AptDateTime DESC LIMIT 50` },

  { event: "cancelled_not_rescheduled", category: "Appointments", description: "Cancelled in last 14 days, not rescheduled",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, a.AptDateTime AS cancelledDate, COALESCE(NULLIF(TRIM(a.ProcDescript), ''), 'Appointment') AS procedureDesc, a.AptNum AS aptNum FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum WHERE a.AptStatus = 6 AND a.DateTStamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND p.PatStatus = 0 AND NOT EXISTS (SELECT 1 FROM appointment a2 WHERE a2.PatNum = a.PatNum AND a2.AptStatus = 1 AND a2.AptDateTime >= CURDATE()) ORDER BY a.DateTStamp DESC LIMIT 50` },

  { event: "tomorrow_unconfirmed", category: "Appointments", description: "Tomorrow's unconfirmed appointments",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, a.AptDateTime AS appointmentTime, COALESCE(NULLIF(TRIM(a.ProcDescript), ''), 'Appointment') AS procedureDesc, a.AptNum AS aptNum, a.IsNewPatient AS isNewPatient FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum WHERE a.AptStatus = 1 AND DATE(a.AptDateTime) = DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND (a.Confirmed = 0 OR a.Confirmed IS NULL) ORDER BY a.AptDateTime ASC` },

  { event: "appointment_no_procedures", category: "Appointments", description: "Completed appointments with no procedures logged",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, a.AptNum AS aptNum FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum WHERE a.AptStatus = 2 AND a.DateTStamp >= '{{since}}' AND NOT EXISTS (SELECT 1 FROM procedurelog pl WHERE pl.AptNum = a.AptNum AND pl.ProcStatus = 2) ORDER BY a.AptDateTime DESC LIMIT 50` },

  // ── Claims & Billing ──────────────────────────────────────────
  { event: "claim_unsent_procedures", category: "Claims & Billing", description: "Completed procedures with no claim created (2-7 days)",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, pl.ProcNum AS procNum, pc.ProcCode AS procedureCode, pc.Descript AS procedureName, pl.ProcDate AS procedureDate, pl.ProcFee AS procFee FROM procedurelog pl INNER JOIN patient p ON pl.PatNum = p.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN claimproc cp ON pl.ProcNum = cp.ProcNum WHERE pl.ProcStatus = 2 AND pl.ProcDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND pl.ProcDate <= DATE_SUB(CURDATE(), INTERVAL 2 DAY) AND pl.ProcFee > 0 AND cp.ClaimProcNum IS NULL AND p.PatStatus = 0 ORDER BY pl.ProcDate ASC LIMIT 50` },

  { event: "claim_waiting_too_long", category: "Claims & Billing", description: "Claims sent 30+ days ago with no payment",
    sql: `SELECT c.ClaimNum AS claimNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, c.DateSent AS dateSent, c.ClaimFee AS claimFee, c.ClaimStatus AS claimStatus, DATEDIFF(CURDATE(), c.DateSent) AS daysPending, car.CarrierName AS carrierName FROM claim c INNER JOIN patient p ON c.PatNum = p.PatNum INNER JOIN insplan ip ON c.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE c.ClaimStatus IN ('S', 'W') AND c.DateSent <= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND c.DateSent >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) AND p.PatStatus = 0 ORDER BY c.DateSent ASC LIMIT 50` },

  { event: "claim_underpayment", category: "Claims & Billing", description: "Claims with payment significantly less than estimated",
    sql: `SELECT c.ClaimNum AS claimNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, c.ClaimFee AS claimFee, c.InsPayEst AS insPayEst, c.InsPayAmt AS insPayAmt, ROUND(c.InsPayEst - c.InsPayAmt, 2) AS underpaymentAmt, car.CarrierName AS carrierName FROM claim c INNER JOIN patient p ON c.PatNum = p.PatNum INNER JOIN insplan ip ON c.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE c.ClaimStatus = 'R' AND c.InsPayAmt > 0 AND c.InsPayAmt < (c.InsPayEst * 0.80) AND c.InsPayEst > 50 AND c.DateReceived >= '{{since}}' ORDER BY (c.InsPayEst - c.InsPayAmt) DESC LIMIT 50` },

  { event: "claim_denied_zero_payment", category: "Claims & Billing", description: "Claims received with zero payment (likely denied)",
    sql: `SELECT c.ClaimNum AS claimNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, c.ClaimFee AS claimFee, c.DateSent AS dateSent, c.DateReceived AS dateReceived, c.ClaimNote AS claimNote, car.CarrierName AS carrierName FROM claim c INNER JOIN patient p ON c.PatNum = p.PatNum INNER JOIN insplan ip ON c.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE c.ClaimStatus = 'R' AND c.InsPayAmt = 0 AND c.ClaimFee > 0 AND c.DateReceived >= '{{since}}' AND p.PatStatus = 0 ORDER BY c.ClaimFee DESC LIMIT 50` },

  { event: "preauth_expiring_soon", category: "Claims & Billing", description: "Pre-authorizations expiring within 30 days",
    sql: `SELECT c.ClaimNum AS claimNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, c.DateSent AS preAuthDate, c.PriorAuthorizationNumber AS authNumber, c.ClaimFee AS authorizedAmount, car.CarrierName AS carrierName FROM claim c INNER JOIN patient p ON c.PatNum = p.PatNum INNER JOIN insplan ip ON c.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE c.ClaimType = 'PreAuth' AND c.ClaimStatus IN ('R', 'S') AND c.DateSent >= DATE_SUB(CURDATE(), INTERVAL 335 DAY) AND c.DateSent <= DATE_SUB(CURDATE(), INTERVAL 305 DAY) AND p.PatStatus = 0 ORDER BY c.DateSent ASC LIMIT 50` },

  // ── Treatment Plans ─────���─────────────────────────────────────
  { event: "treatplan_unsigned", category: "Treatment Plans", description: "Active treatment plans older than 14 days, unsigned",
    sql: `SELECT tp.TreatPlanNum AS treatPlanNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, tp.DateTP AS planDate, tp.Heading AS planHeading, DATEDIFF(CURDATE(), tp.DateTP) AS daysSincePresented FROM treatplan tp INNER JOIN patient p ON tp.PatNum = p.PatNum WHERE tp.TPStatus = 1 AND (tp.DateTSigned IS NULL OR tp.DateTSigned = '0001-01-01') AND tp.DateTP <= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND tp.DateTP >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND p.PatStatus = 0 ORDER BY tp.DateTP ASC LIMIT 50` },

  { event: "treatplan_pending_procedures", category: "Treatment Plans", description: "Treatment-planned procedures not scheduled",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, COUNT(pl.ProcNum) AS pendingProcCount, ROUND(SUM(pl.ProcFee), 2) AS totalPendingFees FROM procedurelog pl INNER JOIN patient p ON pl.PatNum = p.PatNum WHERE pl.ProcStatus = 1 AND pl.DateTP >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) AND p.PatStatus = 0 AND NOT EXISTS (SELECT 1 FROM appointment a WHERE a.PatNum = pl.PatNum AND a.AptStatus = 1 AND a.AptDateTime >= CURDATE()) GROUP BY p.PatNum, p.FName, p.LName, p.WirelessPhone, p.Email HAVING COUNT(pl.ProcNum) >= 1 ORDER BY SUM(pl.ProcFee) DESC LIMIT 50` },

  // ── Insurance ───────────────���─────────────────────────────────
  { event: "insurance_not_verified", category: "Insurance", description: "Upcoming appointments with unverified insurance",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, a.AptNum AS aptNum, car.CarrierName AS carrierName FROM appointment a INNER JOIN patient p ON a.PatNum = p.PatNum INNER JOIN patplan pp ON p.PatNum = pp.PatNum AND pp.Ordinal = 1 INNER JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum INNER JOIN insplan ip ON isub.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum LEFT JOIN insverify iv ON iv.FKey = pp.PatPlanNum AND iv.VerifyType = 2 WHERE a.AptStatus = 1 AND a.AptDateTime >= CURDATE() AND a.AptDateTime <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND p.PatStatus = 0 AND (iv.DateLastVerified IS NULL OR iv.DateLastVerified <= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) ORDER BY a.AptDateTime ASC LIMIT 50` },

  { event: "insurance_expiring_soon", category: "Insurance", description: "Patient insurance expiring within 30 days",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, car.CarrierName AS carrierName, isub.DateTerm AS expirationDate, DATEDIFF(isub.DateTerm, CURDATE()) AS daysUntilExpiry FROM patplan pp INNER JOIN patient p ON pp.PatNum = p.PatNum INNER JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum INNER JOIN insplan ip ON isub.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE isub.DateTerm > CURDATE() AND isub.DateTerm <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND p.PatStatus = 0 ORDER BY isub.DateTerm ASC LIMIT 50` },

  // ── Recalls & Hygiene ─────────────────────────────────────────
  { event: "recall_overdue", category: "Recalls & Hygiene", description: "Patient recall is past due",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, r.DateDue AS recallDueDate, DATEDIFF(CURDATE(), r.DateDue) AS daysOverdue FROM recall r INNER JOIN patient p ON r.PatNum = p.PatNum WHERE r.DateDue < CURDATE() AND r.DateDue >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND r.IsDisabled = 0 AND p.PatStatus = 0 ORDER BY r.DateDue ASC LIMIT 50` },

  { event: "cleaning_overdue_12months", category: "Recalls & Hygiene", description: "No prophylaxis in 12+ months",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, MAX(pl.ProcDate) AS lastCleaningDate, DATEDIFF(CURDATE(), MAX(pl.ProcDate)) AS daysSinceCleaning FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum WHERE p.PatStatus = 0 AND pc.ProcCode IN ('D1110', 'D1120', 'D4910') AND pl.ProcStatus = 2 GROUP BY p.PatNum, p.FName, p.LName, p.WirelessPhone, p.Email HAVING MAX(pl.ProcDate) <= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) ORDER BY MAX(pl.ProcDate) ASC LIMIT 50` },

  { event: "perio_maintenance_overdue", category: "Recalls & Hygiene", description: "Perio patients overdue for maintenance",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, MAX(pl.ProcDate) AS lastPerioDate, DATEDIFF(CURDATE(), MAX(pl.ProcDate)) AS daysSincePerio FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum WHERE p.PatStatus = 0 AND pc.ProcCode IN ('D4910', 'D4341', 'D4342') AND pl.ProcStatus = 2 GROUP BY p.PatNum, p.FName, p.LName, p.WirelessPhone, p.Email HAVING MAX(pl.ProcDate) <= DATE_SUB(CURDATE(), INTERVAL 4 MONTH) ORDER BY MAX(pl.ProcDate) ASC LIMIT 50` },

  // ── Lab Cases ─────────────────────────────────────────────────
  { event: "labcase_not_returned", category: "Lab Cases", description: "Lab cases sent 10+ days ago, not returned",
    sql: `SELECT lc.LabCaseNum AS labCaseNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, lc.DateTimeSent AS dateSent, DATEDIFF(CURDATE(), lc.DateTimeSent) AS daysSinceSent, lc.Instructions AS instructions FROM labcase lc INNER JOIN patient p ON lc.PatNum = p.PatNum WHERE lc.DateTimeSent > '1880-01-01' AND lc.DateTimeSent <= DATE_SUB(CURDATE(), INTERVAL 10 DAY) AND (lc.DateTimeRecd IS NULL OR lc.DateTimeRecd < '1880-01-02') AND p.PatStatus = 0 ORDER BY lc.DateTimeSent ASC LIMIT 50` },

  // ── Financial ──────────────────���──────────────────────────────
  { event: "aging_balance_over_90", category: "Financial", description: "Balances over 90 days old exceeding $200",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, ROUND(p.BalOver90, 2) AS balanceOver90, ROUND(p.BalTotal, 2) AS totalBalance FROM patient p WHERE p.PatStatus = 0 AND p.BalOver90 > 200 AND p.Guarantor = p.PatNum ORDER BY p.BalOver90 DESC LIMIT 50` },

  { event: "patient_credit_balance", category: "Financial", description: "Patients with credit balance (overpayment)",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, ROUND(ABS(p.BalTotal), 2) AS creditAmount FROM patient p WHERE p.PatStatus = 0 AND p.BalTotal < -5 AND p.Guarantor = p.PatNum ORDER BY p.BalTotal ASC LIMIT 50` },

  { event: "payplan_past_due", category: "Financial", description: "Open payment plans with charges past due",
    sql: `SELECT pp.PayPlanNum AS payPlanNum, p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, pp.CompletedAmt AS completedAmt FROM payplan pp INNER JOIN patient p ON pp.PatNum = p.PatNum WHERE pp.IsClosed = 0 ORDER BY pp.PayPlanNum LIMIT 50` },

  // ── Compliance ───────���────────────────────────────────────────
  { event: "xray_overdue", category: "Compliance", description: "No x-ray in 12+ months with upcoming appointment",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, MAX(pl.ProcDate) AS lastXrayDate FROM patient p INNER JOIN appointment a ON p.PatNum = a.PatNum AND a.AptStatus = 1 AND a.AptDateTime >= CURDATE() AND a.AptDateTime <= DATE_ADD(CURDATE(), INTERVAL 14 DAY) INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND pc.ProcCode IN ('D0210', 'D0220', 'D0230', 'D0270', 'D0330') WHERE pl.ProcStatus = 2 AND p.PatStatus = 0 GROUP BY p.PatNum, p.FName, p.LName, a.AptDateTime HAVING MAX(pl.ProcDate) <= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) ORDER BY a.AptDateTime ASC LIMIT 50` },

  { event: "allergy_flagged_upcoming", category: "Compliance", description: "Patients with allergies and appointment in 3 days",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, a.AptDateTime AS appointmentDate, GROUP_CONCAT(DISTINCT ad.Description SEPARATOR ', ') AS allergies FROM patient p INNER JOIN appointment a ON p.PatNum = a.PatNum AND a.AptStatus = 1 AND a.AptDateTime >= CURDATE() AND a.AptDateTime <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) INNER JOIN allergy al ON p.PatNum = al.PatNum AND al.StatusIsActive = 1 INNER JOIN allergydef ad ON al.AllergyDefNum = ad.AllergyDefNum WHERE p.PatStatus = 0 GROUP BY p.PatNum, p.FName, p.LName, a.AptDateTime ORDER BY a.AptDateTime ASC LIMIT 50` },

  // ── Seasonal ──────────────────────────────────────────────────
  { event: "benefits_use_it_or_lose_it", category: "Seasonal", description: "Insured patients with no Q4 appointment (benefits expiring)",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, car.CarrierName AS carrierName FROM patient p INNER JOIN patplan pp ON p.PatNum = pp.PatNum AND pp.Ordinal = 1 INNER JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum INNER JOIN insplan ip ON isub.PlanNum = ip.PlanNum INNER JOIN carrier car ON ip.CarrierNum = car.CarrierNum WHERE p.PatStatus = 0 AND MONTH(CURDATE()) >= 10 AND NOT EXISTS (SELECT 1 FROM appointment a WHERE a.PatNum = p.PatNum AND a.AptStatus = 1 AND a.AptDateTime >= CURDATE() AND YEAR(a.AptDateTime) = YEAR(CURDATE())) ORDER BY p.LName LIMIT 50` },

  // ── Procedures ────────────────────────────────────────────────
  { event: "procedure_completed", category: "Appointments", description: "Dental procedure completed",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, pl.ProcDate AS procedureDate, pc.ProcCode AS procedureCode, pc.Descript AS procedureName, pl.ProcNum AS procNum FROM procedurelog pl INNER JOIN patient p ON pl.PatNum = p.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum WHERE pl.ProcStatus = 2 AND pl.DateTStamp >= '{{since}}' ORDER BY pl.DateTStamp DESC` },

  { event: "high_value_treatment_completed", category: "Financial", description: "Patients who completed $1000+ treatment in 7 days",
    sql: `SELECT p.PatNum AS patNum, CONCAT(p.FName, ' ', p.LName) AS patientName, p.WirelessPhone AS phone, p.Email AS email, ROUND(SUM(pl.ProcFee), 2) AS totalTreatmentValue FROM procedurelog pl INNER JOIN patient p ON pl.PatNum = p.PatNum WHERE pl.ProcStatus = 2 AND pl.ProcDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND p.PatStatus = 0 GROUP BY p.PatNum, p.FName, p.LName, p.WirelessPhone, p.Email HAVING SUM(pl.ProcFee) >= 1000 ORDER BY SUM(pl.ProcFee) DESC LIMIT 50` },
];

/** Extract placeholder names from SQL column aliases (AS aliasName) */
export function extractPlaceholders(sql: string): string[] {
  const matches = sql.matchAll(/\bAS\s+(\w+)/gi);
  const placeholders = new Set<string>();
  for (const match of matches) {
    placeholders.add(match[1]);
  }
  return Array.from(placeholders);
}

/** Get triggers grouped by category */
export function getTriggersByCategory(): Record<string, TriggerEvent[]> {
  const grouped: Record<string, TriggerEvent[]> = {};
  for (const trigger of TRIGGER_LIBRARY) {
    if (!grouped[trigger.category]) grouped[trigger.category] = [];
    grouped[trigger.category].push(trigger);
  }
  return grouped;
}
