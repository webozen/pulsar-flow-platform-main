/**
 * Pre-built workflow templates. Each is a complete workflow definition
 * that pre-fills the create form. User can customize before saving.
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: "Recalls" | "Appointments" | "Claims" | "Patients" | "Reviews";
  triggerEvent: string;
  triggerCron: string;
  actionMode: "immediate" | "on_approval" | "manual";
  actions: {
    type: string;
    [key: string]: unknown;
  }[];
  taskTitle?: string;
  taskPriority?: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ── Recalls ───────────────────────────────────────────────────
  {
    id: "recall-sms-email",
    name: "Overdue Recall Reminder (SMS + Email)",
    description: "SMS reminder → wait 3 days → email follow-up → wait 7 days → escalate to front desk",
    category: "Recalls",
    triggerEvent: "recall_overdue",
    triggerCron: "0 9 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, this is {{ kv('clinic_name') }}. You're overdue for a dental visit. Call us at {{ kv('clinic_phone') }} to schedule. Reply STOP to opt out." },
      { type: "pause", duration: "P3D" },
      { type: "condition", field: "email", operator: "is_not_empty" },
      { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "{{ taskrun.value.patientName }}, time for your dental checkup", body: "Hi {{ taskrun.value.patientName }},\n\nOur records show you're overdue for your dental visit. Regular checkups are important for your oral health.\n\nPlease call us at {{ kv('clinic_phone') }} to schedule.\n\nBest regards,\n{{ kv('clinic_name') }}" },
      { type: "pause", duration: "P7D" },
      { type: "email", emailTo: "{{ kv('front_desk_email') }}", subject: "ESCALATION: {{ taskrun.value.patientName }} - overdue recall", body: "Patient {{ taskrun.value.patientName }} ({{ taskrun.value.phone }}) was contacted 10 days ago but hasn't scheduled. Please follow up directly." },
    ],
  },
  {
    id: "recall-simple-sms",
    name: "Simple Recall SMS",
    description: "Single SMS reminder for overdue recalls",
    category: "Recalls",
    triggerEvent: "recall_overdue",
    triggerCron: "0 9 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, {{ kv('clinic_name') }} here. You're due for a dental visit! Call {{ kv('clinic_phone') }} to schedule." },
    ],
  },

  // ── Appointments ──────────────────────────────────────────────
  {
    id: "appointment-confirmation",
    name: "Tomorrow's Appointment Confirmation",
    description: "SMS patients with unconfirmed appointments tomorrow morning",
    category: "Appointments",
    triggerEvent: "tomorrow_unconfirmed",
    triggerCron: "0 9 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, reminder: you have a dental appointment tomorrow at {{ kv('clinic_name') }}. Reply CONFIRM or call {{ kv('clinic_phone') }} to reschedule." },
    ],
  },
  {
    id: "no-show-followup",
    name: "No-Show Follow-Up",
    description: "Contact patients who no-showed → wait 2 days → create reschedule task",
    category: "Appointments",
    triggerEvent: "appointment_no_show",
    triggerCron: "0 17 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, we missed you today at {{ kv('clinic_name') }}. Call {{ kv('clinic_phone') }} to reschedule your appointment." },
      { type: "pause", duration: "P2D" },
      { type: "email", emailTo: "{{ kv('front_desk_email') }}", subject: "No-show follow-up: {{ taskrun.value.patientName }}", body: "Patient {{ taskrun.value.patientName }} ({{ taskrun.value.phone }}) no-showed on {{ taskrun.value.appointmentDate }} and hasn't rescheduled. Please reach out." },
    ],
  },
  {
    id: "cancelled-rebook",
    name: "Cancelled Appointment Re-Book",
    description: "Reach out to patients who cancelled in the last 14 days and haven't rescheduled",
    category: "Appointments",
    triggerEvent: "cancelled_not_rescheduled",
    triggerCron: "0 10 * * 1",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, we noticed you cancelled your recent appointment at {{ kv('clinic_name') }}. We'd love to get you rescheduled. Call {{ kv('clinic_phone') }}." },
    ],
  },

  // ── Claims ────────────────────────────────────────────────────
  {
    id: "stale-claim-alert",
    name: "Stale Claim Alert (Approval Required)",
    description: "Flag claims >30 days old for billing team review before follow-up",
    category: "Claims",
    triggerEvent: "claim_waiting_too_long",
    triggerCron: "0 8 * * 1",
    actionMode: "on_approval",
    taskTitle: "Review stale claim: {{ taskrun.value.patientName }} - {{ taskrun.value.carrierName }}",
    taskPriority: "HIGH",
    actions: [
      { type: "email", emailTo: "{{ kv('billing_team_email') }}", subject: "Action Required: Stale claim #{{ taskrun.value.claimNum }}", body: "Patient: {{ taskrun.value.patientName }}\nCarrier: {{ taskrun.value.carrierName }}\nAmount: ${{ taskrun.value.claimFee }}\nDays pending: {{ taskrun.value.daysPending }}\n\nPlease follow up with the carrier." },
    ],
  },
  {
    id: "denied-claim-alert",
    name: "Denied Claim Alert",
    description: "Immediately notify billing when a claim is denied (zero payment)",
    category: "Claims",
    triggerEvent: "claim_denied_zero_payment",
    triggerCron: "0 */4 * * *",
    actionMode: "immediate",
    actions: [
      { type: "email", emailTo: "{{ kv('billing_team_email') }}", subject: "DENIED: Claim #{{ taskrun.value.claimNum }} - {{ taskrun.value.patientName }}", body: "Claim #{{ taskrun.value.claimNum }} for {{ taskrun.value.patientName }} was denied by {{ taskrun.value.carrierName }}.\nAmount: ${{ taskrun.value.claimFee }}\nNote: {{ taskrun.value.claimNote }}" },
    ],
  },

  // ── Patients ──────────────────────────────────────────────────
  {
    id: "new-patient-welcome",
    name: "New Patient Welcome",
    description: "Send welcome SMS + email when a new patient is created",
    category: "Patients",
    triggerEvent: "new_patient_created",
    triggerCron: "0 */2 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Welcome to {{ kv('clinic_name') }}, {{ taskrun.value.firstName }}! We're excited to have you. Call {{ kv('clinic_phone') }} if you have any questions before your visit." },
      { type: "condition", field: "email", operator: "is_not_empty" },
      { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "Welcome to {{ kv('clinic_name') }}, {{ taskrun.value.firstName }}!", body: "Hi {{ taskrun.value.firstName }},\n\nWelcome to {{ kv('clinic_name') }}! We look forward to taking care of your dental health.\n\nIf you have any questions, call us at {{ kv('clinic_phone') }}.\n\nBest regards,\n{{ kv('clinic_name') }}" },
    ],
  },
  {
    id: "birthday-greeting",
    name: "Patient Birthday Greeting",
    description: "Send birthday wishes to patients with upcoming birthdays",
    category: "Patients",
    triggerEvent: "patient_birthday_upcoming",
    triggerCron: "0 9 * * *",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Happy Birthday, {{ taskrun.value.firstName }}! From all of us at {{ kv('clinic_name') }}, we wish you a wonderful day!" },
    ],
  },
  {
    id: "inactive-patient-reactivation",
    name: "Inactive Patient Reactivation",
    description: "Reach out to patients who haven't visited in 6+ months",
    category: "Patients",
    triggerEvent: "inactive_patient_6months",
    triggerCron: "0 10 * * 1",
    actionMode: "immediate",
    actions: [
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, it's been a while since your last visit to {{ kv('clinic_name') }}. We'd love to see you again! Call {{ kv('clinic_phone') }} to schedule." },
      { type: "pause", duration: "P14D" },
      { type: "condition", field: "email", operator: "is_not_empty" },
      { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "We miss you at {{ kv('clinic_name') }}!", body: "Hi {{ taskrun.value.patientName }},\n\nIt's been {{ taskrun.value.daysSinceVisit }} days since your last visit. Regular checkups are important for your dental health.\n\nCall {{ kv('clinic_phone') }} to schedule.\n\nBest,\n{{ kv('clinic_name') }}" },
    ],
  },

  // ── Reviews ───────────────────────────────────────────────────
  {
    id: "review-request",
    name: "Post-Visit Review Request",
    description: "Ask patients for a review 2 hours after completing a high-value treatment",
    category: "Reviews",
    triggerEvent: "high_value_treatment_completed",
    triggerCron: "0 17 * * *",
    actionMode: "immediate",
    actions: [
      { type: "pause", duration: "PT2H" },
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, thank you for choosing {{ kv('clinic_name') }}! If you had a great experience, we'd appreciate a review. It helps other patients find us!" },
    ],
  },
  {
    id: "review-request-multi",
    name: "Review Request (SMS + Email Follow-Up)",
    description: "SMS review request after visit → wait 3 days → email reminder if no review posted",
    category: "Reviews",
    triggerEvent: "high_value_treatment_completed",
    triggerCron: "0 17 * * *",
    actionMode: "immediate",
    actions: [
      { type: "pause", duration: "PT2H" },
      { type: "sms", to: "{{ taskrun.value.phone }}", message: "Hi {{ taskrun.value.patientName }}, thank you for visiting {{ kv('clinic_name') }}! We'd love to hear about your experience. A quick review helps others find great dental care!" },
      { type: "pause", duration: "P3D" },
      { type: "condition", field: "email", operator: "is_not_empty" },
      { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "How was your visit to {{ kv('clinic_name') }}?", body: "Hi {{ taskrun.value.patientName }},\n\nWe hope you're doing well after your recent visit. If you have a moment, we'd really appreciate a review — it helps other patients find quality dental care.\n\nThank you!\n{{ kv('clinic_name') }}" },
    ],
  },
];

export const TEMPLATE_CATEGORIES = ["Recalls", "Appointments", "Claims", "Patients", "Reviews"] as const;

export function getTemplatesByCategory(): Record<string, WorkflowTemplate[]> {
  const grouped: Record<string, WorkflowTemplate[]> = {};
  for (const t of WORKFLOW_TEMPLATES) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }
  return grouped;
}
