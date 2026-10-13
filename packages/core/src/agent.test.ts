import { describe, expect, it } from "vitest";

import { getDiagnosticSummary } from "./agent";
import type { AgentDiagnostic, AgentDiagnosticStatus } from "./agent";

function diagnostic(status: AgentDiagnosticStatus): AgentDiagnostic {
  return { code: "check", status, severity: "info", message: "Check outcome" };
}

describe("getDiagnosticSummary", () => {
  it("does not mistake absent or irrelevant checks for passed assumptions", () => {
    expect(getDiagnosticSummary([])).toMatchObject({ applicableCount: 0, allPassed: false });
    expect(getDiagnosticSummary([diagnostic("not_applicable")])).toMatchObject({
      applicableCount: 0,
      allPassed: false
    });
  });

  it.each(["failed", "inconclusive", "not_run"] as const)(
    "does not report allPassed when a check is %s",
    (status) => {
      const summary = getDiagnosticSummary([diagnostic("passed"), diagnostic(status)]);
      expect(summary.allPassed).toBe(false);
      expect(summary.applicableCount).toBe(2);
      expect(summary.counts[status]).toBe(1);
    }
  );

  it("ignores not-applicable checks when actual checks passed", () => {
    const summary = getDiagnosticSummary([
      diagnostic("passed"),
      diagnostic("passed"),
      diagnostic("not_applicable")
    ]);
    expect(summary).toEqual({
      counts: { passed: 2, failed: 0, inconclusive: 0, not_run: 0, not_applicable: 1 },
      applicableCount: 2,
      allPassed: true
    });
  });
});
