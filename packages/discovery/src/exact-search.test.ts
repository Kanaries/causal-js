import { describe, expect, it } from "vitest";

import type { LocalScoreFunction } from "@causal-js/core";
import { DenseMatrix, GaussianBicScore } from "@causal-js/core";

import { expectSameCpdag } from "../../../tests/helpers/graph-assert";
import { randomDag, sampleLinearSem } from "../../../tests/helpers/synthetic";
import { exactSearch } from "./exact-search";

class MockExactScore implements LocalScoreFunction {
  readonly name = "mock-exact";

  private readonly values = new Map<string, number>([
    ["0|", 0],
    ["0|1", 8],
    ["0|2", 9],
    ["0|1,2", 12],
    ["1|", 0],
    ["1|0", -5],
    ["1|2", 6],
    ["1|0,2", -4],
    ["2|", 0],
    ["2|0", -1],
    ["2|1", -4],
    ["2|0,1", -3]
  ]);

  score(node: number, parents: readonly number[]): number {
    const key = `${node}|${[...parents].sort((left, right) => left - right).join(",")}`;
    return this.values.get(key) ?? 20;
  }
}

describe("exactSearch", () => {
  it("finds the globally optimal DAG under the local score function", () => {
    const result = exactSearch({
      data: new DenseMatrix([
        [0, 0, 0],
        [1, 1, 1]
      ]),
      score: new MockExactScore(),
      nodeLabels: ["A", "B", "C"]
    });

    expect(result.dag.kind).toBe("dag");
    expect(result.cpdag.kind).toBe("cpdag");
    expect(result.dag.metadata?.algorithm).toBe("exact-search");
    expect(result.dag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "arrow" }
    ]);
    expect(result.cpdag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "tail" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "tail" }
    ]);
    expect(result.evaluatedOrderStates).toBeGreaterThan(0);
    expect(result.evaluatedParentSets).toBeGreaterThan(0);
  });

  it("respects includeGraph and superGraph constraints", () => {
    const result = exactSearch({
      data: new DenseMatrix([
        [0, 0, 0],
        [1, 1, 1]
      ]),
      score: new MockExactScore(),
      nodeLabels: ["A", "B", "C"],
      superGraph: [
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, 0]
      ],
      includeGraph: [
        [0, 1, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    });

    expect(result.dag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "arrow" }
    ]);
  });
});

describe("exactSearch rewrite", () => {
  const seededData = (seed: number, nodeCount: number, sampleCount: number): DenseMatrix => {
    const rows = sampleLinearSem(
      nodeCount,
      randomDag(nodeCount, 0.5, seed),
      "gaussian",
      sampleCount,
      seed
    );
    return new DenseMatrix(rows);
  };

  it("finds the true optimum at n = 4 (brute force over all DAGs)", () => {
    const data = seededData(3, 4, 400);
    const score = new GaussianBicScore(data);

    // Enumerate all 4-node DAGs (directed adjacency candidates filtered for
    // acyclicity) and compute the exact optimal total score.
    const nodeCount = 4;
    const pairs: [number, number][] = [];
    for (let i = 0; i < nodeCount; i += 1) {
      for (let j = 0; j < nodeCount; j += 1) {
        if (i !== j) {
          pairs.push([i, j]);
        }
      }
    }
    let bestScore = Number.POSITIVE_INFINITY;
    const totalAssignments = 3 ** (nodeCount * (nodeCount - 1) / 2);
    // Encode each unordered pair as none / i->j / j<-i (3 states).
    const unorderedPairs: [number, number][] = [];
    for (let i = 0; i < nodeCount; i += 1) {
      for (let j = i + 1; j < nodeCount; j += 1) {
        unorderedPairs.push([i, j]);
      }
    }
    for (let assignment = 0; assignment < totalAssignments; assignment += 1) {
      const parents: number[][] = Array.from({ length: nodeCount }, () => []);
      let code = assignment;
      for (const [i, j] of unorderedPairs) {
        const state = code % 3;
        code = Math.floor(code / 3);
        if (state === 1) {
          parents[j]!.push(i);
        } else if (state === 2) {
          parents[i]!.push(j);
        }
      }
      // Acyclicity via Kahn.
      const indegree = parents.map((list) => list.length);
      const queue = indegree
        .map((degree, node) => (degree === 0 ? node : -1))
        .filter((node) => node >= 0);
      const children: number[][] = Array.from({ length: nodeCount }, () => []);
      parents.forEach((list, child) => {
        for (const parent of list) {
          children[parent]!.push(child);
        }
      });
      let visited = 0;
      while (queue.length > 0) {
        const node = queue.pop()!;
        visited += 1;
        for (const child of children[node]!) {
          indegree[child] = indegree[child]! - 1;
          if (indegree[child] === 0) {
            queue.push(child);
          }
        }
      }
      if (visited !== nodeCount) {
        continue;
      }
      let total = 0;
      for (let node = 0; node < nodeCount; node += 1) {
        total += score.score(node, parents[node]!);
      }
      if (total < bestScore) {
        bestScore = total;
      }
    }

    const dp = exactSearch({ data, score: new GaussianBicScore(data), searchMethod: "dp" });
    const astar = exactSearch({ data, score: new GaussianBicScore(data), searchMethod: "astar" });
    expect(dp.score).toBeCloseTo(bestScore, 8);
    expect(astar.score).toBeCloseTo(bestScore, 8);
    expectSameCpdag(dp.cpdag, astar.cpdag);
  });

  it("dp and astar agree across option combinations", () => {
    for (const seed of [5, 9]) {
      const data = seededData(seed, 6, 500);
      const dp = exactSearch({ data, score: new GaussianBicScore(data), searchMethod: "dp" });
      for (const usePathExtension of [true, false]) {
        for (const useKCycleHeuristic of [true, false]) {
          const astar = exactSearch({
            data,
            score: new GaussianBicScore(data),
            searchMethod: "astar",
            usePathExtension,
            useKCycleHeuristic
          });
          expect(
            astar.score,
            `seed ${seed} pathExt=${usePathExtension} kCycle=${useKCycleHeuristic}`
          ).toBeCloseTo(dp.score, 8);
          expectSameCpdag(astar.cpdag, dp.cpdag);
        }
      }

      // maxParents constrains the returned parent sets.
      const constrained = exactSearch({
        data,
        score: new GaussianBicScore(data),
        searchMethod: "dp",
        maxParents: 1
      });
      const parentCounts = new Map<string, number>();
      for (const edge of constrained.dag.edges) {
        // The arrow endpoint marks the child regardless of node order.
        const child = edge.endpoint2 === "arrow" ? edge.node2 : edge.node1;
        parentCounts.set(child, (parentCounts.get(child) ?? 0) + 1);
      }
      for (const count of parentCounts.values()) {
        expect(count).toBeLessThanOrEqual(1);
      }
    }
  });

  it("evaluates exactly n * 2^(n-1) parent sets (complexity regression)", () => {
    // The old implementation enumerated all submasks of every predecessor
    // mask — Theta(n * 3^n) score calls; the Silander-Myllymaki layout does
    // exactly one call per (node, parent-set) pair.
    const data = seededData(1, 6, 300);
    let calls = 0;
    const inner = new GaussianBicScore(data);
    const countingScore = {
      name: "counting",
      score: (node: number, parents: readonly number[]): number => {
        calls += 1;
        return inner.score(node, parents);
      }
    };

    exactSearch({ data, score: countingScore, searchMethod: "dp" });
    expect(calls).toBe(6 * 2 ** 5);
  });

  it("rejects a cyclic includeGraph with a clear error", () => {
    const data = seededData(2, 3, 200);
    const cyclicInclude = [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0]
    ];
    expect(() =>
      exactSearch({ data, score: new GaussianBicScore(data), includeGraph: cyclicInclude })
    ).toThrow(/acyclic/);
  });

  it("honors a feasible includeGraph", () => {
    const data = seededData(2, 4, 400);
    const include = [
      [0, 1, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];
    const result = exactSearch({ data, score: new GaussianBicScore(data), includeGraph: include });
    expect(
      result.dag.edges.some(
        (edge) => edge.node1 === "X1" && edge.node2 === "X2" && edge.endpoint2 === "arrow"
      )
    ).toBe(true);
  });

  it("rejects invalid search methods and oversize inputs", () => {
    const data = seededData(2, 3, 100);
    expect(() =>
      exactSearch({
        data,
        score: new GaussianBicScore(data),
        searchMethod: "bogus" as unknown as "dp"
      })
    ).toThrow(/searchMethod/);

    const wide = new DenseMatrix(
      Array.from({ length: 30 }, () => Array.from({ length: 19 }, () => Math.random()))
    );
    expect(() =>
      exactSearch({ data: wide, score: new GaussianBicScore(wide), searchMethod: "dp" })
    ).toThrow(/at most 18/);
  });

  it("completes n = 12 astar within a small time budget", () => {
    const data = seededData(7, 12, 600);
    const startedAt = Date.now();
    const result = exactSearch({ data, score: new GaussianBicScore(data) });
    const elapsedMs = Date.now() - startedAt;
    expect(result.searchMethod).toBe("astar");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
