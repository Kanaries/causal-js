import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const productionSourceFiles = [
  "packages/core/src/background-knowledge.ts",
  "packages/core/src/ci.ts",
  "packages/core/src/errors.ts",
  "packages/core/src/graph.ts",
  "packages/core/src/kernel-independence.ts",
  "packages/core/src/runtime.ts",
  "packages/core/src/score.ts",
  "packages/core/src/stats.ts",
  "packages/discovery/src/camuv.ts",
  "packages/discovery/src/cdnod.ts",
  "packages/discovery/src/catalog.ts",
  "packages/discovery/src/contracts.ts",
  "packages/discovery/src/exact-search.ts",
  "packages/discovery/src/ges.ts",
  "packages/discovery/src/gin.ts",
  "packages/discovery/src/grasp.ts",
  "packages/discovery/src/graph-conversion.ts",
  "packages/discovery/src/index.ts",
  "packages/discovery/src/pc.ts",
  "packages/discovery/src/pc-worker.ts",
  "packages/discovery/src/rcd.ts",
  "packages/node/src/adapters/pc-worker.ts",
  "packages/node/src/index.ts",
  "packages/node/src/worker-bridge.ts",
  "packages/node/src/workers/pc-worker-entry.ts",
  "packages/node/src/workers/pc-worker-runtime.ts",
  "packages/web/src/adapters/pc-worker.ts",
  "packages/web/src/index.ts",
  "packages/web/src/worker-bridge.ts",
  "packages/web/src/workers/pc-worker-entry.ts",
  "packages/web/src/workers/pc-worker-runtime.ts"
].map((relativePath) => path.join(rootDir, relativePath));

function readSource(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("production integrity", () => {
  it("does not leave not-implemented guards in production sources", () => {
    for (const filePath of productionSourceFiles) {
      const source = readSource(filePath);
      expect(source).not.toMatch(/not implemented/i);
      expect(source).not.toMatch(/\bnotImplemented\s*\(/);
    }
  });

  it("does not contain fake or mock placeholders in production sources", () => {
    for (const filePath of productionSourceFiles) {
      const source = readSource(filePath);
      expect(source).not.toMatch(/\bmock\b/i);
      expect(source).not.toMatch(/\bfake\b/i);
      expect(source).not.toMatch(/\bstub\b/i);
      expect(source).not.toMatch(/\bplaceholder\b/i);
    }
  });
});
