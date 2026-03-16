import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultHistoryRoots,
  buildHistoryReport,
  loadHistoryReportsFromRoots,
  renderHistoryMarkdown
} from "../scripts/parity/lib/history.cjs";

describe("parity history aggregation", () => {
  it("aggregates profile, component, and case trends across archived reports", () => {
    const history = buildHistoryReport([
      {
        generatedAt: "2026-03-15T00:00:00.000Z",
        profile: "quick",
        totals: { total: 2, pass: 1, warn: 1, fail: 0 },
        componentSummary: [
          {
            componentId: "pc",
            total: 1,
            pass: 1,
            warn: 0,
            fail: 0,
            jsRuntimeMs: 10,
            pythonRuntimeMs: 12
          },
          {
            componentId: "fci",
            total: 1,
            pass: 0,
            warn: 1,
            fail: 0,
            jsRuntimeMs: 20,
            pythonRuntimeMs: 24
          }
        ],
        cases: [
          { id: "pc.case", componentId: "pc", status: "pass", gate: "exact-graph-match" },
          { id: "fci.case", componentId: "fci", status: "warn", gate: "graph-within-warn-thresholds" }
        ]
      },
      {
        generatedAt: "2026-03-16T00:00:00.000Z",
        profile: "benchmark",
        totals: { total: 2, pass: 1, warn: 0, fail: 1 },
        componentSummary: [
          {
            componentId: "pc",
            total: 1,
            pass: 1,
            warn: 0,
            fail: 0,
            jsRuntimeMs: 8,
            pythonRuntimeMs: 9
          },
          {
            componentId: "fci",
            total: 1,
            pass: 0,
            warn: 0,
            fail: 1,
            jsRuntimeMs: 30,
            pythonRuntimeMs: 31
          }
        ],
        cases: [
          { id: "pc.case", componentId: "pc", status: "pass", gate: "exact-graph-match" },
          { id: "fci.case", componentId: "fci", status: "fail", gate: "graph-outside-thresholds" }
        ]
      }
    ]);

    expect(history.totals.reports).toBe(2);
    expect(history.componentHistory).toHaveLength(2);
    expect(history.caseHistory.find((entry) => entry.id === "fci.case")?.failureCount).toBe(1);
    expect(history.caseHistory.find((entry) => entry.id === "fci.case")?.warnCount).toBe(1);

    const markdown = renderHistoryMarkdown(history);
    expect(markdown).toContain("Parity History");
    expect(markdown).toContain("fci.case");
    expect(markdown).toContain("Component Trends");
  });

  it("loads reports from archives and imported roots and deduplicates identical runs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "parity-history-"));
    const resultsDir = path.join(root, "results");
    const archivesDir = path.join(resultsDir, "archives");
    const importedDir = path.join(resultsDir, "imported", "github-artifacts", "1-parity-quick-report");
    mkdirSync(archivesDir, { recursive: true });
    mkdirSync(importedDir, { recursive: true });

    const report = {
      generatedAt: "2026-03-16T00:00:00.000Z",
      profile: "quick",
      totals: { total: 1, pass: 1, warn: 0, fail: 0 },
      componentSummary: [],
      cases: []
    };

    writeFileSync(path.join(archivesDir, "run.json"), `${JSON.stringify(report)}\n`);
    writeFileSync(path.join(importedDir, "latest.quick.json"), `${JSON.stringify(report)}\n`);
    writeFileSync(path.join(importedDir, "artifact-metadata.json"), `${JSON.stringify({ id: 1 })}\n`);

    const reports = loadHistoryReportsFromRoots(defaultHistoryRoots(resultsDir));
    expect(reports).toHaveLength(1);
    expect(reports[0]?.profile).toBe("quick");
  });
});
