/**
 * Generates Kestra YAML from a workflow definition.
 *
 * Architecture: every workflow compiles to a parent + worker subflow pair.
 *
 *   parent  {flowId}       — trigger (schedule/webhook), query, ForEach,
 *                            triggers {flowId}-run per row with typed input
 *   worker  {flowId}-run   — inputs.record: JSON, optional Pause for approval,
 *                            action tasks using {{ inputs.record.field }}
 *
 * Why: Kestra's `taskrun.value` is always a string inside ForEach, so an
 * inline-actions approach forces ugly `fromJson(taskrun.value).field` in
 * every template. Subflow-per-row passes the record as a typed input,
 * giving clean `inputs.record.field` templates. Side benefits:
 *   - per-row execution history (one-click retry/replay for "patient 42")
 *   - per-worker concurrency throttle via child flow concurrency.limit
 *   - approval/immediate/manual modes collapse to one code path
 *
 * Manual mode has no parent — the worker is triggered directly with a record input.
 */

export interface WorkflowAction {
  type: string;
  label?: string;
  retryEnabled?: boolean;
  parallel?: boolean;
  to?: string;
  message?: string;
  emailTo?: string;
  subject?: string;
  body?: string;
  url?: string;
  method?: string;
  webhookBody?: string;
  duration?: string;
  field?: string;
  operator?: string;
  value?: string;
  patNum?: string;
  note?: string;
  aptNum?: string;
  status?: string;
  lookupPhoneField?: string;
  voicePatientNameField?: string;
  voiceAptDateField?: string;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  triggerType?: string;
  triggerCron?: string;
  triggerSql: string;
  actionMode?: string;
  actions: WorkflowAction[];
  namespace: string;
  taskTitle?: string;
  taskPriority?: string;
  taskAssignedTo?: string;
  queueName?: string;
  concurrencyLimit?: number;
  timeoutDuration?: string;
  errorNotificationEmail?: string;
  dedupEnabled?: boolean;
  dedupField?: string;
  dedupWindowDays?: number;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Default per-flow concurrency cap (noisy-neighbor defense).
 *
 * Kestra OSS does NOT support per-namespace concurrency caps — the only
 * mechanism available is flow-level `concurrency.limit`. Every generated
 * flow therefore gets this block so a single tenant's single flow can't
 * monopolize executor threads. `behavior: QUEUE` makes excess runs wait
 * rather than fail (safer than CANCEL/FAIL for scheduled workflows).
 *
 * Tunable per-deployment via KESTRA_FLOW_CONCURRENCY_LIMIT.
 */
const DEFAULT_FLOW_CONCURRENCY_LIMIT = (() => {
  const raw = process.env.KESTRA_FLOW_CONCURRENCY_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

function concurrencyBlock(limit: number): string {
  return `\nconcurrency:\n  limit: ${limit}\n  behavior: QUEUE\n`;
}

function retryBlock(enabled?: boolean): string {
  if (!enabled) return "";
  return `
        retry:
          type: constant
          maxAttempt: 3
          interval: PT30S`;
}

/**
 * Render one action as a YAML task. Templates use `{{ inputs.record.X }}`
 * because actions run inside the worker subflow where `inputs.record` is
 * a typed JSON input (no fromJson parsing needed).
 */
function actionToYaml(action: WorkflowAction, index: number): string {
  const id = `step_${index}`;
  const retry = retryBlock(action.retryEnabled);
  // Upgrade legacy `{{ taskrun.value.X }}` references in user-authored
  // fields to the new `{{ inputs.record.X }}` convention. This keeps old
  // workflow rows working after the refactor.
  const upgrade = (s: string | undefined): string =>
    (s || "").replace(/\{\{\s*taskrun\.value\.(\w+)\s*\}\}/g, "{{ inputs.record.$1 }}");

  switch (action.type) {
    case "sms":
      return `      - id: ${id}_sms
        type: io.kestra.plugin.core.http.Request
        uri: "https://api.twilio.com/2010-04-01/Accounts/{{ kv('twilio_sid') }}/Messages.json"
        method: POST
        headers:
          Content-Type: application/x-www-form-urlencoded
          Authorization: "Basic {{ kv('twilio_basic_auth') }}"
        body: "To=${upgrade(action.to) || "{{ inputs.record.phone }}"}&From={{ kv('twilio_from_number') }}&Body=${upgrade(action.message).replace(/"/g, '\\"')}"${retry}`;

    case "email":
      return `      - id: ${id}_email
        type: io.kestra.plugin.core.http.Request
        uri: "https://api.resend.com/emails"
        method: POST
        headers:
          Content-Type: application/json
          Authorization: "Bearer {{ kv('email_api_key') }}"
        body: |
          {"from":"{{ kv('email_from') }}","to":["${upgrade(action.emailTo) || "{{ inputs.record.email }}"}"],"subject":"${upgrade(action.subject).replace(/"/g, '\\"')}","html":"${upgrade(action.body).replace(/"/g, '\\"').replace(/\n/g, "\\n")}"}${retry}`;

    case "webhook":
      return `      - id: ${id}_webhook
        type: io.kestra.plugin.core.http.Request
        uri: "${upgrade(action.url)}"
        method: ${action.method || "POST"}
        headers:
          Content-Type: application/json
        body: |
          ${upgrade(action.webhookBody) || "{}"}${retry}`;

    case "pause":
      return `      - id: ${id}_pause
        type: io.kestra.plugin.core.flow.Pause
        delay: ${action.duration || "P1D"}`;

    case "approval":
      return `      - id: ${id}_approval
        type: io.kestra.plugin.core.flow.Pause`;

    case "condition": {
      let condition = "";
      switch (action.operator) {
        case "is_not_empty":
          condition = `{{ inputs.record.${action.field} is defined and inputs.record.${action.field} != '' and inputs.record.${action.field} != null }}`;
          break;
        case "is_empty":
          condition = `{{ inputs.record.${action.field} is not defined or inputs.record.${action.field} == '' or inputs.record.${action.field} == null }}`;
          break;
        case "equals":
          condition = `{{ inputs.record.${action.field} == '${action.value}' }}`;
          break;
        case "contains":
          condition = `{{ inputs.record.${action.field} is defined and '${action.value}' in inputs.record.${action.field} }}`;
          break;
        default:
          condition = `{{ inputs.record.${action.field} is defined }}`;
      }
      return `      - id: ${id}_condition
        type: io.kestra.plugin.core.flow.If
        condition: "${condition}"
        then:
          - id: ${id}_condition_log
            type: io.kestra.plugin.core.log.Log
            message: "Condition met for ${action.field}"`;
    }

    case "ai_generate":
      return `      - id: ${id}_ai
        type: io.kestra.plugin.core.http.Request
        uri: "{{ kv('ai_api_url', 'https://api.openai.com/v1/chat/completions') }}"
        method: POST
        headers:
          Content-Type: application/json
          Authorization: "Bearer {{ kv('ai_api_key') }}"
        body: |
          {"model":"{{ kv('ai_model', 'gpt-4o-mini') }}","messages":[{"role":"user","content":"${upgrade(action.message).replace(/"/g, '\\"')}"}],"max_tokens":500}${retry}`;

    case "create_commlog":
      return `      - id: ${id}_commlog
        type: io.kestra.plugin.core.http.Request
        uri: "https://api.opendental.com/api/v1/commlogs"
        method: POST
        headers:
          Content-Type: application/json
          Authorization: "ODFHIR {{ kv('opendental_developer_key') }}/{{ kv('opendental_customer_key') }}"
        body: |
          {"PatNum":${upgrade(action.patNum) || "{{ inputs.record.patNum }}"},"Note":"${upgrade(action.note).replace(/"/g, '\\"')}"}${retry}`;

    case "update_appointment_status":
      return `      - id: ${id}_apt_update
        type: io.kestra.plugin.core.http.Request
        uri: "https://api.opendental.com/api/v1/appointments/${upgrade(action.aptNum) || "{{ inputs.record.aptNum }}"}"
        method: PUT
        headers:
          Content-Type: application/json
          Authorization: "ODFHIR {{ kv('opendental_developer_key') }}/{{ kv('opendental_customer_key') }}"
        body: |
          {"Confirmed":"${action.status || "confirmed"}"}${retry}`;

    case "lookup": {
      const phoneField = action.lookupPhoneField || "phone";
      return `      - id: ${id}_lookup
        type: io.kestra.plugin.core.http.Request
        uri: "https://lookups.twilio.com/v2/PhoneNumbers/{{ inputs.record.${phoneField} | urlencode }}?Fields=line_type_intelligence"
        method: GET
        headers:
          Authorization: "Basic {{ kv('twilio_basic_auth') }}"${retry}`;
    }

    case "voice_call": {
      const patientName = action.voicePatientNameField
        ? `{{ inputs.record.${action.voicePatientNameField} | urlencode }}`
        : "";
      const aptDate = action.voiceAptDateField
        ? `{{ inputs.record.${action.voiceAptDateField} | urlencode }}`
        : "your+upcoming+appointment";
      return `      - id: ${id}_voice
        type: io.kestra.plugin.core.http.Request
        uri: "https://api.twilio.com/2010-04-01/Accounts/{{ kv('twilio_sid') }}/Calls.json"
        method: POST
        headers:
          Content-Type: application/x-www-form-urlencoded
          Authorization: "Basic {{ kv('twilio_basic_auth') }}"
        body: "To=${upgrade(action.to) || "{{ inputs.record.phone }}"}&From={{ kv('twilio_from_number') }}&Url={{ kv('app_url') }}/api/twilio/voice/twiml?clinicName={{ kv('clinic_name') | urlencode }}&patientName=${patientName}&aptDate=${aptDate}&Method=GET&StatusCallback={{ kv('app_url') }}/api/twilio/voice/status&StatusCallbackEvent=completed"${retry}`;
    }

    default:
      return "";
  }
}

function renderActionsBlock(actions: WorkflowAction[]): string {
  const parallelActions = actions.filter((a) => a.parallel);
  const sequentialActions = actions.filter((a) => !a.parallel);

  let actionLines = sequentialActions
    .map((a, i) => actionToYaml(a, i))
    .filter(Boolean)
    .join("\n\n");

  if (parallelActions.length > 0) {
    const parallelTasks = parallelActions
      .map((a, i) => actionToYaml(a, sequentialActions.length + i))
      .filter(Boolean)
      .join("\n\n");
    actionLines = `      - id: parallel_group
        type: io.kestra.plugin.core.flow.Parallel
        tasks:
${parallelTasks}

${actionLines}`;
  }

  return actionLines;
}

/**
 * Generate the WORKER flow — runs the actions for a single record.
 * `{flowId}-run` — inputs.record: JSON.
 * Approval mode: first task is a Pause that staff resume/reject.
 */
function generateWorkerYaml(def: WorkflowDef): string {
  const flowId = slugify(def.name);
  const actionLines = renderActionsBlock(def.actions);
  const hasActions = actionLines.trim().length > 0;

  const labels: string[] = [
    `  source-workflow-id: "${def.id}"`,
    `  worker: "true"`,
  ];
  if (def.actionMode) labels.push(`  action-mode: "${def.actionMode}"`);
  // approval-queue-card: paused workers of this flow surface as cards
  // in the approval queue UI. The /api/approvals route filters on this
  // label exactly, so any workflow that pauses for staff review just
  // works — no code change required to add new approval flows.
  if (def.actionMode === "on_approval") labels.push(`  approval-queue-card: "true"`);
  if (def.taskPriority) labels.push(`  task-priority: "${def.taskPriority}"`);
  if (def.taskAssignedTo) labels.push(`  task-assigned-to: "${def.taskAssignedTo}"`);
  if (def.taskTitle) labels.push(`  task-title: "${def.taskTitle}"`);
  if (def.queueName) labels.push(`  queue-name: "${def.queueName}"`);

  // Per-worker concurrency applies to in-flight actions per row (one child
  // execution per row, so limit = max concurrent records being processed).
  // ALWAYS emit a concurrency block — this is the primary noisy-neighbor
  // defense, because Kestra OSS has no per-namespace cap. User-supplied
  // concurrencyLimit overrides the deployment default.
  const workerConcurrency =
    def.concurrencyLimit && def.concurrencyLimit > 0
      ? def.concurrencyLimit
      : DEFAULT_FLOW_CONCURRENCY_LIMIT;
  const concurrencySection = concurrencyBlock(workerConcurrency);

  const timeoutProp = def.timeoutDuration ? `  timeout: ${def.timeoutDuration}\n` : "";

  const errorSection = def.errorNotificationEmail
    ? `
errors:
  - id: error_notification
    type: io.kestra.plugin.core.http.Request
    uri: "https://api.resend.com/emails"
    method: POST
    headers:
      Content-Type: application/json
      Authorization: "Bearer {{ kv('email_api_key') }}"
    body: |
      {"from":"{{ kv('email_from') }}","to":["${def.errorNotificationEmail}"],"subject":"WORKFLOW FAILED: ${def.name}","html":"Record {{ inputs.record }} failed. Execution {{ execution.id }}."}
`
    : "";

  // The Pause task id is `approval_gate` — matches the contract the
  // /api/approvals route + ChildCard polling expect (gate.taskId).
  const approvalGate =
    def.actionMode === "on_approval"
      ? `  - id: approval_gate
    type: io.kestra.plugin.core.flow.Pause

`
      : "";

  const runBlock = hasActions
    ? `  - id: execute_actions
    type: io.kestra.plugin.core.flow.Sequential
    tasks:
${actionLines}`
    : `  - id: log_no_actions
    type: io.kestra.plugin.core.log.Log
    message: "Record processed (no actions configured): {{ inputs.record }}"`;

  return `id: ${flowId}-run
namespace: ${def.namespace}
description: "Worker: ${(def.description || def.name).replace(/"/g, '\\"')}"
${timeoutProp}
labels:
${labels.join("\n")}
${concurrencySection}${errorSection}
inputs:
  - id: record
    type: JSON
    description: "Single record to process"

tasks:
${approvalGate}${runBlock}
`;
}

/**
 * Generate the PARENT flow — trigger, query, and fan-out to the worker.
 * Returns null for manual mode (no parent; worker is triggered directly).
 */
function generateParentYaml(def: WorkflowDef): string | null {
  if (def.triggerType === "manual") return null;

  const flowId = slugify(def.name);

  const labels: string[] = [`  source-workflow-id: "${def.id}"`];
  if (def.actionMode) labels.push(`  action-mode: "${def.actionMode}"`);
  if (def.queueName) labels.push(`  queue-name: "${def.queueName}"`);

  // Dedup metadata lives on the parent — it identifies a batch run.
  const dedupField = def.dedupField || "patNum";
  const dedupDays = def.dedupWindowDays || 7;
  const dedupEnabled = def.dedupEnabled !== false;
  const dedupLabels = dedupEnabled
    ? `\n  entity-dedup-field: "${dedupField}"\n  dedup-window-days: "${dedupDays}"`
    : "";

  let triggerSection = "";
  if (def.triggerType === "webhook") {
    triggerSection = `
triggers:
  - id: webhook
    type: io.kestra.plugin.core.trigger.Webhook
    key: "${flowId}"
`;
  } else if (def.triggerCron) {
    triggerSection = `
triggers:
  - id: schedule
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "${def.triggerCron}"
    timezone: "America/New_York"
`;
  }

  const queryTask = `  - id: query_data_source
    type: io.kestra.plugin.core.http.Request
    uri: "https://api.opendental.com/api/v1/queries/ShortQuery"
    method: PUT
    headers:
      Content-Type: application/json
      Authorization: "ODFHIR {{ kv('opendental_developer_key') }}/{{ kv('opendental_customer_key') }}"
    body: |
      {"SqlCommand": "${def.triggerSql.replace(/"/g, '\\"').replace(/\n/g, " ")}"}`;

  // ForEach iterates parsed rows; each iteration triggers the worker subflow
  // with the row as a typed JSON input. `wait: false` — parent finishes fast,
  // workers run independently (clean per-row execution history).
  const fanOut = `  - id: process_results
    type: io.kestra.plugin.core.flow.If
    condition: "{{ fromJson(outputs.query_data_source.body) | length > 0 }}"
    then:
      - id: for_each_record
        type: io.kestra.plugin.core.flow.ForEach
        values: "{{ fromJson(outputs.query_data_source.body) }}"
        tasks:
          - id: trigger_worker
            type: io.kestra.plugin.core.flow.Subflow
            namespace: ${def.namespace}
            flowId: ${flowId}-run
            wait: false
            inputs:
              record: "{{ fromJson(taskrun.value) }}"
            labels:
              parent-execution: "{{ execution.id }}"`;

  // Parent flow also gets a concurrency cap so a mis-configured schedule or
  // a flood of webhook triggers can't spawn unbounded fan-out executions.
  // QUEUE behavior — excess runs wait, no data is silently dropped.
  const parentConcurrency = concurrencyBlock(DEFAULT_FLOW_CONCURRENCY_LIMIT);

  return `id: ${flowId}
namespace: ${def.namespace}
description: "${(def.description || def.name).replace(/"/g, '\\"')}"

labels:
${labels.join("\n")}${dedupLabels}
${parentConcurrency}${triggerSection}
tasks:
${queryTask}

${fanOut}
`;
}

/**
 * Compile a workflow definition into the Kestra YAML flows to deploy.
 *
 * Returns `{ parent, worker }`. The parent is null for manual-mode workflows
 * (only the worker flow exists; external callers trigger it with a record).
 *
 * Callers should deploy both flows (worker first, then parent) so that the
 * parent's Subflow reference is valid at deploy time.
 */
export function generateKestraYaml(def: WorkflowDef): string;
export function generateKestraYaml(
  def: WorkflowDef,
  opts: { pair: true }
): { parent: string | null; worker: string };
export function generateKestraYaml(
  def: WorkflowDef,
  opts?: { pair?: boolean }
): string | { parent: string | null; worker: string } {
  const worker = generateWorkerYaml(def);
  const parent = generateParentYaml(def);
  if (opts?.pair) return { parent, worker };
  // Default: return the "primary" flow as a single string. For manual mode
  // that's the worker; for scheduled/webhook that's the parent. The test
  // suite and older callers check substrings like "trigger" or "Pause", so
  // combining parent + worker keeps both visible.
  return [parent, worker].filter(Boolean).join("\n---\n");
}

/**
 * Back-compat shim: old callers got the review subflow separately.
 * The new generator always pairs parent+worker, so the worker IS the
 * review subflow in approval mode. This wrapper exposes it for callers
 * that still expect the two-file split.
 */
export function generateApprovalSubflowYaml(def: WorkflowDef): string | null {
  if (def.actionMode !== "on_approval") return null;
  return generateWorkerYaml(def);
}
