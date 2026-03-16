const fs = require("node:fs");
const path = require("node:path");

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isParityReport(candidate) {
  return (
    candidate &&
    typeof candidate === "object" &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.profile === "string" &&
    candidate.totals &&
    typeof candidate.totals === "object" &&
    Array.isArray(candidate.componentSummary) &&
    Array.isArray(candidate.cases)
  );
}

function collectJsonFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const output = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        output.push(fullPath);
      }
    }
  }

  return output.sort();
}

function loadHistoryReports(archivesDir) {
  return loadHistoryReportsFromRoots([archivesDir]);
}

function loadHistoryReportsFromRoots(rootDirs) {
  const deduped = new Map();

  for (const rootDir of rootDirs) {
    for (const filePath of collectJsonFiles(rootDir)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!isParityReport(parsed)) {
        continue;
      }

      const dedupeKey = `${parsed.generatedAt}|${parsed.profile}`;
      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, parsed);
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
}

function defaultHistoryRoots(resultsDir) {
  return [
    path.join(resultsDir, "archives"),
    path.join(resultsDir, "imported")
  ];
}

function summarizeProfileRuns(reports) {
  return reports
    .map((report) => ({
      generatedAt: report.generatedAt,
      profile: report.profile,
      total: report.totals?.total ?? 0,
      pass: report.totals?.pass ?? 0,
      warn: report.totals?.warn ?? 0,
      fail: report.totals?.fail ?? 0,
      oracleCommit: report.runtime?.oracleCommit ?? null,
      nodeVersion: report.runtime?.nodeVersion ?? null,
      pythonVersion: report.runtime?.pythonVersion ?? null
    }))
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
}

function summarizeComponentHistory(reports) {
  const byComponent = new Map();

  for (const report of reports) {
    const generatedAt = report.generatedAt;
    const profile = report.profile;
    for (const entry of report.componentSummary ?? []) {
      const bucket = byComponent.get(entry.componentId) ?? {
        componentId: entry.componentId,
        profiles: new Set(),
        runs: [],
        latest: null,
        latestStatus: {
          total: 0,
          pass: 0,
          warn: 0,
          fail: 0,
          jsRuntimeMs: 0,
          pythonRuntimeMs: 0
        },
        maxWarn: 0,
        maxFail: 0
      };

      const run = {
        generatedAt,
        profile,
        total: entry.total,
        pass: entry.pass,
        warn: entry.warn,
        fail: entry.fail,
        jsRuntimeMs: safeNumber(entry.jsRuntimeMs),
        pythonRuntimeMs: safeNumber(entry.pythonRuntimeMs)
      };
      bucket.profiles.add(profile);
      bucket.runs.push(run);
      if (!bucket.latest || generatedAt > bucket.latest.generatedAt) {
        bucket.latest = run;
        bucket.latestStatus = {
          total: entry.total,
          pass: entry.pass,
          warn: entry.warn,
          fail: entry.fail,
          jsRuntimeMs: safeNumber(entry.jsRuntimeMs),
          pythonRuntimeMs: safeNumber(entry.pythonRuntimeMs)
        };
      }
      bucket.maxWarn = Math.max(bucket.maxWarn, entry.warn);
      bucket.maxFail = Math.max(bucket.maxFail, entry.fail);
      byComponent.set(entry.componentId, bucket);
    }
  }

  return [...byComponent.values()]
    .map((entry) => ({
      componentId: entry.componentId,
      profiles: [...entry.profiles].sort(),
      latest: entry.latest,
      latestStatus: entry.latestStatus,
      maxWarn: entry.maxWarn,
      maxFail: entry.maxFail,
      runs: entry.runs.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    }))
    .sort((left, right) => left.componentId.localeCompare(right.componentId));
}

function summarizeCaseHistory(reports) {
  const byCase = new Map();

  for (const report of reports) {
    for (const entry of report.cases ?? []) {
      const bucket = byCase.get(entry.id) ?? {
        id: entry.id,
        componentId: entry.componentId,
        profile: report.profile,
        runs: [],
        latest: null,
        latestStatus: null,
        latestGate: null,
        failureCount: 0,
        warnCount: 0
      };

      const run = {
        generatedAt: report.generatedAt,
        status: entry.status,
        gate: entry.gate ?? null
      };
      bucket.runs.push(run);
      if (!bucket.latest || report.generatedAt > bucket.latest.generatedAt) {
        bucket.latest = run;
        bucket.latestStatus = entry.status;
        bucket.latestGate = entry.gate ?? null;
      }
      if (entry.status === "fail") {
        bucket.failureCount += 1;
      }
      if (entry.status === "warn") {
        bucket.warnCount += 1;
      }
      byCase.set(entry.id, bucket);
    }
  }

  return [...byCase.values()]
    .map((entry) => ({
      ...entry,
      runs: entry.runs.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildHistoryReport(reports) {
  const sortedReports = [...reports].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const profileRuns = summarizeProfileRuns(sortedReports);
  const componentHistory = summarizeComponentHistory(sortedReports);
  const caseHistory = summarizeCaseHistory(sortedReports);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      reports: sortedReports.length,
      profiles: [...new Set(sortedReports.map((report) => report.profile))].sort().length,
      components: componentHistory.length,
      cases: caseHistory.length
    },
    profileRuns,
    componentHistory,
    caseHistory
  };
}

function renderHistoryMarkdown(historyReport) {
  const lines = [];
  lines.push("# Parity History");
  lines.push("");
  lines.push(`- Generated at: ${historyReport.generatedAt}`);
  lines.push(`- Reports indexed: ${historyReport.totals.reports}`);
  lines.push(`- Profiles indexed: ${historyReport.totals.profiles}`);
  lines.push(`- Components indexed: ${historyReport.totals.components}`);
  lines.push(`- Cases indexed: ${historyReport.totals.cases}`);
  lines.push("");

  if (historyReport.profileRuns.length > 0) {
    lines.push("## Runs");
    lines.push("");
    lines.push("| Generated At | Profile | Pass | Warn | Fail | Total | Oracle Commit |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const entry of historyReport.profileRuns) {
      lines.push(
        `| ${entry.generatedAt} | \`${entry.profile}\` | ${entry.pass} | ${entry.warn} | ${entry.fail} | ${entry.total} | \`${entry.oracleCommit ?? "unknown"}\` |`
      );
    }
    lines.push("");
  }

  if (historyReport.componentHistory.length > 0) {
    lines.push("## Component Trends");
    lines.push("");
    lines.push("| Component | Profiles | Latest | Max Warn | Max Fail | JS ms | Python ms |");
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
    for (const entry of historyReport.componentHistory) {
      lines.push(
        `| \`${entry.componentId}\` | ${entry.profiles.map((profile) => `\`${profile}\``).join(", ")} | ${entry.latestStatus.pass}/${entry.latestStatus.warn}/${entry.latestStatus.fail} | ${entry.maxWarn} | ${entry.maxFail} | ${entry.latestStatus.jsRuntimeMs.toFixed(1)} | ${entry.latestStatus.pythonRuntimeMs.toFixed(1)} |`
      );
    }
    lines.push("");
  }

  const interestingCases = historyReport.caseHistory.filter(
    (entry) => entry.failureCount > 0 || entry.warnCount > 0
  );
  if (interestingCases.length > 0) {
    lines.push("## Cases With Warnings Or Failures");
    lines.push("");
    lines.push("| Case | Component | Profile | Latest Status | Warn Count | Fail Count | Latest Gate |");
    lines.push("| --- | --- | --- | --- | ---: | ---: | --- |");
    for (const entry of interestingCases) {
      lines.push(
        `| \`${entry.id}\` | \`${entry.componentId}\` | \`${entry.profile}\` | ${entry.latestStatus?.toUpperCase() ?? "UNKNOWN"} | ${entry.warnCount} | ${entry.failureCount} | \`${entry.latestGate ?? "n/a"}\` |`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  loadHistoryReports,
  loadHistoryReportsFromRoots,
  defaultHistoryRoots,
  buildHistoryReport,
  renderHistoryMarkdown
};
