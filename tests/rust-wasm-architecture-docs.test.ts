import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("rust wasm kernel architecture docs", () => {
  it("captures the kernel boundary, migration order, and Step 4 data constraints", () => {
    const content = readRepoFile("docs/adr/0002-rust-wasm-kernel-pilot.md");

    expect(content).toContain("Status");
    expect(content).toContain("Accepted");
    expect(content).toContain("Kernel candidates");
    expect(content).toContain("D-separation");
    expect(content).toContain("adjustment");
    expect(content).toContain("Node bindings");
    expect(content).toContain("browser/WASM");
    expect(content).toContain("Step 4");
    expect(content).toContain("index-based");
    expect(content).toContain("GraphShape");
  });
});
