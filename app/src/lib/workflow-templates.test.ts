import { describe, it, expect } from "vitest";
import { WORKFLOW_TEMPLATES, TEMPLATE_CATEGORIES, getTemplatesByCategory } from "./workflow-templates";

describe("workflow-templates", () => {
  it("has 10+ templates", () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it("every template has required fields", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.triggerEvent).toBeTruthy();
      expect(t.triggerCron).toBeTruthy();
      expect(["immediate", "on_approval", "manual"]).toContain(t.actionMode);
      expect(t.actions.length).toBeGreaterThan(0);
    }
  });

  it("template IDs are unique", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every category is valid", () => {
    const valid = new Set(TEMPLATE_CATEGORIES);
    for (const t of WORKFLOW_TEMPLATES) {
      expect(valid.has(t.category)).toBe(true);
    }
  });

  it("groups by category correctly", () => {
    const grouped = getTemplatesByCategory();
    expect(Object.keys(grouped).length).toBeGreaterThanOrEqual(3);
  });

  it("templates have valid trigger events that exist in trigger library", async () => {
    const { TRIGGER_LIBRARY } = await import("./trigger-library");
    const triggerEvents = new Set(TRIGGER_LIBRARY.map((t) => t.event));
    for (const template of WORKFLOW_TEMPLATES) {
      expect(triggerEvents.has(template.triggerEvent)).toBe(true);
    }
  });

  it("all template actions have valid types", () => {
    const validTypes = new Set(["sms", "email", "webhook", "pause", "approval", "condition", "create_commlog", "update_appointment_status", "ai_generate"]);
    for (const t of WORKFLOW_TEMPLATES) {
      for (const a of t.actions) {
        expect(validTypes.has(a.type)).toBe(true);
      }
    }
  });
});
