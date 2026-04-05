import { CausalGraph, dagToCpdag as dagToCpdagCore } from "@causal-js/core";

export function dagToCpdag(graph: CausalGraph): CausalGraph {
  return CausalGraph.fromShape(dagToCpdagCore(graph).toShape());
}
