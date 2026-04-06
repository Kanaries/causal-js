import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("step3 docs contract", () => {
  it("keeps public entrypoint docs aligned on production-scope DAG-first boundaries", () => {
    const rootReadme = readRepoFile("README.md");
    const packageReadme = readRepoFile("packages/causal/README.md");
    const taskIndex = readRepoFile("docs/tasks/index.md");

    for (const content of [rootReadme, packageReadme, taskIndex]) {
      expect(content).toContain("DAG-first");
      expect(content).toContain("production-scope");
    }

    expect(taskIndex).toContain("backend-selection.md");
    expect(taskIndex).toContain("operational-readiness.md");
  });

  it("documents backend selection guidance beyond raw backend ids", () => {
    const content = readRepoFile("docs/tasks/backend-selection.md");

    expect(content).toContain("auto");
    expect(content).toContain("dag-first-mvp");
    expect(content).toContain("dag-backdoor-only");
    expect(content).toContain("When To Prefer Each Backend");
    expect(content).toContain("When Not To Use This Guidance");
  });

  it("documents operational readiness commands and evidence boundaries", () => {
    const content = readRepoFile("docs/tasks/operational-readiness.md");

    expect(content).toContain("pnpm typecheck");
    expect(content).toContain("pnpm build");
    expect(content).toContain("pnpm test");
    expect(content).toContain("pnpm test:integration");
    expect(content).toContain("CAUSAL_JS_SOURCE_ROOT=../causal-js pnpm test");
    expect(content).toContain("not falsified");
    expect(content).toContain("contract stability");
    expect(content).toContain("causal truth");
  });

  it("keeps the workflow guide linked to backend and operational guidance", () => {
    const content = readRepoFile("docs/tasks/end-to-end-workflow.md");

    expect(content).toContain("backend-selection.md");
    expect(content).toContain("operational-readiness.md");
    expect(content).toContain("not falsified");
    expect(content).toContain("robustness signal");
  });
});
