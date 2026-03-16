import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parityDir = path.join(rootDir, "parity");

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(path.join(parityDir, filename), "utf8")) as T;
}

interface AlgorithmEntry {
  id: string;
}

interface PrimitiveEntry {
  id: string;
}

interface FixtureEntry {
  id: string;
  scope: "repo" | "oracle";
  path?: string;
  sources?: Array<{ path: string }>;
}

interface CaseEntry {
  id: string;
  componentId: string;
  fixtureId: string;
  profiles: string[];
}

describe("parity manifests", () => {
  it("binds every case to a known component and fixture", () => {
    const algorithms = loadJson<{ algorithms: AlgorithmEntry[] }>("algorithms.manifest.json");
    const primitives = loadJson<{ primitives: PrimitiveEntry[] }>("primitives.manifest.json");
    const fixtures = loadJson<{ fixtures: FixtureEntry[] }>("fixtures.manifest.json");
    const cases = loadJson<{ cases: CaseEntry[] }>("cases.manifest.json");

    const componentIds = new Set([
      ...algorithms.algorithms.map((entry) => entry.id),
      ...primitives.primitives.map((entry) => entry.id)
    ]);
    const fixtureIds = new Set(fixtures.fixtures.map((entry) => entry.id));

    for (const entry of cases.cases) {
      expect(componentIds.has(entry.componentId), entry.id).toBe(true);
      expect(fixtureIds.has(entry.fixtureId), entry.id).toBe(true);
      expect(entry.profiles.length).toBeGreaterThan(0);
    }
  });

  it("keeps repo fixtures inside the repository and benchmark fixtures oracle-scoped", () => {
    const fixtures = loadJson<{ fixtures: FixtureEntry[] }>("fixtures.manifest.json");

    for (const fixture of fixtures.fixtures) {
      if (fixture.scope === "repo" && fixture.path) {
        expect(path.isAbsolute(fixture.path)).toBe(false);
        expect(fixture.path.startsWith("fixtures/") || fixture.path.startsWith("parity/")).toBe(true);
      }

      if (fixture.scope === "repo" && fixture.sources) {
        for (const source of fixture.sources) {
          expect(path.isAbsolute(source.path)).toBe(false);
          expect(source.path.startsWith("fixtures/")).toBe(true);
        }
      }

      if (fixture.scope === "oracle" && fixture.path) {
        expect(fixture.path.startsWith("tests/TestData/")).toBe(true);
      }
    }
  });

  it("keeps quick profile free of oracle-scoped fixtures", () => {
    const fixtures = loadJson<{ fixtures: FixtureEntry[] }>("fixtures.manifest.json");
    const cases = loadJson<{ cases: CaseEntry[] }>("cases.manifest.json");
    const fixtureById = new Map(fixtures.fixtures.map((entry) => [entry.id, entry]));

    for (const entry of cases.cases.filter((candidate) => candidate.profiles.includes("quick"))) {
      expect(fixtureById.get(entry.fixtureId)?.scope, entry.id).toBe("repo");
    }
  });
});
