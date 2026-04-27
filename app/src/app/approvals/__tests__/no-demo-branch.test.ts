/**
 * Regression guard: the approvals page must not import demo fixtures or
 * branch on isDemoMode(). Production code should always hit real APIs;
 * the demo lane was a pre-launch sales-screenshot affordance and is being
 * removed module-by-module.
 *
 * If this test fails, demo branches have leaked back into production. Don't
 * patch the test — fix the source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PAGE_SOURCE = readFileSync(
  resolve(__dirname, "..", "page.tsx"),
  "utf8",
);

describe("approvals page — no demo branches", () => {
  it("does not import isDemoMode / DEMO_APPROVALS / demoApprovalDetail", () => {
    expect(PAGE_SOURCE).not.toMatch(/from\s+["']@\/lib\/demo-mode["']/);
    expect(PAGE_SOURCE).not.toMatch(/\bisDemoMode\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bDEMO_APPROVALS\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bdemoApprovalDetail\b/);
  });

  it("does not contain mock patient names from the demo fixtures", () => {
    // A regression here would also catch any future place where someone
    // pasted demo data inline instead of importing it.
    expect(PAGE_SOURCE).not.toMatch(/Sawyer Mitchell/);
    expect(PAGE_SOURCE).not.toMatch(/Ivanna Chen/);
    expect(PAGE_SOURCE).not.toMatch(/Marcus Reyes/);
    expect(PAGE_SOURCE).not.toMatch(/Priya Shah/);
    expect(PAGE_SOURCE).not.toMatch(/Eleanor Park/);
  });
});
