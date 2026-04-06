import {
  CausalGraph,
  DenseMatrix,
  FisherZTest,
  GRAPH_KIND,
  discoverGraph,
  falsifyGraph,
  findAdjustmentSets,
  identifyEffect,
  listIdentificationBackendDescriptors,
  stabilityAnalysis
} from "@kanaries/causal";

export interface Step3WorkflowExampleResult {
  graph: CausalGraph;
  data: DenseMatrix;
  discovered: ReturnType<typeof discoverGraph>;
  adjustment: ReturnType<typeof findAdjustmentSets>;
  identified: ReturnType<typeof identifyEffect>;
  identificationBackends: ReturnType<typeof listIdentificationBackendDescriptors>;
  falsified: ReturnType<typeof falsifyGraph>;
  stability: ReturnType<typeof stabilityAnalysis>;
}

function buildExampleData(sampleSize: number): DenseMatrix {
  return new DenseMatrix(
    Array.from({ length: sampleSize }, (_, index) => {
      const t = index + 1;
      const z = Math.sin(t / 8) + Math.cos(t / 13);
      const x = 0.9 * z + Math.sin(t / 5) * 0.03;
      const y = -0.8 * z + Math.cos(t / 7) * 0.03;
      return [x, y, z];
    })
  );
}

export function runStep3TaskWorkflowExample(): Step3WorkflowExampleResult {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");

  const data = buildExampleData(200);
  const nodeLabels = ["X", "Y", "Z"];

  const discovered = discoverGraph({
    algorithm: "pc",
    options: {
      data,
      ciTest: new FisherZTest(data),
      nodeLabels,
      alpha: 0.05
    }
  });

  const adjustment = findAdjustmentSets({
    graph: graph.toShape(),
    treatment: "X",
    outcome: "Y"
  });

  const identified = identifyEffect({
    graph: graph.toShape(),
    treatment: "X",
    outcome: "Y"
  });
  const identificationBackends = listIdentificationBackendDescriptors();

  const falsified = falsifyGraph({
    graph: graph.toShape(),
    data,
    observedNodeOrder: nodeLabels
  });

  const stability = stabilityAnalysis({
    discovery: {
      algorithm: "pc",
      options: {
        data,
        ciTest: new FisherZTest(data),
        nodeLabels,
        alpha: 0.05
      }
    },
    bootstrapSamples: 10,
    seed: 42
  });

  return {
    graph,
    data,
    discovered,
    adjustment,
    identified,
    identificationBackends,
    falsified,
    stability
  };
}
