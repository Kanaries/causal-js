import type { EdgeDescriptor, GraphShape } from "@causal-js/core";
import { probabilityNode, productNode, quotientNode, sumNode } from "./expressions";
import type { IdentificationExpressionNode } from "./types";

export interface IdOptions {
  graph: GraphShape;
  treatment: readonly string[];
  outcome: readonly string[];
}

/** A recursive application of one of the seven steps in the ID algorithm. */
export interface IdTraceStep {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  depth: number;
  vertices: string[];
  treatment: string[];
  outcome: string[];
  detail: string;
  selectedNodes?: string[];
  districts?: string[][];
}

/**
 * The two induced subgraphs at ID's FAIL(G, S) call. They contain a hedge,
 * but are not claimed to be the pruned C-forests in the definition of a hedge.
 */
export interface IdFailureWitness {
  graph: GraphShape;
  district: GraphShape;
  treatment: string[];
  outcome: string[];
  reason: string;
}

export type IdResult = {
  identified: true;
  expressionTree: IdentificationExpressionNode;
  trace: IdTraceStep[];
  topologicalOrder: string[];
} | {
  identified: false;
  expressionTree: null;
  trace: IdTraceStep[];
  topologicalOrder: string[];
  idFailureWitness: IdFailureWitness;
};

interface IdGraph {
  // Every induced subgraph retains the original topological order.
  vertices: string[];
  directed: [string, string][];
  bidirected: [string, string][];
}

function subset(values: readonly string[], allowed: ReadonlySet<string>): string[] {
  return values.filter((value) => allowed.has(value));
}

function difference(values: readonly string[], excluded: readonly string[]): string[] {
  const excludedSet = new Set(excluded);
  return values.filter((value) => !excludedSet.has(value));
}

function induced(graph: IdGraph, vertices: readonly string[]): IdGraph {
  const included = new Set(vertices);
  return {
    vertices: subset(graph.vertices, included),
    directed: graph.directed.filter(([a, b]) => included.has(a) && included.has(b)),
    bidirected: graph.bidirected.filter(([a, b]) => included.has(a) && included.has(b))
  };
}

function ancestors(graph: IdGraph, outcome: readonly string[], intervention: readonly string[] = []): string[] {
  const interventionSet = new Set(intervention);
  const found = new Set(outcome);
  const pending = [...outcome];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (interventionSet.has(node)) continue;
    for (const [parent, child] of graph.directed) {
      if (child === node && !found.has(parent)) {
        found.add(parent);
        pending.push(parent);
      }
    }
  }
  return subset(graph.vertices, found);
}

function districts(graph: IdGraph): string[][] {
  const visited = new Set<string>();
  const result: string[][] = [];
  for (const vertex of graph.vertices) {
    if (visited.has(vertex)) continue;
    const component = new Set([vertex]);
    const pending = [vertex];
    visited.add(vertex);
    while (pending.length > 0) {
      const node = pending.pop()!;
      for (const [a, b] of graph.bidirected) {
        const neighbor = a === node ? b : b === node ? a : undefined;
        if (neighbor !== undefined && !visited.has(neighbor)) {
          component.add(neighbor);
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    result.push(subset(graph.vertices, component));
  }
  return result;
}

function graphShape(graph: IdGraph): GraphShape {
  return {
    version: 1,
    kind: graph.bidirected.length === 0 ? "dag" : "admg",
    nodes: graph.vertices.map((id) => ({ id, nodeType: "measured" })),
    edges: [
      ...graph.directed.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "tail", endpoint2: "arrow" })),
      ...graph.bidirected.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "arrow", endpoint2: "arrow" }))
    ]
  };
}

function parseGraph(shape: GraphShape): IdGraph {
  if (shape.kind !== undefined && shape.kind !== "dag" && shape.kind !== "admg" && shape.kind !== "generic") {
    throw new Error("ID requires a DAG or ADMG with fully specified directed and bidirected edges.");
  }
  const vertices = shape.nodes.map((node) => node.id);
  if (vertices.some((id) => typeof id !== "string" || id.length === 0) || new Set(vertices).size !== vertices.length) {
    throw new Error("ID requires unique, nonempty node identifiers.");
  }
  if (shape.nodes.some((node) => node.nodeType !== undefined && node.nodeType !== "measured")) {
    throw new Error("ID requires fully observed vertices; encode hidden common causes using bidirected edges in a latent projection.");
  }
  const known = new Set(vertices);
  const directed: [string, string][] = [];
  const bidirected: [string, string][] = [];
  const edgeKeys = new Set<string>();
  for (const edge of shape.edges) {
    if (!known.has(edge.node1) || !known.has(edge.node2) || edge.node1 === edge.node2) {
      throw new Error("ID graph edges must connect two distinct existing vertices.");
    }
    let pair: [string, string];
    let kind: "directed" | "bidirected";
    if (edge.endpoint1 === "tail" && edge.endpoint2 === "arrow") {
      pair = [edge.node1, edge.node2]; kind = "directed";
    } else if (edge.endpoint1 === "arrow" && edge.endpoint2 === "tail") {
      pair = [edge.node2, edge.node1]; kind = "directed";
    } else if (edge.endpoint1 === "arrow" && edge.endpoint2 === "arrow") {
      pair = edge.node1 < edge.node2 ? [edge.node1, edge.node2] : [edge.node2, edge.node1]; kind = "bidirected";
    } else {
      throw new Error("ID only supports directed and bidirected edges; unresolved or undirected endpoints are unsupported.");
    }
    const key = JSON.stringify([kind, ...pair]);
    if (edgeKeys.has(key)) throw new Error("ID graph contains a duplicate edge of the same type.");
    edgeKeys.add(key);
    (kind === "directed" ? directed : bidirected).push(pair);
  }
  if (shape.kind !== "admg" && bidirected.length > 0) {
    throw new Error("A DAG cannot contain bidirected edges; explicitly declare graph kind as admg.");
  }
  const order: string[] = [];
  const remaining = new Set(vertices);
  while (remaining.size > 0) {
    const roots = [...remaining].filter((node) => !directed.some(([parent, child]) => child === node && remaining.has(parent))).sort();
    if (roots.length === 0) throw new Error("ID requires an acyclic directed part.");
    for (const node of roots) {
      order.push(node);
      remaining.delete(node);
    }
  }
  return { vertices: order, directed, bidirected };
}

function marginalize(expression: IdentificationExpressionNode, variables: readonly string[]): IdentificationExpressionNode {
  // This probability identity is safe without any graphical assumptions.
  // Arbitrary recursive kernels remain explicit sums, preserving lexical scope.
  if (expression.type === "probability" && variables.every((node) => expression.variables.includes(node) && !expression.conditionedOn.includes(node))) {
    return probabilityNode(difference(expression.variables, variables), expression.conditionedOn);
  }
  return sumNode(variables, expression);
}

function kernelFactors(kernel: IdentificationExpressionNode, graph: IdGraph, selected: readonly string[]): IdentificationExpressionNode {
  const selectedSet = new Set(selected);
  const factors: IdentificationExpressionNode[] = [];
  for (let index = 0; index < graph.vertices.length; index += 1) {
    if (!selectedSet.has(graph.vertices[index]!)) continue;
    // Chain rule for the CURRENT kernel, not P(vi | original predecessors).
    // This distinction is essential after steps 2 and 7 marginalize/fix nodes.
    factors.push(quotientNode(
      marginalize(kernel, graph.vertices.slice(index + 1)),
      marginalize(kernel, graph.vertices.slice(index))
    ));
  }
  return productNode(...factors);
}

/**
 * Complete ID for joint interventions in fully observed semi-Markovian ADMGs.
 * Implements Shpitser and Pearl (2006), Figure 3, with step 3's invariant
 * output averaged over the added interventions to eliminate arbitrary values:
 * https://ftp.cs.ucla.edu/pub/stat_ser/r327.pdf
 *
 * The output is a symbolic functional of the observational joint distribution.
 * Quotients require positive denominators on the evaluated support. This API
 * does not estimate probabilities or identify conditional queries (IDC).
 */
export function identifyById(options: IdOptions): IdResult {
  const graph = parseGraph(options.graph);
  const known = new Set(graph.vertices);
  for (const [label, values] of [["treatment", options.treatment], ["outcome", options.outcome]] as const) {
    if (new Set(values).size !== values.length || values.some((value) => !known.has(value))) {
      throw new Error(`ID ${label} must contain distinct existing vertices.`);
    }
  }
  if (options.outcome.length === 0) throw new Error("ID requires at least one outcome.");
  if (options.outcome.some((node) => options.treatment.includes(node))) {
    throw new Error("ID treatment and outcome sets must be disjoint.");
  }
  const trace: IdTraceStep[] = [];
  let failure: IdFailureWitness | undefined;
  function recurse(y: string[], x: string[], kernel: IdentificationExpressionNode, current: IdGraph, depth: number): IdentificationExpressionNode | null {
    const record = (step: IdTraceStep["step"], detail: string, selectedNodes?: string[], components?: string[][]): void => {
      trace.push({
        step, depth, vertices: [...current.vertices], treatment: [...x], outcome: [...y], detail,
        ...(selectedNodes === undefined ? {} : { selectedNodes: [...selectedNodes] }),
        ...(components === undefined ? {} : { districts: components.map((component) => [...component]) })
      });
    };
    if (x.length === 0) {
      record(1, "No interventions remain; marginalize the current kernel to the outcomes.");
      return marginalize(kernel, difference(current.vertices, y));
    }
    const ancestral = ancestors(current, y);
    if (ancestral.length !== current.vertices.length) {
      record(2, "Restrict the graph and marginalize the kernel to the directed ancestors of the outcomes.", ancestral);
      return recurse(y, subset(x, new Set(ancestral)), marginalize(kernel, difference(current.vertices, ancestral)), induced(current, ancestral), depth + 1);
    }
    const addedInterventions = difference(difference(current.vertices, x), ancestors(current, y, x));
    if (addedInterventions.length > 0) {
      record(3, "Add non-ancestors in the intervened graph to the intervention set; normalize the returned invariant expression by averaging over their observed marginal.", addedInterventions);
      const result = recurse(y, subset(current.vertices, new Set([...x, ...addedInterventions])), kernel, current, depth + 1);
      if (result === null) return null;
      // Rule 3 makes this result invariant to W, although a syntactic chain
      // factor can still mention W (e.g. P(y|x,z) in Z -> X -> Y). Average
      // over the normalized observed P(W) to remove those arbitrary free
      // values without imposing any additional graphical simplification.
      // This functional is evaluated on positive support, as required for
      // the chain-rule denominators (including the added W assignments).
      return sumNode(addedInterventions, productNode(probabilityNode(addedInterventions), result));
    }
    const components = districts(induced(current, difference(current.vertices, x)));
    if (components.length > 1) {
      record(4, "Identify each district after intervention, multiply its kernel, and marginalize non-query variables.", undefined, components);
      const factors: IdentificationExpressionNode[] = [];
      for (const component of components) {
        const factor = recurse(component, difference(current.vertices, component), kernel, current, depth + 1);
        if (factor === null) return null;
        factors.push(factor);
      }
      return marginalize(productNode(...factors), difference(current.vertices, [...x, ...y]));
    }
    const targetDistrict = components[0]!; // Y is nonempty and disjoint from X.
    const originalDistricts = districts(current);
    if (originalDistricts.length === 1) {
      record(5, "ID fails: the remaining district is a proper subset of one confounded component.", targetDistrict);
      failure = {
        graph: graphShape(current), district: graphShape(induced(current, targetDistrict)),
        treatment: [...x], outcome: [...y],
        reason: "ID step 5 returns FAIL(G, S). These induced subgraphs contain a non-identifiability obstruction; they are not pruned C-forest hedge objects."
      };
      return null;
    }
    const container = originalDistricts.find((component) => targetDistrict.every((node) => component.includes(node)))!;
    if (container.length === targetDistrict.length) {
      record(6, "The target is a district of the current graph; extract its chain-rule kernel and marginalize.", targetDistrict);
      return marginalize(kernelFactors(kernel, current, targetDistrict), difference(targetDistrict, y));
    }
    record(7, "Extract the containing district's kernel and recurse within its induced graph.", container);
    return recurse(y, subset(x, new Set(container)), kernelFactors(kernel, current, container), induced(current, container), depth + 1);
  }
  const expressionTree = recurse(
    subset(graph.vertices, new Set(options.outcome)),
    subset(graph.vertices, new Set(options.treatment)),
    probabilityNode(graph.vertices), graph, 0
  );
  if (expressionTree === null) {
    return { identified: false, expressionTree: null, trace, topologicalOrder: [...graph.vertices], idFailureWitness: failure! };
  }
  return { identified: true, expressionTree, trace, topologicalOrder: [...graph.vertices] };
}
