import { describe, it, expect } from "vitest";
import {
  TRIGGER_LIBRARY,
  TRIGGER_CATEGORIES,
  extractPlaceholders,
  getTriggersByCategory,
} from "./trigger-library";

describe("trigger-library", () => {
  it("has 30+ trigger events", () => {
    expect(TRIGGER_LIBRARY.length).toBeGreaterThanOrEqual(30);
  });

  it("every trigger has required fields", () => {
    for (const trigger of TRIGGER_LIBRARY) {
      expect(trigger.event).toBeTruthy();
      expect(trigger.description).toBeTruthy();
      expect(trigger.category).toBeTruthy();
      expect(trigger.sql).toBeTruthy();
      expect(trigger.sql.toUpperCase()).toContain("SELECT");
      expect(trigger.sql.toUpperCase()).toContain("FROM");
    }
  });

  it("every trigger category is valid", () => {
    const validCategories = new Set(TRIGGER_CATEGORIES);
    for (const trigger of TRIGGER_LIBRARY) {
      expect(validCategories.has(trigger.category as typeof TRIGGER_CATEGORIES[number])).toBe(true);
    }
  });

  it("trigger events are unique", () => {
    const events = TRIGGER_LIBRARY.map((t) => t.event);
    expect(new Set(events).size).toBe(events.length);
  });

  it("all SQL queries are read-only (no INSERT/UPDATE/DELETE)", () => {
    for (const trigger of TRIGGER_LIBRARY) {
      const upper = trigger.sql.toUpperCase();
      // Check as standalone keywords, not substrings
      expect(upper).not.toMatch(/(?<![A-Z])INSERT(?![A-Z])/);
      expect(upper).not.toMatch(/(?<![A-Z])DELETE(?![A-Z])/);
      expect(upper).not.toMatch(/(?<![A-Z])DROP(?![A-Z])/);
    }
  });
});

describe("extractPlaceholders", () => {
  it("extracts AS aliases", () => {
    const sql = "SELECT p.PatNum AS patNum, p.FName AS firstName FROM patient p";
    expect(extractPlaceholders(sql)).toEqual(["patNum", "firstName"]);
  });

  it("handles complex queries", () => {
    const sql = "SELECT CONCAT(p.FName, ' ', p.LName) AS patientName, r.DateDue AS recallDate FROM recall r JOIN patient p ON r.PatNum = p.PatNum";
    const result = extractPlaceholders(sql);
    expect(result).toContain("patientName");
    expect(result).toContain("recallDate");
  });

  it("returns empty for no aliases", () => {
    expect(extractPlaceholders("SELECT * FROM patient")).toEqual([]);
  });

  it("deduplicates", () => {
    const sql = "SELECT p.FName AS name, p.LName AS name FROM patient p";
    expect(extractPlaceholders(sql)).toEqual(["name"]);
  });
});

describe("getTriggersByCategory", () => {
  it("groups triggers correctly", () => {
    const grouped = getTriggersByCategory();
    expect(Object.keys(grouped).length).toBeGreaterThan(5);
    for (const [category, triggers] of Object.entries(grouped)) {
      expect(triggers.length).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(t.category).toBe(category);
      }
    }
  });
});
