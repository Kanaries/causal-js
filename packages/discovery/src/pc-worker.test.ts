import { describe, expect, it } from "vitest";

import { BackgroundKnowledge } from "@causal-js/core";

import { executeSerializablePcTask } from "./pc-worker";

describe("executeSerializablePcTask", () => {
  it("runs PC from a serializable Fisher-Z task payload", () => {
    const data = [
      [0.15, 0.28, 0.41],
      [0.31, 0.45, 0.52],
      [0.48, 0.62, 0.57],
      [0.72, 0.74, 0.8],
      [0.87, 0.93, 0.76],
      [1.03, 1.08, 1.02]
    ];

    const result = executeSerializablePcTask({
      data,
      ciTest: { kind: "fisher-z" },
      alpha: 0.05,
      stable: true,
      ucRule: 0,
      ucPriority: 2,
      nodeLabels: ["X1", "X2", "X3"]
    });

    expect(result.graph.nodes).toHaveLength(3);
    expect(result.maxDepth).toBeGreaterThanOrEqual(0);
  });
});

it("orients a worker edge using a serialized rule whose source contains an arrow", () => {
  const knowledge = new BackgroundKnowledge().addRequired("A->B", "C");
  const result = executeSerializablePcTask({
    data: Array.from({ length: 64 }, (_, i) => [i % 2, i % 2]),
    nodeLabels: ["A->B", "C"],
    ciTest: { kind: "chi-square" },
    backgroundKnowledge: structuredClone(knowledge.toShape())
  });
  expect(result.graph.edges).toEqual([
    { node1: "A->B", node2: "C", endpoint1: "tail", endpoint2: "arrow" }
  ]);
});
