import { describe, expect, it } from "vitest";

import {
  CausalGraph,
  DenseMatrix,
  FisherZTest,
  GRAPH_KIND,
  NODE_TYPE
} from "@causal-js/core";

import {
  discoverGraph,
  falsifyGraph,
  findAdjustmentSets,
  getIdentificationBackendDescriptor,
  listIdentificationBackendDescriptors,
  identifyEffect,
  isAdjustmentSet,
  listIdentificationBackends,
  resolveIdentificationBackend,
  runDagFirstIdentificationBackend,
  runIdentificationBackend,
  stabilityAnalysis
} from "./index";
import type { ConditionalIndependenceTest, NumericMatrix } from "@causal-js/core";
import type {
  DiscoverGraphResult,
  FalsifyGraphResult,
  FindAdjustmentSetsResult,
  IdentifyEffectResult,
  IsAdjustmentSetResult,
  StabilityAnalysisResult,
  TaskResultBase
} from "./types";

function buildConfoundedDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");
  return graph;
}

function buildFrontdoorDag(includeMediator = true): CausalGraph {
  const graph = new CausalGraph(
    [
      { id: "X" },
      { id: "Y" },
      ...(includeMediator ? [{ id: "M" }] : []),
      { id: "U", nodeType: NODE_TYPE.latent }
    ],
    { kind: GRAPH_KIND.dag }
  );
  graph.addDirectedEdge("U", "X");
  graph.addDirectedEdge("U", "Y");
  graph.addDirectedEdge("X", "Y");
  if (includeMediator) {
    graph.removeEdge("X", "Y");
    graph.addDirectedEdge("X", "M");
    graph.addDirectedEdge("M", "Y");
  }
  return graph;
}

function buildChainData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const x = Math.sin(t / 4) + Math.cos(t / 15);
    const z = 0.9 * x + Math.sin(t / 9) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, z, y];
  });

  return new DenseMatrix(rows);
}

function buildDiscreteCommonCauseData(sampleSize: number): DenseMatrix {
  const fractional = (value: number) => value - Math.floor(value);
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = index % 2;
    const noiseX = fractional(t * 0.61803398875) < 0.2 ? 1 : 0;
    const noiseY = fractional(t * 0.41421356237) < 0.3 ? 1 : 0;
    const x = z ^ noiseX;
    const y = z ^ noiseY;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

function buildCommonCauseData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 8) + Math.cos(t / 13);
    const x = 0.9 * z + Math.sin(t / 5) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

function buildMultipleMinimalSetDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "Z1", "Z2"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("X", "Y");
  graph.addDirectedEdge("Z2", "Z1");
  graph.addDirectedEdge("Z1", "X");
  graph.addDirectedEdge("Z2", "Y");
  return graph;
}

class StrictCiTest implements ConditionalIndependenceTest {
  readonly name = "strict-ci";

  constructor(private readonly data: DenseMatrix, private readonly mode?: "ready") {
    if (mode !== "ready") {
      throw new Error("StrictCiTest requires an explicit mode.");
    }
  }

  test(x: number, y: number, conditioningSet?: readonly number[]): number {
    return this.data.rows > 0 && x !== y && (conditioningSet?.length ?? 0) >= 0 ? 0.5 : 0;
  }
}

function expectNarrativeContract(result: TaskResultBase): void {
  expect(result.assumptions.length).toBeGreaterThan(0);
  expect(result.limitations.length).toBeGreaterThan(0);
  expect(result.caveats.length).toBeGreaterThan(0);
  for (const field of [result.assumptions, result.limitations, result.caveats]) {
    expect(field.every((entry) => typeof entry === "string" && entry.trim().length > 0)).toBe(true);
  }
}

function expectDiscoverContract(result: DiscoverGraphResult): void {
  expectNarrativeContract(result);
  expect(result.graph.nodes.length).toBe(result.summary.nodeCount);
  expect(result.graph.edges.length).toBe(result.summary.edgeCount);
  expect(result.artifacts[result.primaryGraphField]).toEqual(result.graph);
}

function expectAdjustmentContract(result: FindAdjustmentSetsResult): void {
  expectNarrativeContract(result);
  expect(result.validAdjustmentSetCount).toBeGreaterThanOrEqual(result.minimalAdjustmentSetCount);
  for (const candidate of result.candidateSets) {
    expect(candidate.witness.conditioningSet).toEqual(candidate.variables);
    expect(candidate.witness.forbiddenNodeIds.length).toBeGreaterThanOrEqual(candidate.forbiddenDescendants.length);
  }
}

function expectAdjustmentCheckContract(result: IsAdjustmentSetResult): void {
  expectNarrativeContract(result);
  expect(result.adjustmentSet).toEqual(result.candidate.variables);
  expect(result.valid).toBe(result.candidate.valid);
  expect(result.candidate.witness.conditioningSet).toEqual(result.candidate.variables);
}

function expectIdentificationContract(result: IdentifyEffectResult): void {
  expectNarrativeContract(result);
  expect(["dag-first-mvp", "dag-backdoor-only"]).toContain(result.backend);
  expect(result.nextAction.trim().length).toBeGreaterThan(0);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(
    result.diagnostics.every(
      (entry) =>
        entry.summary.trim().length > 0 &&
        Array.isArray(entry.details) &&
        Array.isArray(entry.witness ? Object.keys(entry.witness) : [])
    )
  ).toBe(true);

  if (!result.identifiable) {
    expect(result.method).toBe("non-identifiable");
    expect(result.estimand).toBeNull();
    expect(result.estimandSpec).toBeNull();
    expect(result.witness).toEqual({});
    expect(result.diagnostics.some((entry) => entry.strategy === "frontdoor")).toBe(true);
    return;
  }

  expect(result.estimand?.trim().length ?? 0).toBeGreaterThan(0);
  expect(result.estimandSpec).not.toBeNull();

  if (result.method === "zero-effect") {
    expect(result.witness).toEqual({});
    expect(result.estimandSpec?.strategy).toBe("zero-effect");
    return;
  }

  if (result.method === "backdoor") {
    expect(result.witness.adjustmentSet).toBeDefined();
    expect(result.estimandSpec?.strategy).toBe("backdoor");
    return;
  }

  if (result.method === "frontdoor") {
    expect(result.witness.mediators).toBeDefined();
    expect(result.estimandSpec?.strategy).toBe("frontdoor");
  }
}

function expectFalsificationContract(result: FalsifyGraphResult): void {
  expectNarrativeContract(result);
  expect(result.overallSummary.testedCount).toBe(result.testedImplications.length);
  expect(result.overallSummary.failedCount).toBe(result.failedImplications.length);
  expect(result.overallSummary.inconclusiveCount).toBe(result.inconclusiveImplications.length);
  expect(
    result.failedImplications.every((implication) => result.testedImplications.includes(implication))
  ).toBe(true);
  expect(
    result.inconclusiveImplications.every((implication) => result.testedImplications.includes(implication))
  ).toBe(true);
  if (result.overallSummary.falsified === true) {
    expect(result.failedImplications.length).toBeGreaterThan(0);
  }
}

function expectStabilityContract(result: StabilityAnalysisResult): void {
  expectNarrativeContract(result);
  expect(result.runSummaries).toHaveLength(result.bootstrapConfig.bootstrapSamples);
  expect(
    result.edgeFrequency.every(
      (entry) =>
        entry.adjacencyFrequency >= 0 &&
        entry.adjacencyFrequency <= 1 &&
        entry.absenceFrequency >= 0 &&
        entry.absenceFrequency <= 1
    )
  ).toBe(true);
  expect(
    result.orientationStability.every((entry) => entry.presentFrequency >= 0 && entry.presentFrequency <= 1)
  ).toBe(true);
}

describe("task-oriented workflow", () => {
  it("wraps discovery results with a structured task result", () => {
    const data = buildCommonCauseData(200);
    const result = discoverGraph({
      algorithm: "pc",
      options: {
        data,
        ciTest: new FisherZTest(data),
        nodeLabels: ["X", "Y", "Z"],
        alpha: 0.05
      }
    });

    expect(result.task).toBe("discoverGraph");
    expect(result.algorithm).toBe("pc");
    expect(result.primaryGraphField).toBe("graph");
    expect(result.summary.edgeCount).toBeGreaterThan(0);
    expectDiscoverContract(result);
  });

  it("finds a minimal backdoor adjustment set and rejects forbidden descendants", () => {
    const graph = buildConfoundedDag();

    const adjustment = findAdjustmentSets({
      graph: graph.toShape(),
      treatment: "X",
      outcome: "Y"
    });

    expect(adjustment.validAdjustmentSetCount).toBeGreaterThan(0);
    expect(adjustment.candidateSets).toContainEqual(
      expect.objectContaining({
        variables: ["Z"],
        valid: true,
        minimal: true
      })
    );

    const mediatorGraph = CausalGraph.fromNodeIds(["X", "Y", "Z", "M"], { kind: GRAPH_KIND.dag });
    mediatorGraph.addDirectedEdge("Z", "X");
    mediatorGraph.addDirectedEdge("Z", "Y");
    mediatorGraph.addDirectedEdge("X", "M");
    mediatorGraph.addDirectedEdge("M", "Y");

    const invalid = isAdjustmentSet({
      graph: mediatorGraph.toShape(),
      treatment: "X",
      outcome: "Y",
      adjustmentSet: ["M"]
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.candidate.forbiddenDescendants).toContain("M");
    expectAdjustmentCheckContract(invalid);
  });

  it("covers empty, multiple-minimal, canonical, and latent-node adjustment cases", () => {
    const unconfounded = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.dag });
    unconfounded.addDirectedEdge("X", "Y");
    const empty = findAdjustmentSets({
      graph: unconfounded.toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(empty.candidateSets).toContainEqual(
      expect.objectContaining({
        variables: [],
        valid: true,
        minimal: true
      })
    );

    const multipleMinimal = findAdjustmentSets({
      graph: buildMultipleMinimalSetDag().toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(multipleMinimal.candidateSets).toContainEqual(
      expect.objectContaining({
        variables: ["Z1"],
        minimal: true
      })
    );
    expect(multipleMinimal.candidateSets).toContainEqual(
      expect.objectContaining({
        variables: ["Z2"],
        minimal: true
      })
    );
    expect(multipleMinimal.canonicalSet).toEqual(["Z1", "Z2"]);

    const graphWithLatent = new CausalGraph(
      [
        { id: "X" },
        { id: "Y" },
        { id: "Z" },
        { id: "L", nodeType: NODE_TYPE.latent },
        { id: "S", nodeType: NODE_TYPE.selection }
      ],
      { kind: GRAPH_KIND.dag }
    );
    graphWithLatent.addDirectedEdge("L", "X");
    graphWithLatent.addDirectedEdge("L", "Y");
    graphWithLatent.addDirectedEdge("S", "X");
    graphWithLatent.addDirectedEdge("Z", "X");
    graphWithLatent.addDirectedEdge("Z", "Y");
    graphWithLatent.addDirectedEdge("X", "Y");
    const latentFiltered = findAdjustmentSets({
      graph: graphWithLatent.toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(
      latentFiltered.candidateSets.every(
        (candidate) => !candidate.variables.includes("L") && !candidate.variables.includes("S")
      )
    ).toBe(true);
    expectAdjustmentContract(multipleMinimal);
    expectAdjustmentContract(latentFiltered);
  });

  it("identifies backdoor, frontdoor, and current non-identifiable cases", () => {
    const backdoor = identifyEffect({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(backdoor.identifiable).toBe(true);
    expect(backdoor.method).toBe("backdoor");
    expect(backdoor.backend).toBe("dag-first-mvp");
    expect(backdoor.witness.adjustmentSet).toEqual(["Z"]);
    expect(backdoor.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "backdoor",
        status: "identified",
        witness: { adjustmentSet: ["Z"] }
      })
    );
    expect(backdoor.estimand).toBe("P(Y | do(X)) = Σ_Z P(Y | X, Z) P(Z)");
    expect(backdoor.estimandSpec).toMatchObject({
      strategy: "backdoor",
      query: "P(Y | do(X))",
      summary: expect.stringContaining("{Z}"),
      expression: "P(Y | do(X)) = Σ_Z P(Y | X, Z) P(Z)",
      expressionTree: {
        type: "sum",
        variables: ["Z"],
        expression: {
          type: "product",
          factors: [
            {
              type: "probability",
              variables: ["Y"],
              conditionedOn: ["X", "Z"]
            },
            {
              type: "probability",
              variables: ["Z"],
              conditionedOn: []
            }
          ]
        }
      },
      summationVariables: ["Z"],
      factors: [
        {
          kind: "outcome-regression",
          expression: "P(Y | X, Z)",
          variables: ["Y"],
          conditionedOn: ["X", "Z"]
        },
        {
          kind: "covariate-distribution",
          expression: "P(Z)",
          variables: ["Z"],
          conditionedOn: []
        }
      ]
    });

    const frontdoor = identifyEffect({
      graph: buildFrontdoorDag(true).toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(frontdoor.identifiable).toBe(true);
    expect(frontdoor.method).toBe("frontdoor");
    expect(frontdoor.witness.mediators).toEqual(["M"]);
    expect(frontdoor.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "backdoor",
        status: "not-identified"
      })
    );
    expect(frontdoor.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "frontdoor",
        status: "identified",
        witness: { mediators: ["M"] }
      })
    );
    expect(frontdoor.estimandSpec).toMatchObject({
      strategy: "frontdoor",
      query: "P(Y | do(X))",
      expression: "P(Y | do(X)) = Σ_M P(M | X) Σ_X' P(Y | M, X') P(X')",
      expressionTree: {
        type: "sum",
        variables: ["M"],
        expression: {
          type: "product",
          factors: [
            {
              type: "probability",
              variables: ["M"],
              conditionedOn: ["X"]
            },
            {
              type: "sum",
              variables: ["X'"],
              expression: {
                type: "product",
                factors: [
                  {
                    type: "probability",
                    variables: ["Y"],
                    conditionedOn: ["M", "X'"]
                  },
                  {
                    type: "probability",
                    variables: ["X'"],
                    conditionedOn: []
                  }
                ]
              }
            }
          ]
        }
      },
      summationVariables: ["M", "X'"],
      factors: [
        {
          kind: "mediator-distribution",
          expression: "P(M | X)",
          variables: ["M"],
          conditionedOn: ["X"]
        },
        {
          kind: "outcome-regression",
          expression: "P(Y | M, X')",
          variables: ["Y"],
          conditionedOn: ["M", "X'"]
        },
        {
          kind: "treatment-distribution",
          expression: "P(X')",
          variables: ["X'"],
          conditionedOn: []
        }
      ]
    });

    const nonIdentifiable = identifyEffect({
      graph: buildFrontdoorDag(false).toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(nonIdentifiable.identifiable).toBe(false);
    expect(nonIdentifiable.method).toBe("non-identifiable");
    expect(nonIdentifiable.estimandSpec).toBeNull();
    expect(nonIdentifiable.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "scope",
        status: "not-applicable"
      })
    );
    expectIdentificationContract(backdoor);
    expectIdentificationContract(frontdoor);
    expectIdentificationContract(nonIdentifiable);
  });

  it("keeps the DAG-first identification backend runner stable", () => {
    const backdoor = runDagFirstIdentificationBackend({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(backdoor.evaluation.identified).toBe(true);
    expect(backdoor.evaluation.method).toBe("backdoor");
    expect(backdoor.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "backdoor",
        status: "identified"
      })
    );

    const nonIdentifiable = runDagFirstIdentificationBackend({
      graph: buildFrontdoorDag(false).toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(nonIdentifiable.evaluation.identified).toBe(false);
    expect(nonIdentifiable.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "scope",
        status: "not-applicable"
      })
    );
  });

  it("resolves and runs identification backends through the registry contract", () => {
    expect(listIdentificationBackends()).toEqual(["dag-first-mvp", "dag-backdoor-only"]);
    expect(listIdentificationBackendDescriptors()).toMatchObject([
      {
        id: "dag-first-mvp",
        label: "DAG-First MVP",
        status: "available",
        graphKinds: ["dag"],
        supportedMethods: ["zero-effect", "backdoor", "frontdoor"],
        queryShape: "singleton-treatment-singleton-outcome",
        defaultForAuto: true,
        summary: expect.stringContaining("DAG-first"),
        limitations: expect.any(Array)
      },
      {
        id: "dag-backdoor-only",
        label: "DAG Backdoor Only",
        status: "available",
        graphKinds: ["dag"],
        supportedMethods: ["zero-effect", "backdoor"],
        queryShape: "singleton-treatment-singleton-outcome",
        defaultForAuto: false,
        summary: expect.stringContaining("backdoor"),
        limitations: expect.any(Array)
      }
    ]);
    expect(getIdentificationBackendDescriptor("dag-first-mvp")).toMatchObject({
      id: "dag-first-mvp",
      defaultForAuto: true
    });
    expect(getIdentificationBackendDescriptor("dag-backdoor-only")).toMatchObject({
      id: "dag-backdoor-only",
      defaultForAuto: false
    });
    expect(resolveIdentificationBackend()).toBe("dag-first-mvp");
    expect(resolveIdentificationBackend("auto", { graph: buildConfoundedDag().toShape() })).toBe("dag-first-mvp");
    expect(resolveIdentificationBackend("dag-first-mvp")).toBe("dag-first-mvp");
    expect(resolveIdentificationBackend("dag-backdoor-only")).toBe("dag-backdoor-only");

    const registryRun = runIdentificationBackend(
      {
        graph: buildConfoundedDag().toShape(),
        treatment: "X",
        outcome: "Y"
      },
      "dag-first-mvp"
    );

    expect(registryRun.backend).toBe("dag-first-mvp");
    expect(registryRun.evaluation.identified).toBe(true);
    expect(registryRun.evaluation.method).toBe("backdoor");
    expect(registryRun.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "backdoor",
        status: "identified"
      })
    );

    const explicitBackend = identifyEffect({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y",
      backend: "dag-first-mvp"
    });

    expect(explicitBackend.backend).toBe("dag-first-mvp");
    expect(explicitBackend.method).toBe("backdoor");
    expectIdentificationContract(explicitBackend);
  });

  it("supports a conservative dag-backdoor-only backend", () => {
    const backdoor = identifyEffect({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y",
      backend: "dag-backdoor-only"
    });
    expect(backdoor.backend).toBe("dag-backdoor-only");
    expect(backdoor.identifiable).toBe(true);
    expect(backdoor.method).toBe("backdoor");
    expect(backdoor.assumptions.some((entry) => entry.includes("DAG Backdoor Only"))).toBe(true);

    const frontdoorBlocked = identifyEffect({
      graph: buildFrontdoorDag(true).toShape(),
      treatment: "X",
      outcome: "Y",
      backend: "dag-backdoor-only"
    });
    expect(frontdoorBlocked.backend).toBe("dag-backdoor-only");
    expect(frontdoorBlocked.identifiable).toBe(false);
    expect(frontdoorBlocked.method).toBe("non-identifiable");
    expect(frontdoorBlocked.nextAction).toContain("dag-first-mvp");
    expect(frontdoorBlocked.diagnostics).toContainEqual(
      expect.objectContaining({
        strategy: "frontdoor",
        status: "not-applicable",
        summary: expect.stringContaining("disabled")
      })
    );
    expectIdentificationContract(backdoor);
    expectIdentificationContract(frontdoorBlocked);
  });

  it("covers zero-effect and keeps identification result schema stable", () => {
    const disconnected = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
    disconnected.addDirectedEdge("Z", "Y");

    const result = identifyEffect({
      graph: disconnected.toShape(),
      treatment: "X",
      outcome: "Y"
    });

    expect(result.method).toBe("zero-effect");
    expect(result.identifiable).toBe(true);
    expect(result).toMatchObject({
      task: "identifyEffect",
      graphKind: "dag",
      treatment: "X",
      outcome: "Y",
      backend: "dag-first-mvp",
      estimand: expect.stringContaining("structurally zero"),
      estimandSpec: {
        strategy: "zero-effect",
        query: "P(Y | do(X))",
        summary: expect.stringContaining("No directed path"),
        expression: "P(Y | do(X)) = 0",
        expressionTree: {
          type: "constant",
          value: "0"
        },
        summationVariables: [],
        factors: [
          {
            kind: "zero",
            expression: "0",
            variables: ["Y"],
            conditionedOn: ["X"]
          }
        ]
      },
      witness: {},
      diagnostics: expect.any(Array),
      assumptions: expect.any(Array),
      limitations: expect.any(Array),
      caveats: expect.any(Array),
      nextAction: expect.any(String)
    });
    expectIdentificationContract(result);
  });

  it("runs DAG sanity checks and implied conditional independence tests for falsification", () => {
    const chainGraph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
    chainGraph.addDirectedEdge("X", "Z");
    chainGraph.addDirectedEdge("Z", "Y");
    const chainData = buildChainData(240);

    const passed = falsifyGraph({
      graph: chainGraph.toShape(),
      data: chainData
    });

    expect(passed.graphValidity.valid).toBe(true);
    expect(passed.testedImplications).toHaveLength(1);
    expect(passed.failedImplications).toHaveLength(0);
    expect(passed.overallSummary.falsified).toBe(false);

    const colliderGraph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
    colliderGraph.addDirectedEdge("X", "Z");
    colliderGraph.addDirectedEdge("Y", "Z");
    const failed = falsifyGraph({
      graph: colliderGraph.toShape(),
      data: buildCommonCauseData(240),
      observedNodeOrder: ["X", "Y", "Z"]
    });

    expect(failed.failedImplications.length).toBeGreaterThan(0);
    expect(failed.overallSummary.falsified).toBe(true);
    expectFalsificationContract(passed);
    expectFalsificationContract(failed);
  });

  it("reports unsupported DAG checks structurally and infers default CI strategy", () => {
    const cpdag = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.cpdag });
    cpdag.addUndirectedEdge("X", "Y");
    const unsupported = falsifyGraph({
      graph: cpdag.toShape()
    });
    expect(unsupported.graphValidity.dagSupported).toBe(false);
    expect(unsupported.overallSummary.falsified).toBeNull();

    const discrete = falsifyGraph({
      graph: buildConfoundedDag().toShape(),
      data: buildDiscreteCommonCauseData(400),
      observedNodeOrder: ["X", "Y", "Z"]
    });
    expect(discrete.assumptions.some((entry) => entry.includes("chisq"))).toBe(true);
    expectFalsificationContract(unsupported);
    expectFalsificationContract(discrete);
  });

  it("rejects invalid falsification input contracts explicitly", () => {
    const graphWithLatent = new CausalGraph(
      [
        { id: "X" },
        { id: "Y" },
        { id: "Z" },
        { id: "L", nodeType: NODE_TYPE.latent }
      ],
      { kind: GRAPH_KIND.dag }
    );
    graphWithLatent.addDirectedEdge("Z", "X");
    graphWithLatent.addDirectedEdge("Z", "Y");
    graphWithLatent.addDirectedEdge("X", "Y");
    graphWithLatent.addDirectedEdge("L", "X");

    expect(() =>
      falsifyGraph({
        graph: buildConfoundedDag().toShape(),
        data: buildCommonCauseData(120),
        observedNodeOrder: ["X", "X", "Z"]
      })
    ).toThrow(/duplicate node/i);

    expect(() =>
      falsifyGraph({
        graph: graphWithLatent.toShape(),
        data: buildCommonCauseData(120),
        observedNodeOrder: ["X", "Y", "L"]
      })
    ).toThrow(/measured nodes/i);

    expect(() =>
      falsifyGraph({
        graph: buildConfoundedDag().toShape(),
        data: buildCommonCauseData(120),
        alpha: 1
      })
    ).toThrow(/\(0, 1\)/);
  });

  it("keeps falsification implication schema stable", () => {
    const chainGraph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
    chainGraph.addDirectedEdge("X", "Z");
    chainGraph.addDirectedEdge("Z", "Y");
    const result = falsifyGraph({
      graph: chainGraph.toShape(),
      data: buildChainData(240)
    });

    expect(result).toMatchObject({
      task: "falsifyGraph",
      graphKind: "dag",
      graphValidity: {
        valid: true,
        dagSupported: true,
        issues: expect.any(Array)
      },
      impliedConditionalIndependences: expect.any(Array),
      testedImplications: expect.any(Array),
      failedImplications: expect.any(Array),
      inconclusiveImplications: expect.any(Array),
      overallSummary: {
        testedCount: expect.any(Number),
        passedCount: expect.any(Number),
        failedCount: expect.any(Number),
        inconclusiveCount: expect.any(Number),
        falsified: expect.any(Boolean)
      }
    });
    expectFalsificationContract(result);
  });

  it("reports deterministic bootstrap stability summaries for discovery wrappers", () => {
    const data = buildCommonCauseData(240);
    const result = stabilityAnalysis({
      discovery: {
        algorithm: "pc",
        options: {
          data,
          ciTest: new FisherZTest(data),
          nodeLabels: ["X", "Y", "Z"],
          alpha: 0.05
        }
      },
      bootstrapSamples: 6,
      sampleFraction: 0.8,
      seed: 42,
      consensusThreshold: 0.6
    });

    expect(result.runSummaries).toHaveLength(6);
    expect(result.edgeFrequency).toHaveLength(3);
    expect(result.orientationStability).toHaveLength(3);
    expect(result.consensusGraph?.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "tail" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "tail" }
    ]);
    expectStabilityContract(result);
  });

  it("is reproducible under the same seed and supports createDiscoveryOptions fallback", () => {
    const data = buildCommonCauseData(240);
    const first = stabilityAnalysis({
      discovery: {
        algorithm: "pc",
        options: {
          data,
          ciTest: new FisherZTest(data),
          nodeLabels: ["X", "Y", "Z"],
          alpha: 0.05
        }
      },
      bootstrapSamples: 6,
      sampleFraction: 0.8,
      seed: 42,
      consensusThreshold: 0.6
    });
    const second = stabilityAnalysis({
      discovery: {
        algorithm: "pc",
        options: {
          data,
          ciTest: new FisherZTest(data),
          nodeLabels: ["X", "Y", "Z"],
          alpha: 0.05
        }
      },
      bootstrapSamples: 6,
      sampleFraction: 0.8,
      seed: 42,
      consensusThreshold: 0.6
    });
    expect(second.edgeFrequency).toEqual(first.edgeFrequency);
    expect(second.orientationStability).toEqual(first.orientationStability);
    expect(second.consensusGraph).toEqual(first.consensusGraph);

    const strictData = buildCommonCauseData(120);
    expect(() =>
      stabilityAnalysis({
        discovery: {
          algorithm: "pc",
          options: {
            data: strictData,
            ciTest: new StrictCiTest(strictData, "ready"),
            nodeLabels: ["X", "Y", "Z"],
            alpha: 0.05
          }
        },
        bootstrapSamples: 2,
        seed: 1
      })
    ).toThrow(/createDiscoveryOptions/);

    const recovered = stabilityAnalysis({
      discovery: {
        algorithm: "pc",
        options: {
          data: strictData,
          ciTest: new StrictCiTest(strictData, "ready"),
          nodeLabels: ["X", "Y", "Z"],
          alpha: 0.05
        }
      },
      bootstrapSamples: 2,
      seed: 1,
      createDiscoveryOptions: (resampledData) => ({
        data: resampledData,
        ciTest: new StrictCiTest(resampledData as DenseMatrix, "ready"),
        nodeLabels: ["X", "Y", "Z"],
        alpha: 0.05
      })
    });
    expect(recovered.runSummaries).toHaveLength(2);
    expectStabilityContract(recovered);
  });

  it("rejects invalid stability bootstrap contracts explicitly", () => {
    const data = buildCommonCauseData(120);
    const discovery = {
      algorithm: "pc" as const,
      options: {
        data,
        ciTest: new FisherZTest(data),
        nodeLabels: ["X", "Y", "Z"],
        alpha: 0.05
      }
    };

    expect(() =>
      stabilityAnalysis({
        discovery,
        bootstrapSamples: 0
      })
    ).toThrow(/positive integer/i);

    expect(() =>
      stabilityAnalysis({
        discovery,
        sampleFraction: 0
      })
    ).toThrow(/\(0, 1\]/);

    expect(() =>
      stabilityAnalysis({
        discovery,
        consensusThreshold: 1.2
      })
    ).toThrow(/\[0, 1\]/);

    expect(() =>
      stabilityAnalysis({
        discovery,
        seed: 1.5
      })
    ).toThrow(/seed must be an integer/i);

    const empty = {
      rows: 0,
      columns: 1,
      row: () => [0],
      column: () => [],
      toArray: () => []
    } as unknown as NumericMatrix;
    expect(() =>
      stabilityAnalysis({
        discovery: {
          algorithm: "gin",
          options: {
            data: empty,
            indepTestMethod: "kci",
            alpha: 0.05
          }
        }
      })
    ).toThrow(/at least one row and one column/i);
  });

  it("keeps workflow result schemas stable", () => {
    const data = buildCommonCauseData(200);
    const discovery = discoverGraph({
      algorithm: "pc",
      options: {
        data,
        ciTest: new FisherZTest(data),
        nodeLabels: ["X", "Y", "Z"],
        alpha: 0.05
      }
    });
    expect(discovery).toMatchObject({
      task: "discoverGraph",
      algorithm: "pc",
      graphKind: expect.any(String),
      graph: { nodes: expect.any(Array), edges: expect.any(Array) },
      artifacts: expect.any(Object),
      summary: {
        nodeCount: expect.any(Number),
        edgeCount: expect.any(Number)
      },
      assumptions: expect.any(Array),
      limitations: expect.any(Array),
      caveats: expect.any(Array)
    });
    expectDiscoverContract(discovery);

    const adjustment = findAdjustmentSets({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expect(adjustment).toMatchObject({
      task: "findAdjustmentSets",
      graphKind: "dag",
      graphType: "dag",
      candidateSets: expect.any(Array),
      canonicalSet: expect.any(Array),
      validAdjustmentSetCount: expect.any(Number),
      minimalAdjustmentSetCount: expect.any(Number)
    });
    expectAdjustmentContract(adjustment);

    const adjustmentCheck = isAdjustmentSet({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y",
      adjustmentSet: ["Z"]
    });
    expectAdjustmentCheckContract(adjustmentCheck);

    const identified = identifyEffect({
      graph: buildConfoundedDag().toShape(),
      treatment: "X",
      outcome: "Y"
    });
    expectIdentificationContract(identified);

    const falsified = falsifyGraph({
      graph: buildConfoundedDag().toShape(),
      data,
      observedNodeOrder: ["X", "Y", "Z"]
    });
    expectFalsificationContract(falsified);

    const stability = stabilityAnalysis({
      discovery: {
        algorithm: "pc",
        options: {
          data,
          ciTest: new FisherZTest(data),
          nodeLabels: ["X", "Y", "Z"],
          alpha: 0.05
        }
      },
      bootstrapSamples: 3,
      seed: 7
    });
    expect(stability).toMatchObject({
      task: "stabilityAnalysis",
      algorithm: "pc",
      primaryGraphField: "graph",
      bootstrapConfig: {
        bootstrapSamples: 3,
        sampleFraction: expect.any(Number),
        replace: expect.any(Boolean),
        seed: 7,
        consensusThreshold: expect.any(Number)
      },
      runSummaries: expect.any(Array),
      edgeFrequency: expect.any(Array),
      orientationStability: expect.any(Array)
    });
    expectStabilityContract(stability);
  });
});
