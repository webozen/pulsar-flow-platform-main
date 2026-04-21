import { describe, it, expect } from "vitest";
import { generateKestraYaml } from "./workflow-generator";

describe("workflow-generator", () => {
  const baseDef = {
    id: "test-123",
    name: "Test Workflow",
    description: "A test workflow",
    triggerCron: "0 9 * * *",
    triggerSql: "SELECT PatNum AS patNum FROM patient WHERE PatStatus = 0",
    actions: [],
    namespace: "dental.test-clinic",
  };

  it("generates valid YAML with correct id and namespace", () => {
    const yaml = generateKestraYaml(baseDef);
    expect(yaml).toContain("id: test-workflow");
    expect(yaml).toContain("namespace: dental.test-clinic");
  });

  it("includes schedule trigger with cron", () => {
    const yaml = generateKestraYaml(baseDef);
    expect(yaml).toContain("cron: \"0 9 * * *\"");
    expect(yaml).toContain("io.kestra.plugin.core.trigger.Schedule");
  });

  it("includes Open Dental API query task", () => {
    const yaml = generateKestraYaml(baseDef);
    expect(yaml).toContain("/queries/ShortQuery");
    expect(yaml).toContain("SELECT PatNum AS patNum FROM patient");
  });

  it("omits trigger for manual mode", () => {
    const yaml = generateKestraYaml({ ...baseDef, triggerType: "manual", triggerCron: undefined });
    expect(yaml).not.toContain("triggers:");
    expect(yaml).not.toContain("Schedule");
  });

  it("generates SMS action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "sms", to: "{{ taskrun.value.phone }}", message: "Hello {{taskrun.value.patientName}}" }],
    });
    expect(yaml).toContain("twilio.com");
    // Legacy taskrun.value.X references are upgraded to inputs.record.X
    // so the emitted worker flow uses the typed JSON input.
    expect(yaml).toContain("{{ inputs.record.phone }}");
    expect(yaml).toContain("{{ inputs.record.patientName }}");
  });

  it("generates email action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "email", emailTo: "{{ taskrun.value.email }}", subject: "Reminder", body: "Hi there" }],
    });
    expect(yaml).toContain("email");
    expect(yaml).toContain("Reminder");
  });

  it("generates pause action with duration", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "pause", duration: "P3D" }],
    });
    expect(yaml).toContain("io.kestra.plugin.core.flow.Pause");
    expect(yaml).toContain("delay: P3D");
  });

  it("generates approval gate (pause without duration)", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "approval" }],
    });
    expect(yaml).toContain("io.kestra.plugin.core.flow.Pause");
    expect(yaml).not.toContain("delay:");
  });

  it("generates condition with If task", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "condition", field: "email", operator: "is_not_empty" }],
    });
    expect(yaml).toContain("io.kestra.plugin.core.flow.If");
    expect(yaml).toContain("inputs.record.email");
  });

  it("generates webhook action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "webhook", url: "https://hooks.example.com/test", method: "POST" }],
    });
    expect(yaml).toContain("https://hooks.example.com/test");
    expect(yaml).toContain("method: POST");
  });

  it("generates AI action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "ai_generate", message: "Draft a reminder for {{taskrun.value.patientName}}" }],
    });
    expect(yaml).toContain("chat/completions");
    expect(yaml).toContain("Draft a reminder");
  });

  it("adds retry block when enabled", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "sms", message: "test", retryEnabled: true }],
    });
    expect(yaml).toContain("retry:");
    expect(yaml).toContain("maxAttempt: 3");
  });

  it("generates subflow pattern for on_approval mode", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actionMode: "on_approval",
      actions: [{ type: "sms", message: "approved action" }],
    });
    // Parent fans out to {flowId}-run via a Subflow; worker has the Pause gate.
    expect(yaml).toContain("trigger_worker");
    expect(yaml).toContain("io.kestra.plugin.core.flow.Subflow");
    expect(yaml).toContain("await_approval");
  });

  it("always emits parent + worker pair for scheduled workflows", () => {
    const { parent, worker } = generateKestraYaml(
      { ...baseDef, actions: [{ type: "sms", message: "hi" }] },
      { pair: true }
    );
    expect(parent).toContain("id: test-workflow");
    expect(parent).toContain("for_each_record");
    expect(parent).toContain("flowId: test-workflow-run");
    expect(worker).toContain("id: test-workflow-run");
    expect(worker).toContain("inputs.record.phone");
  });

  it("manual mode emits worker only (no parent)", () => {
    const { parent, worker } = generateKestraYaml(
      { ...baseDef, triggerType: "manual", triggerCron: undefined, actions: [{ type: "sms", message: "hi" }] },
      { pair: true }
    );
    expect(parent).toBeNull();
    expect(worker).toContain("id: test-workflow-run");
  });

  it("includes labels for task metadata", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actionMode: "on_approval",
      taskPriority: "HIGH",
      taskAssignedTo: "billing-team",
      actions: [],
    });
    expect(yaml).toContain('action-mode: "on_approval"');
    expect(yaml).toContain('task-priority: "HIGH"');
    expect(yaml).toContain('task-assigned-to: "billing-team"');
  });

  it("generates commlog action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "create_commlog", patNum: "{{ taskrun.value.patNum }}", note: "Called patient" }],
    });
    expect(yaml).toContain("/commlogs");
    expect(yaml).toContain("Called patient");
  });

  it("generates appointment status update action", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [{ type: "update_appointment_status", aptNum: "{{ taskrun.value.aptNum }}", status: "confirmed" }],
    });
    expect(yaml).toContain("/appointments/");
    expect(yaml).toContain("confirmed");
  });

  it("slugifies workflow name for flow ID", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      name: "Overdue Recall Reminders!!",
    });
    expect(yaml).toContain("id: overdue-recall-reminders");
  });

  // Sprint A tests
  it("adds concurrency limit", () => {
    const yaml = generateKestraYaml({ ...baseDef, concurrencyLimit: 5 });
    expect(yaml).toContain("concurrency:");
    expect(yaml).toContain("limit: 5");
  });

  it("adds timeout duration", () => {
    const yaml = generateKestraYaml({ ...baseDef, timeoutDuration: "PT1H" });
    expect(yaml).toContain("timeout: PT1H");
  });

  it("adds error notification handler", () => {
    const yaml = generateKestraYaml({ ...baseDef, errorNotificationEmail: "admin@clinic.com" });
    expect(yaml).toContain("errors:");
    expect(yaml).toContain("admin@clinic.com");
    expect(yaml).toContain("WORKFLOW FAILED");
  });

  it("generates webhook trigger", () => {
    const yaml = generateKestraYaml({ ...baseDef, triggerType: "webhook" });
    expect(yaml).toContain("io.kestra.plugin.core.trigger.Webhook");
    expect(yaml).not.toContain("Schedule");
  });

  it("wraps parallel actions in Parallel task", () => {
    const yaml = generateKestraYaml({
      ...baseDef,
      actions: [
        { type: "sms", message: "first", parallel: true },
        { type: "email", subject: "second", parallel: true },
        { type: "pause", duration: "P1D" },
      ],
    });
    expect(yaml).toContain("io.kestra.plugin.core.flow.Parallel");
  });

  it("includes dedup labels by default", () => {
    const yaml = generateKestraYaml(baseDef);
    expect(yaml).toContain("entity-dedup-field");
    expect(yaml).toContain("patNum");
  });

  it("omits dedup labels when disabled", () => {
    const yaml = generateKestraYaml({ ...baseDef, dedupEnabled: false });
    expect(yaml).not.toContain("entity-dedup-field");
  });

  // Noisy-neighbor defense: every generated flow must carry a concurrency
  // block with QUEUE behavior, even when the user doesn't set one. Kestra
  // OSS has no per-namespace cap, so this is the primary guardrail.
  it("injects default concurrency block with QUEUE behavior on all generated flows", () => {
    const { parent, worker } = generateKestraYaml(
      { ...baseDef, actions: [{ type: "sms", message: "hi" }] },
      { pair: true }
    );
    expect(worker).toContain("concurrency:");
    expect(worker).toContain("behavior: QUEUE");
    expect(parent).toContain("concurrency:");
    expect(parent).toContain("behavior: QUEUE");
  });

  it("user-supplied concurrencyLimit overrides the deployment default on the worker", () => {
    const { worker } = generateKestraYaml(
      { ...baseDef, concurrencyLimit: 42, actions: [{ type: "sms", message: "hi" }] },
      { pair: true }
    );
    expect(worker).toContain("limit: 42");
    expect(worker).toContain("behavior: QUEUE");
  });
});
