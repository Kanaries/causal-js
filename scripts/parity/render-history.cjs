#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { loadManifests } = require("./lib/manifests.cjs");
const {
  loadHistoryReportsFromRoots,
  defaultHistoryRoots,
  buildHistoryReport,
  renderHistoryMarkdown
} = require("./lib/history.cjs");

function parseArgs(argv) {
  const args = {
    archivesDir: undefined,
    outputDir: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--archives-dir") {
      args.archivesDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function main(argv = process.argv.slice(2)) {
  const manifests = loadManifests();
  const args = parseArgs(argv);
  const resultsDir = args.outputDir ?? path.join(manifests.root, "parity", "results");
  const reports = args.archivesDir
    ? loadHistoryReportsFromRoots([args.archivesDir])
    : loadHistoryReportsFromRoots(defaultHistoryRoots(resultsDir));
  const historyReport = buildHistoryReport(reports);
  const markdown = renderHistoryMarkdown(historyReport);

  fs.mkdirSync(resultsDir, { recursive: true });
  const jsonPath = path.join(resultsDir, "history.json");
  const markdownPath = path.join(resultsDir, "history.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(historyReport, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown);

  console.log(
    `Rendered parity history from ${reports.length} archived report(s). JSON: ${jsonPath}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
