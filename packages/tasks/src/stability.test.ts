import { BackgroundKnowledge, CausalGraph, DenseMatrix } from "@causal-js/core";
import { cdnod, pc } from "@causal-js/discovery";
import { expect, it } from "vitest";
import { stabilityAnalysis } from "./stability";

class DependentTest {
  readonly name = "dependent";
  test(): number { return 0; }
}

const dependent = new DependentTest();

it.each([{ nodeLabels: ["Z", "A"] }, { nodeLabels: ["A", "Z"] }])(
  "preserves Z → A with columns $nodeLabels", ({ nodeLabels }) => {
    const options = {
      data: new DenseMatrix([[0, 0], [1, 1]]),
      ciTest: dependent,
      backgroundKnowledge: new BackgroundKnowledge().addRequired("Z", "A"),
      nodeLabels
    };
    const result = stabilityAnalysis({
      discovery: { algorithm: "pc", options },
      bootstrapSamples: 1, replace: false,
      createDiscoveryOptions: data => ({ ...options, data })
    });
    expect(CausalGraph.fromShape(pc(options).graph).isParentOf("Z", "A")).toBe(true);
    expect(CausalGraph.fromShape(result.consensusGraph!).isParentOf("Z", "A")).toBe(true);
    const [pair] = result.orientationStability;
    const endpoints = { [pair!.node1]: pair!.dominantOrientation!.endpoint1, [pair!.node2]: pair!.dominantOrientation!.endpoint2 };
    expect(endpoints).toEqual({ Z: "tail", A: "arrow" });
    expect(pair!.dominantOrientationFrequency).toBe(1);
  }
);

it("includes discovered context nodes and their incident edges", () => {
  const options = { data: new DenseMatrix([[1, 2], [2, 3]]), context: [0, 1], createCiTest: () => dependent };
  const result = stabilityAnalysis({
    discovery: { algorithm: "cdnod", options }, bootstrapSamples: 1, replace: false
  });
  const direct = cdnod(options).graph;
  expect(result.consensusGraph?.nodes).toEqual(direct.nodes);
  expect(result.consensusGraph?.edges).toEqual(direct.edges);
  expect(result.edgeFrequency).toHaveLength(3);
  expect(result.edgeFrequency.every(pair => pair.adjacencyFrequency === 1)).toBe(true);
});

it("rejects pooling bootstrap runs with different node identities", () => {
  const data = new DenseMatrix([[0, 1]]);
  expect(() => stabilityAnalysis({
    discovery: { algorithm: "pc", options: { data, ciTest: dependent } }, bootstrapSamples: 2,
    createDiscoveryOptions: (sample, { iteration }) => ({
      data: sample, ciTest: dependent, nodeLabels: ["A", iteration === 0 ? "B" : "C"]
    })
  })).toThrow(/node identit/i);
});

it("counts distinct node pairs even when labels contain separators", () => {
  const options = { data: new DenseMatrix([[0, 1, 2, 3]]), ciTest: dependent, nodeLabels: ["A", "B::C", "A::B", "C"] };
  const result = stabilityAnalysis({
    discovery: { algorithm: "pc", options }, bootstrapSamples: 1, createDiscoveryOptions: data => ({ ...options, data })
  });
  expect(result.edgeFrequency).toHaveLength(6);
  expect(result.edgeFrequency.every(p => p.adjacencyFrequency === 1 && p.absenceFrequency === 0)).toBe(true);
});
