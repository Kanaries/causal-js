#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadManifests } = require("./lib/manifests.cjs");
const { PYTHON_DEPENDENCIES } = require("./lib/common.cjs");
const { runJsCases } = require("./lib/js-runner.cjs");
const { compareCase } = require("./lib/compare.cjs");
const {
  loadHistoryReportsFromRoots,
  defaultHistoryRoots,
  buildHistoryReport,
  renderHistoryMarkdown
} = require("./lib/history.cjs");

function parseArgs(argv) {
  const args = {
    profile: "full",
    caseIds: [],
    oracleRoot: process.env.CAUSAL_JS_ORACLE_ROOT,
    python: process.env.CAUSAL_JS_PARITY_PYTHON || "python3.10",
    outputDir: undefined,
    list: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile") {
      args.profile = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--case") {
      args.caseIds.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--oracle-root") {
      args.oracleRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--python") {
      args.python = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--list") {
      args.list = true;
    }
  }

  return args;
}

function selectCases(manifests, profile, caseIds) {
  const cases = manifests.cases.cases.filter((entry) => entry.profiles.includes(profile));
  if (caseIds.length === 0) {
    return cases;
  }

  const requested = new Set(caseIds);
  const selected = cases.filter((entry) => requested.has(entry.id));
  const missing = caseIds.filter((id) => !selected.some((entry) => entry.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown case(s) for profile ${profile}: ${missing.join(", ")}`);
  }
  return selected;
}

function findExecutable(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8"
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return null;
}

function runPythonOracle(manifests, selectedCases, options) {
  const pythonScript = path.join(manifests.root, "scripts", "python", "parity_oracle.py");
  const baseArgs = [
    pythonScript,
    "--profile",
    options.profile,
    "--oracle-root",
    options.oracleRoot ?? "",
    "--case-ids-json",
    JSON.stringify(selectedCases.map((entry) => entry.id))
  ];

  const uvExecutable = findExecutable("uv");
  let command;
  let args;

  if (uvExecutable) {
    command = uvExecutable;
    args = [
      "run",
      "--python",
      options.python,
      ...PYTHON_DEPENDENCIES.flatMap((dependency) => ["--with", dependency]),
      "python",
      ...baseArgs
    ];
  } else {
    command = options.python;
    args = baseArgs;
  }

  const result = spawnSync(command, args, {
    cwd: manifests.root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      CI: "1",
      PYTHONWARNINGS: "ignore",
      TQDM_DISABLE: "1"
    }
  });

  if (result.status !== 0) {
    throw new Error(
      `Python parity execution failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }

  return JSON.parse(result.stdout);
}

function summarizeByComponent(caseResults) {
  const summary = new Map();
  for (const result of caseResults) {
    const bucket = summary.get(result.componentId) ?? {
      componentId: result.componentId,
      total: 0,
      pass: 0,
      warn: 0,
      fail: 0,
      jsRuntimeMs: 0,
      pythonRuntimeMs: 0
    };
    bucket.total += 1;
    bucket[result.status] += 1;
    bucket.jsRuntimeMs += result.jsCase.runtimeMs ?? 0;
    bucket.pythonRuntimeMs += result.pythonCase.runtimeMs ?? 0;
    summary.set(result.componentId, bucket);
  }
  return [...summary.values()].sort((left, right) => left.componentId.localeCompare(right.componentId));
}

function renderMetrics(caseResult) {
  const { comparisonKind, metrics } = caseResult;
  if (comparisonKind === "graph") {
    return `SHD=${metrics.skeletonShd}, adjP=${metrics.adjacencyPrecision.toFixed(3)}, adjR=${metrics.adjacencyRecall.toFixed(3)}, dirP=${metrics.directionPrecision.toFixed(3)}, dirR=${metrics.directionRecall.toFixed(3)}, endpointDiff=${metrics.endpointMismatchCount}`;
  }
  if (comparisonKind === "graph-distribution") {
    return `meanSHD=${metrics.aggregate.meanSkeletonShd.toFixed(3)}, meanAdjP=${metrics.aggregate.meanAdjacencyPrecision.toFixed(3)}, meanAdjR=${metrics.aggregate.meanAdjacencyRecall.toFixed(3)}, meanDirP=${metrics.aggregate.meanDirectionPrecision.toFixed(3)}, meanDirR=${metrics.aggregate.meanDirectionRecall.toFixed(3)}`;
  }
  if (comparisonKind === "stat-test") {
    return `pΔ=${metrics.pValueAbsDiff.toExponential(2)}, statΔ=${metrics.statisticAbsDiff.toExponential(2)}, dofΔ=${metrics.degreesOfFreedomDelta}`;
  }
  if (comparisonKind === "score") {
    return `scoreΔ=${metrics.scoreAbsDiff.toExponential(2)}`;
  }
  return `diffs=${metrics.differenceCount}, structDiffs=${metrics.structuralDifferenceCount}, maxΔ=${metrics.maxNumericAbsDiff.toExponential(2)}`;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Parity Report");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Profile: \`${report.profile}\``);
  lines.push(`- Cases: ${report.totals.total}`);
  lines.push(`- Status: ${report.totals.pass} pass / ${report.totals.warn} warn / ${report.totals.fail} fail`);
  lines.push(`- Node runtime: \`${report.runtime.nodeVersion}\``);
  lines.push(`- Python runtime: \`${report.runtime.pythonVersion}\``);
  lines.push(`- Oracle root: \`${report.runtime.oracleRoot}\``);
  lines.push(`- Oracle commit: \`${report.runtime.oracleCommit ?? "unknown"}\``);
  lines.push("");
  lines.push("## Component Summary");
  lines.push("");
  lines.push("| Component | Total | Pass | Warn | Fail | JS ms | Python ms |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const entry of report.componentSummary) {
    lines.push(
      `| \`${entry.componentId}\` | ${entry.total} | ${entry.pass} | ${entry.warn} | ${entry.fail} | ${entry.jsRuntimeMs.toFixed(1)} | ${entry.pythonRuntimeMs.toFixed(1)} |`
    );
  }
  lines.push("");
  lines.push("## Case Results");
  lines.push("");
  lines.push("| Case | Status | Metrics |");
  lines.push("| --- | --- | --- |");
  for (const entry of report.cases) {
    lines.push(`| \`${entry.id}\` | ${entry.status.toUpperCase()} | ${renderMetrics(entry)} |`);
  }

  const findings = report.cases.filter((entry) => entry.status !== "pass");
  if (findings.length > 0) {
    lines.push("");
    lines.push("## Findings");
    lines.push("");
    for (const entry of findings) {
      lines.push(`### \`${entry.id}\` (${entry.status.toUpperCase()})`);
      lines.push("");
      lines.push(`- Gate: \`${entry.gate}\``);
      lines.push(`- Metrics: ${renderMetrics(entry)}`);
      if (entry.metrics.edgeDiffSummary?.length > 0) {
        lines.push(`- Edge diffs: ${JSON.stringify(entry.metrics.edgeDiffSummary)}`);
      }
      if (entry.metrics.diffSummary?.length > 0) {
        lines.push(`- Diff summary: ${entry.metrics.diffSummary.join("; ")}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function writeOutputs(manifests, report, outputDir) {
  const directory = outputDir ?? path.join(manifests.root, "parity", "results");
  const archiveDir = path.join(directory, "archives");
  fs.mkdirSync(archiveDir, { recursive: true });

  const stamp = report.generatedAt.replace(/[:]/g, "-");
  const archiveJsonPath = path.join(archiveDir, `${stamp}.${report.profile}.json`);
  const archiveMarkdownPath = path.join(archiveDir, `${stamp}.${report.profile}.md`);
  const latestJsonPath = path.join(directory, `latest.${report.profile}.json`);
  const latestMarkdownPath = path.join(directory, `latest.${report.profile}.md`);
  const markdown = renderMarkdown(report);

  fs.writeFileSync(archiveJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(archiveMarkdownPath, markdown);
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestMarkdownPath, markdown);

  const historyReport = buildHistoryReport(loadHistoryReportsFromRoots(defaultHistoryRoots(directory)));
  fs.writeFileSync(path.join(directory, "history.json"), `${JSON.stringify(historyReport, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "history.md"), renderHistoryMarkdown(historyReport));

  return {
    archiveJsonPath,
    archiveMarkdownPath,
    latestJsonPath,
    latestMarkdownPath,
    historyJsonPath: path.join(directory, "history.json"),
    historyMarkdownPath: path.join(directory, "history.md")
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifests = loadManifests();

  if (args.list) {
    for (const profile of Object.keys(manifests.cases.profiles)) {
      console.log(`${profile}:`);
      for (const entry of manifests.cases.cases.filter((candidate) => candidate.profiles.includes(profile))) {
        console.log(`  - ${entry.id}`);
      }
    }
    return;
  }

  const selectedCases = selectCases(manifests, args.profile, args.caseIds);
  if (selectedCases.some((entry) => manifests.fixtureById.get(entry.fixtureId)?.scope === "oracle") && !args.oracleRoot) {
    throw new Error(
      `Profile ${args.profile} requires --oracle-root or CAUSAL_JS_ORACLE_ROOT because it uses oracle-scoped fixtures.`
    );
  }

  const jsCases = runJsCases(manifests, selectedCases, {
    oracleRoot: args.oracleRoot
  });
  const pythonPayload = runPythonOracle(manifests, selectedCases, {
    profile: args.profile,
    oracleRoot: args.oracleRoot,
    python: args.python
  });
  const pythonCases = new Map(pythonPayload.cases.map((entry) => [entry.id, entry]));

  const caseResults = jsCases.map((jsCase) => {
    const pythonCase = pythonCases.get(jsCase.id);
    if (!pythonCase) {
      return {
        id: jsCase.id,
        componentId: jsCase.componentId,
        fixtureId: jsCase.fixtureId,
        comparisonKind: jsCase.comparison.kind,
        status: "fail",
        gate: "missing-python-case",
        metrics: {},
        jsCase,
        pythonCase: null
      };
    }

    const comparison = compareCase(jsCase, pythonCase, jsCase.comparison);
    return {
      id: jsCase.id,
      componentId: jsCase.componentId,
      fixtureId: jsCase.fixtureId,
      comparisonKind: jsCase.comparison.kind,
      comparisonMode: jsCase.comparison.mode,
      ...comparison,
      jsCase,
      pythonCase
    };
  });

  const totals = {
    total: caseResults.length,
    pass: caseResults.filter((entry) => entry.status === "pass").length,
    warn: caseResults.filter((entry) => entry.status === "warn").length,
    fail: caseResults.filter((entry) => entry.status === "fail").length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    profile: args.profile,
    runtime: {
      nodeVersion: process.version,
      pythonVersion: pythonPayload.runtime.pythonVersion,
      oracleRoot: pythonPayload.runtime.oracleRoot,
      oracleCommit: pythonPayload.runtime.oracleCommit,
      oracleVersion: pythonPayload.runtime.oracleVersion,
      pythonDependencies: PYTHON_DEPENDENCIES
    },
    manifests: {
      algorithms: path.join(manifests.parityRoot, "algorithms.manifest.json"),
      primitives: path.join(manifests.parityRoot, "primitives.manifest.json"),
      fixtures: path.join(manifests.parityRoot, "fixtures.manifest.json"),
      cases: path.join(manifests.parityRoot, "cases.manifest.json")
    },
    totals,
    componentSummary: summarizeByComponent(caseResults),
    cases: caseResults
  };

  const outputPaths = writeOutputs(manifests, report, args.outputDir);

  if (totals.fail > 0) {
    console.error(
      `Parity ${args.profile} failed: ${totals.fail} failing case(s). JSON: ${outputPaths.latestJsonPath}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Parity ${args.profile} completed: ${totals.pass} pass / ${totals.warn} warn / ${totals.fail} fail. JSON: ${outputPaths.latestJsonPath}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
