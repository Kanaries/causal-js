import { describe, expect, it } from "vitest";
import { CausalGraph, DenseMatrix, FisherZTest, KciTest, MvFisherZTest, type ConditionalIndependenceTest } from "@causal-js/core";
import { cdnod, fci, mvpc, orientPcGraph, pc } from "@causal-js/discovery";

const rows = Array.from({ length: 40 }, (_, i) => [Math.sin(i / 3), Math.cos(i / 5), Math.sin(i / 7)]);
const data = new DenseMatrix(rows);

describe("CI failure contract", () => {
  it("Fisher-Z rejects non-finite observations before returning a graph", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const invalid = new DenseMatrix(rows.map((row, i) => i === 0 ? [value, row[1]!, row[2]!] : row));
      expect(() => pc({ data: invalid, ciTest: new FisherZTest(invalid) })).toThrow(/finite|NaN|Infinity/);
    }
  });

  it("MV-Fisher-Z validates effective sample size for each conditioning set", () => {
    for (const completeCount of [1, 2, 3]) {
      const incomplete = new DenseMatrix(rows.map((row, i) => i < completeCount ? row : [NaN, row[1]!, row[2]!]));
      expect(() => new MvFisherZTest(incomplete).test(0, 1)).toThrow(/sample size/i);
      expect(() => mvpc({ data: incomplete })).toThrow();
    }
    const conditional = new DenseMatrix(rows.map((row, i) => [row[0]!, row[1]!, i < 4 ? row[2]! : NaN]));
    const ci = new MvFisherZTest(conditional);
    expect(Number.isFinite(ci.test(0, 1))).toBe(true);
    expect(() => ci.test(0, 1, [2])).toThrow(/sample size/i);
  });

  it("test-wise deletion agrees with Fisher-Z on the actual complete rows", () => {
    const incomplete = new DenseMatrix(rows.map((row, i) => [row[0]!, row[1]!, i % 3 ? row[2]! : NaN]));
    const complete = new DenseMatrix(incomplete.toArray().filter(row => row.every(Number.isFinite)));
    expect(new MvFisherZTest(incomplete).test(0, 1, [2])).toBeCloseTo(new FisherZTest(complete).test(0, 1, [2]), 10);
  });

  it("MV-Fisher-Z and KCI reject Infinity rather than deleting or zeroing it", () => {
    const invalid = new DenseMatrix(rows.map((row, i) => i === 0 ? [Infinity, row[1]!, row[2]!] : row));
    expect(() => new MvFisherZTest(invalid)).toThrow(/finite|Infinity/);
    expect(() => new KciTest(invalid)).toThrow(/finite|Infinity/);
  });

  it("all PC-family entry points reject invalid alpha", () => {
    for (const alpha of [NaN, Infinity, -0.1, 0, 1, 1.1]) {
      expect(() => pc({ data, ciTest: new FisherZTest(data), alpha })).toThrow(/alpha/);
      expect(() => fci({ data, ciTest: new FisherZTest(data), alpha })).toThrow(/alpha/);
      expect(() => mvpc({ data, alpha })).toThrow(/alpha/);
      expect(() => cdnod({ data, context: rows.map((_, i) => i), createCiTest: d => new FisherZTest(d), alpha })).toThrow(/alpha/);
    }
  });

  it("rejects invalid results from user-supplied CI backends", () => {
    // Fault injection at the public CI extension point; real search algorithms
    // must validate backend results regardless of where a failure originated.
    for (const pValue of [NaN, Infinity, -0.1, 1.1]) {
      const ciTest: ConditionalIndependenceTest = { name: "invalid-backend", test: () => pValue };
      expect(() => pc({ data, ciTest })).toThrow(/p.value/i);
      expect(() => fci({ data, ciTest })).toThrow(/p.value/i);
      expect(() => cdnod({ data, context: rows.map((_, i) => i), createCiTest: () => ciTest })).toThrow(/p.value/i);
    }
  });

  it("also validates CI failures during collider orientation", () => {
    for (const ucRule of [0, 1, 2] as const) {
      const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
      graph.addUndirectedEdge("A", "B");
      graph.addUndirectedEdge("B", "C");
      expect(() => orientPcGraph(graph, {
        ucRule, ucPriority: 3, ciTest: { name: "invalid-backend", test: () => NaN }
      }, [{ x: 0, y: 2, conditioningSets: [[]] }])).toThrow(/p.value/i);
    }
  });
});
