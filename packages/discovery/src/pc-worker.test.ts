import { describe, expect, it } from "vitest";

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
