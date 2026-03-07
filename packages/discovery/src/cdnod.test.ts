import { describe, expect, it } from "vitest";

import { DenseMatrix, FisherZTest } from "@causal-js/core";

import { cdnod } from "./cdnod";

function buildDomainShiftChainData(sampleSizePerDomain: number): {
  data: DenseMatrix;
  context: number[];
} {
  const rows: number[][] = [];
  const context: number[] = [];

  for (let domain = 0; domain < 3; domain += 1) {
    for (let index = 0; index < sampleSizePerDomain; index += 1) {
      const t = index + 1;
      const c = domain;
      const x = c * 1.2 + Math.sin(t / 7) * 0.08 + Math.cos((domain + 1) * t / 13) * 0.05;
      const y = 0.9 * x + Math.sin(t / 11) * 0.04;
      const z = Math.cos(t / 5) * 0.7 + Math.sin(t / 17) * 0.03;

      rows.push([x, y, z]);
      context.push(c);
    }
  }

  return {
    data: new DenseMatrix(rows),
    context
  };
}

describe("cdnod", () => {
  it("orients the augmented context node toward shifted variables", () => {
    const { data, context } = buildDomainShiftChainData(180);

    const result = cdnod({
      alpha: 0.05,
      data,
      context,
      nodeLabels: ["X", "Y", "Z"],
      contextLabel: "C",
      createCiTest: (augmentedData) => new FisherZTest(augmentedData)
    });

    expect(result.contextNodeIndex).toBe(3);
    expect(result.observedNodeCount).toBe(3);
    expect(result.graph.edges).toContainEqual({
      node1: "X",
      node2: "C",
      endpoint1: "arrow",
      endpoint2: "tail"
    });
    expect(result.graph.edges).toContainEqual({
      node1: "Y",
      node2: "C",
      endpoint1: "arrow",
      endpoint2: "tail"
    });
    expect(result.graph.edges).toContainEqual({
      node1: "X",
      node2: "Y",
      endpoint1: "tail",
      endpoint2: "tail"
    });
    expect(result.graph.edges.find((edge) => edge.node1 === "Z" || edge.node2 === "Z")).toBeUndefined();
  });

  it("accepts a one-column matrix as the context input", () => {
    const { data, context } = buildDomainShiftChainData(120);
    const contextMatrix = DenseMatrix.fromColumns([context]);

    const result = cdnod({
      alpha: 0.05,
      data,
      context: contextMatrix,
      nodeLabels: ["X", "Y", "Z"],
      createCiTest: (augmentedData) => new FisherZTest(augmentedData)
    });

    expect(result.graph.nodes.at(-1)?.id).toBe("C");
    expect(result.graph.edges).toContainEqual({
      node1: "X",
      node2: "C",
      endpoint1: "arrow",
      endpoint2: "tail"
    });
  });

  it("rejects uc variants that are outside the current v1 scope", () => {
    const { data, context } = buildDomainShiftChainData(90);

    expect(() =>
      cdnod({
        data,
        context,
        createCiTest: (augmentedData) => new FisherZTest(augmentedData),
        ucRule: 1
      })
    ).toThrow(/ucRule=1/);

    expect(() =>
      cdnod({
        data,
        context,
        createCiTest: (augmentedData) => new FisherZTest(augmentedData),
        ucPriority: 3
      })
    ).toThrow(/ucPriority=3/);
  });
});
