import { CausalGraph, GRAPH_KIND, identifyById, identifyEffect } from "@kanaries/causal";

export function runIdIdentificationExample() {
  const frontdoor = CausalGraph.fromNodeIds(["X", "M", "Y"], { kind: GRAPH_KIND.admg });
  frontdoor.addDirectedEdge("X", "M");
  frontdoor.addDirectedEdge("M", "Y");
  frontdoor.addBidirectedEdge("X", "Y");

  const identified = identifyEffect({
    graph: frontdoor.toShape(), treatment: "X", outcome: "Y", backend: "id"
  });
  const jointOutcome = identifyById({
    graph: frontdoor.toShape(), treatment: ["X"], outcome: ["M", "Y"]
  });

  const bow = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
  bow.addDirectedEdge("X", "Y");
  bow.addBidirectedEdge("X", "Y");
  const nonIdentifiable = identifyEffect({ graph: bow.toShape(), treatment: "X", outcome: "Y" });

  return { identified, jointOutcome, nonIdentifiable, bowEdges: bow.getEdgesBetween("X", "Y") };
}
