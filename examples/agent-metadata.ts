import {
  CausalGraph,
  GRAPH_KIND,
  describeAlgorithm,
  describeTask,
  falsifyGraph,
  getDiagnosticSummary,
  identifyEffect,
  listTaskValidationEvidence
} from "@kanaries/causal";

export function runAgentMetadataExample() {
  const graph = CausalGraph.fromNodeIds(["Z", "X", "Y"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");

  const identified = identifyEffect({
    graph: graph.toShape(),
    treatment: "X",
    outcome: "Y"
  });
  const structuralCheck = falsifyGraph({ graph: graph.toShape() });

  return {
    algorithm: describeAlgorithm("pc"),
    task: describeTask("identifyEffect"),
    identified,
    structuralCheck,
    diagnosticSummary: getDiagnosticSummary(structuralCheck.agent.diagnostics),
    evidence: listTaskValidationEvidence("identifyEffect")
  };
}
