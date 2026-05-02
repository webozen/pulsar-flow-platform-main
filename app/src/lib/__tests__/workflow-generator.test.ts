/**
 * Unit tests for generateKestraYaml (workflow-generator.ts).
 *
 * The generator is pure (no I/O) so no mocks are needed — we call it
 * directly and assert on substrings of the returned YAML strings.
 */
import { describe, it, expect } from "vitest";
import { generateKestraYaml } from "../workflow-generator";
import type { WorkflowDef } from "../workflow-generator";

// ---------------------------------------------------------------------------
// Shared minimal workflow definition factory
// ---------------------------------------------------------------------------

function baseDef(overrides: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    id: "wf-001",
    name: "Test Workflow",
    namespace: "dental.test",
    triggerSql: "SELECT * FROM appointments",
    actions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SMS action
// ---------------------------------------------------------------------------

describe("SMS action", () => {
  const def = baseDef({
    triggerType: "schedule",
    triggerCron: "0 9 * * *",
    actions: [
      {
        type: "sms",
        to: "{{ inputs.record.phone }}",
        message: "Hello, your appointment is tomorrow.",
      },
    ],
  });

  it("contains Twilio Messages URL", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("https://api.twilio.com/2010-04-01/Accounts/{{ kv('twilio_sid') }}/Messages.json");
  });

  it("contains To= with the phone field", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("To={{ inputs.record.phone }}");
  });

  it("contains From={{ kv('twilio_from_number') }}", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("From={{ kv('twilio_from_number') }}");
  });

  it("contains Body= with the message text", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("Body=Hello, your appointment is tomorrow.");
  });

  it("uses io.kestra.plugin.core.http.Request type", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("type: io.kestra.plugin.core.http.Request");
  });
});

// ---------------------------------------------------------------------------
// SMS action — quote escaping (apostrophe in body must not break YAML)
// ---------------------------------------------------------------------------

describe("SMS action — apostrophe in body", () => {
  const def = baseDef({
    actions: [
      {
        type: "sms",
        to: "{{ inputs.record.phone }}",
        message: "it's great",
      },
    ],
  });

  it("YAML is returned without throwing", () => {
    expect(() => generateKestraYaml(def)).not.toThrow();
  });

  it("message text appears in the body field", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("it's great");
  });

  it("double-quoted YAML string is not broken by the apostrophe", () => {
    const yaml = generateKestraYaml(def);
    // The body line should remain on a single YAML line wrapped in double quotes.
    // A structural break would look like an unmatched " opening the body value.
    // We check that the body line contains Body= followed by the apostrophe text
    // and that the closing quote is still present on the same line.
    const bodyLine = yaml
      .split("\n")
      .find((l) => l.includes("Body=it"));
    expect(bodyLine).toBeDefined();
    // The line must start and end with a double-quote (YAML scalar delimiter)
    // — i.e., body: "To=...&Body=it's great"
    expect(bodyLine).toMatch(/body:\s*".*it's great.*"/);
  });
});

// ---------------------------------------------------------------------------
// Email action
// ---------------------------------------------------------------------------

describe("Email action", () => {
  const def = baseDef({
    actions: [
      {
        type: "email",
        emailTo: "{{ inputs.record.email }}",
        subject: "Appointment Reminder",
        body: "<p>Please confirm your appointment.</p>",
      },
    ],
  });

  it("contains Resend API URL", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("https://api.resend.com/emails");
  });

  it("contains the subject", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("Appointment Reminder");
  });

  it("body contains correct JSON structure with from/to/subject/html keys", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain('"from"');
    expect(yaml).toContain('"to"');
    expect(yaml).toContain('"subject"');
    expect(yaml).toContain('"html"');
  });

  it("uses POST method", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("method: POST");
  });

  it("Authorization header uses email_api_key KV", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("kv('email_api_key')");
  });
});

// ---------------------------------------------------------------------------
// Approval action
// ---------------------------------------------------------------------------

describe("Approval action", () => {
  const def = baseDef({
    actionMode: "on_approval",
    actions: [
      {
        type: "approval",
      },
    ],
  });

  it("contains io.kestra.plugin.core.flow.Pause task type", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("type: io.kestra.plugin.core.flow.Pause");
  });

  it("approval Pause task has NO duration (infinite wait for staff)", () => {
    const yaml = generateKestraYaml(def);
    // The step_0_approval Pause block must not have a `delay:` line
    const lines = yaml.split("\n");
    const approvalIdx = lines.findIndex((l) => l.includes("step_0_approval"));
    expect(approvalIdx).toBeGreaterThan(-1);
    // Look at the next few lines — none should be `delay:`
    const snippet = lines.slice(approvalIdx, approvalIdx + 5).join("\n");
    expect(snippet).not.toContain("delay:");
  });
});

// ---------------------------------------------------------------------------
// Condition action
// ---------------------------------------------------------------------------

describe("Condition action", () => {
  const def = baseDef({
    actions: [
      {
        type: "condition",
        field: "status",
        operator: "equals",
        value: "active",
      },
    ],
  });

  it("contains io.kestra.plugin.core.flow.If task type", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("type: io.kestra.plugin.core.flow.If");
  });

  it("contains the condition expression with the field and value", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("inputs.record.status");
    expect(yaml).toContain("active");
  });

  it("condition uses is_not_empty operator correctly", () => {
    const def2 = baseDef({
      actions: [
        { type: "condition", field: "email", operator: "is_not_empty" },
      ],
    });
    const yaml = generateKestraYaml(def2);
    expect(yaml).toContain("inputs.record.email is defined");
    expect(yaml).toContain("inputs.record.email != ''");
  });

  it("condition uses is_empty operator correctly", () => {
    const def3 = baseDef({
      actions: [
        { type: "condition", field: "phone", operator: "is_empty" },
      ],
    });
    const yaml = generateKestraYaml(def3);
    expect(yaml).toContain("inputs.record.phone is not defined");
  });

  it("condition uses contains operator correctly", () => {
    const def4 = baseDef({
      actions: [
        { type: "condition", field: "notes", operator: "contains", value: "urgent" },
      ],
    });
    const yaml = generateKestraYaml(def4);
    expect(yaml).toContain("'urgent' in inputs.record.notes");
  });
});

// ---------------------------------------------------------------------------
// Webhook action
// ---------------------------------------------------------------------------

describe("Webhook action", () => {
  const def = baseDef({
    actions: [
      {
        type: "webhook",
        url: "https://hooks.example.com/notify",
        method: "POST",
        webhookBody: '{"event":"appointment_reminder"}',
      },
    ],
  });

  it("contains the user-supplied URL", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain("https://hooks.example.com/notify");
  });

  it("uses the user-supplied HTTP method", () => {
    const yaml = generateKestraYaml(def);
    // method: POST should appear in the webhook task
    expect(yaml).toContain("method: POST");
  });

  it("contains the webhook body", () => {
    const yaml = generateKestraYaml(def);
    expect(yaml).toContain('"event":"appointment_reminder"');
  });

  it("defaults to POST when no method is given", () => {
    const def2 = baseDef({
      actions: [{ type: "webhook", url: "https://hooks.example.com/ping" }],
    });
    const yaml = generateKestraYaml(def2);
    expect(yaml).toContain("method: POST");
  });
});

// ---------------------------------------------------------------------------
// Worker YAML with two sequential actions
// ---------------------------------------------------------------------------

describe("Worker YAML — two sequential actions", () => {
  const def = baseDef({
    actions: [
      { type: "sms", to: "{{ inputs.record.phone }}", message: "First message" },
      { type: "email", emailTo: "{{ inputs.record.email }}", subject: "Follow-up" },
    ],
  });

  it("both task ids appear in the worker YAML", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("step_0_sms");
    expect(worker).toContain("step_1_email");
  });

  it("step_0 appears before step_1 in the output", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker.indexOf("step_0_sms")).toBeLessThan(worker.indexOf("step_1_email"));
  });

  it("both tasks are wrapped in a Sequential container", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("type: io.kestra.plugin.core.flow.Sequential");
  });
});

// ---------------------------------------------------------------------------
// Parent YAML — scheduled trigger
// ---------------------------------------------------------------------------

describe("Parent YAML — scheduled trigger", () => {
  const def = baseDef({
    triggerType: "schedule",
    triggerCron: "0 8 * * 1-5",
    actions: [{ type: "sms", message: "Reminder" }],
  });

  it("contains io.kestra.plugin.core.trigger.Schedule", () => {
    const { parent } = generateKestraYaml(def, { pair: true });
    expect(parent).toContain("type: io.kestra.plugin.core.trigger.Schedule");
  });

  it("contains the cron expression", () => {
    const { parent } = generateKestraYaml(def, { pair: true });
    expect(parent).toContain('cron: "0 8 * * 1-5"');
  });

  it("parent flow id is the slugified workflow name (no -run suffix)", () => {
    const { parent } = generateKestraYaml(def, { pair: true });
    expect(parent).toContain("id: test-workflow\n");
  });

  it("parent references the worker subflow with -run suffix", () => {
    const { parent } = generateKestraYaml(def, { pair: true });
    expect(parent).toContain("flowId: test-workflow-run");
  });
});

// ---------------------------------------------------------------------------
// Manual mode — generateParentYaml returns null
// ---------------------------------------------------------------------------

describe("Manual mode (no trigger)", () => {
  const def = baseDef({
    triggerType: "manual",
    actions: [{ type: "sms", message: "Hello" }],
  });

  it("pair.parent is null for manual mode", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(result.parent).toBeNull();
  });

  it("pair.worker is still generated", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(result.worker).toBeTruthy();
    expect(result.worker).toContain("id: test-workflow-run");
  });

  it("default (non-pair) call returns only the worker YAML string", () => {
    const yaml = generateKestraYaml(def);
    expect(typeof yaml).toBe("string");
    // Should not contain parent trigger section
    expect(yaml).not.toContain("type: io.kestra.plugin.core.trigger.Schedule");
  });
});

// ---------------------------------------------------------------------------
// pair: true mode — returns { parent, worker }
// ---------------------------------------------------------------------------

describe("pair: true mode", () => {
  const def = baseDef({
    triggerType: "schedule",
    triggerCron: "0 9 * * *",
    actions: [{ type: "sms", message: "Hi" }],
  });

  it("returns an object (not a string)", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });

  it("returned object has both parent and worker keys", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(result).toHaveProperty("parent");
    expect(result).toHaveProperty("worker");
  });

  it("parent is a non-empty string for scheduled trigger", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(typeof result.parent).toBe("string");
    expect(result.parent!.length).toBeGreaterThan(0);
  });

  it("worker is a non-empty string", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(typeof result.worker).toBe("string");
    expect(result.worker.length).toBeGreaterThan(0);
  });

  it("worker flow id has -run suffix", () => {
    const result = generateKestraYaml(def, { pair: true });
    expect(result.worker).toContain("id: test-workflow-run");
  });
});

// ---------------------------------------------------------------------------
// Worker YAML — structural checks
// ---------------------------------------------------------------------------

describe("Worker YAML — structure", () => {
  const def = baseDef({
    actions: [{ type: "sms", message: "Hi" }],
  });

  it("includes namespace", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("namespace: dental.test");
  });

  it("includes a record input of type JSON", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("- id: record");
    expect(worker).toContain("type: JSON");
  });

  it("includes a concurrency block", () => {
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("concurrency:");
    expect(worker).toContain("behavior: QUEUE");
  });
});

// ---------------------------------------------------------------------------
// Legacy taskrun.value upgrade
// ---------------------------------------------------------------------------

describe("Legacy taskrun.value reference upgrade", () => {
  it("upgrades {{ taskrun.value.X }} to {{ inputs.record.X }} in SMS fields", () => {
    const def = baseDef({
      actions: [
        {
          type: "sms",
          to: "{{ taskrun.value.phone }}",
          message: "Hi {{ taskrun.value.name }}",
        },
      ],
    });
    // Check the worker YAML only (parent ForEach legitimately uses
    // `{{ fromJson(taskrun.value) }}` which is a different pattern
    // and must NOT be rewritten).
    const { worker } = generateKestraYaml(def, { pair: true });
    expect(worker).toContain("inputs.record.phone");
    expect(worker).toContain("inputs.record.name");
    // The worker must not contain any old taskrun.value.X dotted references
    expect(worker).not.toMatch(/taskrun\.value\.\w+/);
  });

  it("parent ForEach legitimately keeps fromJson(taskrun.value) intact", () => {
    const def = baseDef({
      triggerType: "schedule",
      triggerCron: "0 9 * * *",
      actions: [{ type: "sms", message: "Hi" }],
    });
    const { parent } = generateKestraYaml(def, { pair: true });
    // This is intentional Kestra syntax — must not be touched
    expect(parent).toContain("fromJson(taskrun.value)");
  });
});
