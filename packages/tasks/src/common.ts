import {
  CausalGraph,
  ChiSquareTest,
  classifyEdge,
  DenseMatrix,
  EDGE_ENDPOINT,
  FisherZTest,
  GRAPH_EDGE_PATTERN,
  GRAPH_KIND,
  GSquareTest,
  NODE_TYPE,
  type ConditionalIndependenceTest,
  type EdgeDescriptor,
  type GraphKind,
  type GraphShape,
  type NumericMatrix
} from "@causal-js/core";
import { dagDSeparates } from "@causal-js/kernel";
import {
  camuv,
  cdnod,
  exactSearch,
  fci,
  ges,
  gin,
  grasp,
  pc,
  rcd,
  type CamuvOptions,
  type CdnodOptions,
  type ExactSearchOptions,
  type FciOptions,
  type GesOptions,
  type GinOptions,
  type GraspOptions,
  type PcOptions,
  type RcdOptions
} from "@causal-js/discovery";

import type {
  DiscoverGraphInput,
  DiscoveryAlgorithmId,
  DiscoveryGraphPreference,
  DiscoveryOptions,
  DiscoveryOptionsByAlgorithm,
  GraphSummary
} from "./types";

type DiscoveryFn<Options, Result> = (options: Options) => Result;

interface DiscoveryDefinition<Options, Result> {
  fn: DiscoveryFn<Options, Result>;
  defaultGraphField: "graph" | "cpdag" | "dag";
}

const discoveryDefinitions = {
  pc: { fn: pc, defaultGraphField: "graph" },
  fci: { fn: fci, defaultGraphField: "graph" },
  ges: { fn: ges, defaultGraphField: "cpdag" },
  cdnod: { fn: cdnod, defaultGraphField: "graph" },
  "exact-search": { fn: exactSearch, defaultGraphField: "cpdag" },
  grasp: { fn: grasp, defaultGraphField: "cpdag" },
  gin: { fn: gin, defaultGraphField: "graph" },
  "cam-uv": { fn: camuv, defaultGraphField: "graph" },
  rcd: { fn: rcd, defaultGraphField: "graph" }
} satisfies {
  [Algorithm in DiscoveryAlgorithmId]: DiscoveryDefinition<
    DiscoveryOptionsByAlgorithm[Algorithm],
    unknown
  >;
};

export function asCausalGraph(graph: GraphShape | CausalGraph): CausalGraph {
  return graph instanceof CausalGraph ? graph.clone() : CausalGraph.fromShape(graph);
}

export function assertSingletonNodeQuery(treatment: string, outcome: string): void {
  if (treatment === outcome) {
    throw new Error("Treatment and outcome must be different nodes.");
  }
}

export function assertDagLike(graph: CausalGraph): void {
  const nonDirectedEdges = graph
    .getEdges()
    .filter((edge) => classifyEdge(edge.endpoint1, edge.endpoint2) !== GRAPH_EDGE_PATTERN.directed);

  if (nonDirectedEdges.length > 0) {
    throw new Error("This Step 3 MVP only supports directed DAG inputs for graph-analysis tasks.");
  }

  if (graph.hasDirectedCycle()) {
    throw new Error("This Step 3 MVP only supports acyclic directed graphs.");
  }
}

export function getMeasuredNodeIds(graph: CausalGraph): string[] {
  return graph
    .getNodes()
    .filter((node) => (node.nodeType ?? NODE_TYPE.measured) === NODE_TYPE.measured)
    .map((node) => node.id);
}

export function summarizeGraph(graph: GraphShape): GraphSummary {
  const summary: GraphSummary = {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    directedEdgeCount: 0,
    undirectedEdgeCount: 0,
    bidirectedEdgeCount: 0,
    partiallyOrientedEdgeCount: 0,
    partiallyUndirectedEdgeCount: 0,
    nondirectedEdgeCount: 0
  };

  for (const edge of graph.edges) {
    const pattern = classifyEdge(edge.endpoint1, edge.endpoint2);
    switch (pattern) {
      case GRAPH_EDGE_PATTERN.directed:
        summary.directedEdgeCount += 1;
        break;
      case GRAPH_EDGE_PATTERN.undirected:
        summary.undirectedEdgeCount += 1;
        break;
      case GRAPH_EDGE_PATTERN.bidirected:
        summary.bidirectedEdgeCount += 1;
        break;
      case GRAPH_EDGE_PATTERN.partiallyOriented:
        summary.partiallyOrientedEdgeCount += 1;
        break;
      case GRAPH_EDGE_PATTERN.partiallyUndirected:
        summary.partiallyUndirectedEdgeCount += 1;
        break;
      case GRAPH_EDGE_PATTERN.nondirected:
        summary.nondirectedEdgeCount += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

export function runDiscovery(input: DiscoverGraphInput): {
  algorithm: DiscoveryAlgorithmId;
  result: Record<string, unknown>;
  graphField: "graph" | "cpdag" | "dag";
  graph: GraphShape;
  artifacts: Partial<Record<"graph" | "cpdag" | "dag", GraphShape>>;
} {
  const definition = discoveryDefinitions[input.algorithm];
  const result = definition.fn(input.options as never) as unknown as Record<string, unknown>;
  const requestedField = input.graphPreference;
  const graphField = resolveDiscoveryGraphField(result, requestedField ?? definition.defaultGraphField);
  const graph = result[graphField];
  if (!isGraphShape(graph)) {
    throw new Error(`Discovery result for ${input.algorithm} does not expose a ${graphField} graph.`);
  }

  return {
    algorithm: input.algorithm,
    result,
    graphField,
    graph,
    artifacts: collectDiscoveryArtifacts(result)
  };
}

function resolveDiscoveryGraphField(
  result: Record<string, unknown>,
  preferredField: DiscoveryGraphPreference
): "graph" | "cpdag" | "dag" {
  const order: Array<"graph" | "cpdag" | "dag"> =
    preferredField === "graph"
      ? ["graph", "cpdag", "dag"]
      : preferredField === "cpdag"
        ? ["cpdag", "dag", "graph"]
        : ["dag", "cpdag", "graph"];

  const selected = order.find((field) => isGraphShape(result[field]));
  if (!selected) {
    throw new Error("Discovery result does not expose a graph artifact.");
  }
  return selected;
}

function collectDiscoveryArtifacts(
  result: Record<string, unknown>
): Partial<Record<"graph" | "cpdag" | "dag", GraphShape>> {
  const artifacts: Partial<Record<"graph" | "cpdag" | "dag", GraphShape>> = {};
  for (const field of ["graph", "cpdag", "dag"] as const) {
    const candidate = result[field];
    if (isGraphShape(candidate)) {
      artifacts[field] = candidate;
    }
  }
  return artifacts;
}

function isGraphShape(value: unknown): value is GraphShape {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as GraphShape).nodes) &&
    Array.isArray((value as GraphShape).edges)
  );
}

export function buildBackdoorGraph(graph: CausalGraph, treatment: string): CausalGraph {
  const backdoor = graph.clone();
  for (const childId of graph.getChildIds(treatment)) {
    backdoor.removeEdge(treatment, childId);
  }
  if (backdoor.getKind() !== GRAPH_KIND.generic) {
    backdoor.setKind(GRAPH_KIND.generic);
  }
  return backdoor;
}

export function dSeparates(
  graph: CausalGraph,
  x: string,
  y: string,
  conditioningSet: readonly string[]
): boolean {
  return dagDSeparates(graph, x, y, conditioningSet);
}

export function powerset(values: readonly string[], maxSetSize = values.length): string[][] {
  const subsets: string[][] = [[]];
  for (const value of values) {
    const currentLength = subsets.length;
    for (let index = 0; index < currentLength; index += 1) {
      const next = [...subsets[index]!, value];
      if (next.length <= maxSetSize) {
        subsets.push(next);
      }
    }
  }
  return subsets.sort((left, right) => left.length - right.length || left.join(",").localeCompare(right.join(",")));
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function properCausalPathNodes(
  graph: CausalGraph,
  treatment: string,
  outcome: string
): string[] {
  const visited = new Set<string>();

  const walk = (nodeId: string): void => {
    for (const childId of graph.getChildIds(nodeId)) {
      if (childId === treatment || visited.has(childId)) {
        continue;
      }

      if (childId === outcome || graph.existsDirectedPathFromTo(childId, outcome)) {
        visited.add(childId);
        walk(childId);
      }
    }
  };

  walk(treatment);
  return uniqueSorted([...visited]);
}

export function forbiddenAdjustmentNodes(
  graph: CausalGraph,
  treatment: string,
  outcome: string
): string[] {
  const pathNodes = properCausalPathNodes(graph, treatment, outcome);
  const descendants = uniqueSorted(graph.getDescendantIds(pathNodes));
  return uniqueSorted([...pathNodes, ...descendants].filter((nodeId) => nodeId !== treatment));
}

export function hasDirectedPath(graph: CausalGraph, treatment: string, outcome: string): boolean {
  return graph.existsDirectedPathFromTo(treatment, outcome);
}

export function allDirectedPaths(
  graph: CausalGraph,
  source: string,
  target: string
): string[][] {
  const paths: string[][] = [];
  const visit = (current: string, path: string[]): void => {
    if (current === target) {
      paths.push(path);
      return;
    }

    for (const childId of graph.getChildIds(current)) {
      if (path.includes(childId)) {
        continue;
      }
      visit(childId, [...path, childId]);
    }
  };

  visit(source, [source]);
  return paths;
}

export function deriveObservedNodeOrder(
  graph: CausalGraph,
  data: NumericMatrix,
  observedNodeOrder?: readonly string[]
): string[] {
  if (observedNodeOrder) {
    if (observedNodeOrder.length !== data.columns) {
      throw new Error(
        `Expected observedNodeOrder to contain ${data.columns} nodes, got ${observedNodeOrder.length}.`
      );
    }
    const seen = new Set<string>();
    for (const nodeId of observedNodeOrder) {
      if (seen.has(nodeId)) {
        throw new Error(`observedNodeOrder contains a duplicate node: ${nodeId}.`);
      }
      seen.add(nodeId);
      const node = graph.getNode(nodeId);
      if (!node) {
        throw new Error(`observedNodeOrder references an unknown node: ${nodeId}.`);
      }
      if ((node.nodeType ?? NODE_TYPE.measured) !== NODE_TYPE.measured) {
        throw new Error(`observedNodeOrder may only contain measured nodes, but received ${nodeId}.`);
      }
    }
    return [...observedNodeOrder];
  }

  const measured = getMeasuredNodeIds(graph);
  if (measured.length !== data.columns) {
    throw new Error(
      "Observed data columns do not align with graph nodes. Provide observedNodeOrder explicitly."
    );
  }
  return measured;
}

export function assertProbabilityAlpha(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be a finite number in the open interval (0, 1).`);
  }
}

export function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number in the closed interval [0, 1].`);
  }
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function assertPositiveFraction(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${label} must be a finite number in the interval (0, 1].`);
  }
}

export function assertNonEmptyMatrix(data: NumericMatrix, label: string): void {
  if (data.rows <= 0 || data.columns <= 0) {
    throw new Error(`${label} must contain at least one row and one column.`);
  }
}

export function inferConditionalIndependenceTest(data: NumericMatrix): ConditionalIndependenceTest {
  const rows = data.toArray();
  const allIntegerLike = rows.every((row) =>
    row.every((value) => Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-9)
  );
  return allIntegerLike ? new ChiSquareTest(data) : new FisherZTest(data);
}

export function cloneMatrixRows(data: NumericMatrix, rowIndices: readonly number[]): DenseMatrix {
  return new DenseMatrix(
    rowIndices.map((rowIndex) => {
      const row = data.row(rowIndex);
      return [...row];
    })
  );
}

export function cloneContext(
  context: CdnodOptions["context"],
  rowIndices: readonly number[]
): CdnodOptions["context"] {
  if (Array.isArray(context)) {
    return rowIndices.map((rowIndex) => {
      const value = context[rowIndex];
      if (value === undefined) {
        throw new Error(`Missing context value at row ${rowIndex}`);
      }
      return value;
    });
  }

  if (isNumericMatrixLike(context)) {
    return cloneMatrixRows(context, rowIndices);
  }

  throw new Error("Unsupported CD-NOD context input.");
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function sampleRowIndices(
  rowCount: number,
  sampleSize: number,
  replace: boolean,
  random: () => number
): number[] {
  if (replace) {
    return Array.from({ length: sampleSize }, () => Math.floor(random() * rowCount));
  }

  const pool = Array.from({ length: rowCount }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    const current = pool[index];
    const next = pool[selected];
    if (current === undefined || next === undefined) {
      throw new Error("Sampling failed because of an invalid shuffle state.");
    }
    pool[index] = next;
    pool[selected] = current;
  }
  return pool.slice(0, sampleSize);
}

export function rebuildDiscoveryOptions(
  original: DiscoverGraphInput,
  resampledData: NumericMatrix,
  rowIndices: readonly number[],
  createOverride?: (
    data: NumericMatrix,
    context: { iteration: number; sampledRowIndices: number[] }
  ) => DiscoveryOptions,
  iteration = 0
): DiscoverGraphInput {
  if (createOverride) {
    return {
      algorithm: original.algorithm,
      graphPreference: original.graphPreference,
      options: createOverride(resampledData, { iteration, sampledRowIndices: [...rowIndices] }) as never
    } as DiscoverGraphInput;
  }

  switch (original.algorithm) {
    case "pc":
      return {
        ...original,
        options: {
          ...(original.options as PcOptions),
          data: resampledData,
          ciTest: rebuildCiTest((original.options as PcOptions).ciTest, resampledData)
        }
      };
    case "fci":
      return {
        ...original,
        options: {
          ...(original.options as FciOptions),
          data: resampledData,
          ciTest: rebuildCiTest((original.options as FciOptions).ciTest, resampledData)
        }
      };
    case "ges":
      return {
        ...original,
        options: {
          ...(original.options as GesOptions),
          data: resampledData,
          score: rebuildScore((original.options as GesOptions).score, resampledData)
        }
      };
    case "cdnod":
      return {
        ...original,
        options: {
          ...(original.options as CdnodOptions),
          data: resampledData,
          context: cloneContext((original.options as CdnodOptions).context, rowIndices),
          createCiTest: (data) => {
            const ci = (original.options as CdnodOptions).createCiTest(data);
            return rebuildCiTest(ci, data);
          }
        }
      };
    case "exact-search":
      return {
        ...original,
        options: {
          ...(original.options as ExactSearchOptions),
          data: resampledData,
          score: rebuildScore((original.options as ExactSearchOptions).score, resampledData)
        }
      };
    case "grasp":
      return {
        ...original,
        options: {
          ...(original.options as GraspOptions),
          data: resampledData,
          score: rebuildScore((original.options as GraspOptions).score, resampledData)
        }
      };
    case "gin":
      return {
        ...original,
        options: {
          ...(original.options as GinOptions),
          data: resampledData
        }
      };
    case "cam-uv":
      return {
        ...original,
        options: {
          ...(original.options as CamuvOptions),
          data: resampledData
        }
      };
    case "rcd":
      return {
        ...original,
        options: {
          ...(original.options as RcdOptions),
          data: resampledData
        }
      };
    default:
      throw new Error(`Unsupported discovery algorithm: ${(original as DiscoverGraphInput).algorithm}`);
  }
}

function rebuildCiTest(
  ciTest: ConditionalIndependenceTest,
  data: NumericMatrix
): ConditionalIndependenceTest {
  if (ciTest instanceof FisherZTest) {
    return new FisherZTest(data);
  }
  if (ciTest instanceof ChiSquareTest) {
    return new ChiSquareTest(data);
  }
  if (ciTest instanceof GSquareTest) {
    return new GSquareTest(data);
  }

  const TestConstructor = (ciTest as unknown as { constructor: new (data: NumericMatrix) => ConditionalIndependenceTest })
    .constructor;
  if (typeof TestConstructor === "function") {
    try {
      return new TestConstructor(data);
    } catch {
      throw new Error(
        `Could not rebuild conditional independence test ${ciTest.name}. Provide createDiscoveryOptions for stabilityAnalysis.`
      );
    }
  }

  throw new Error(
    `Could not rebuild conditional independence test ${ciTest.name}. Provide createDiscoveryOptions for stabilityAnalysis.`
  );
}

function isNumericMatrixLike(value: unknown): value is NumericMatrix {
  return (
    typeof value === "object" &&
    value !== null &&
    "rows" in value &&
    "columns" in value &&
    "row" in value &&
    "column" in value &&
    "toArray" in value
  );
}

function rebuildScore(score: unknown, data: NumericMatrix): DiscoveryOptionsByAlgorithm["ges"]["score"] {
  const ScoreConstructor = (score as { constructor?: new (data: NumericMatrix, options?: object) => unknown })
    .constructor;
  if (typeof ScoreConstructor === "function") {
    const maybeOptions = extractScoreOptions(score);
    try {
      return new ScoreConstructor(data, maybeOptions) as DiscoveryOptionsByAlgorithm["ges"]["score"];
    } catch {
      throw new Error(
        "Could not rebuild local score function. Provide createDiscoveryOptions for stabilityAnalysis."
      );
    }
  }

  throw new Error(
    "Could not rebuild local score function. Provide createDiscoveryOptions for stabilityAnalysis."
  );
}

function extractScoreOptions(score: unknown): object | undefined {
  const bic = score as { name?: string; penaltyDiscount?: number };
  if (bic.name === "local_score_BIC") {
    return bic.penaltyDiscount === undefined ? undefined : { penaltyDiscount: bic.penaltyDiscount };
  }

  const bdeu = score as {
    name?: string;
    samplePrior?: number;
    structurePrior?: number;
    stateCardinalities?: Record<number, number>;
  };
  if (bdeu.name === "local_score_BDeu") {
    return {
      ...(bdeu.samplePrior === undefined ? {} : { samplePrior: bdeu.samplePrior }),
      ...(bdeu.structurePrior === undefined ? {} : { structurePrior: bdeu.structurePrior }),
      ...(bdeu.stateCardinalities === undefined ? {} : { stateCardinalities: bdeu.stateCardinalities })
    };
  }

  return undefined;
}

export function edgeKey(node1: string, node2: string): string {
  return node1 < node2 ? `${node1}::${node2}` : `${node2}::${node1}`;
}

export function canonicalizeEdge(node1: string, node2: string, edge?: EdgeDescriptor): EdgeDescriptor | null {
  if (!edge) {
    return null;
  }
  if (edge.node1 <= edge.node2) {
    return edge;
  }
  return {
    node1: edge.node2,
    node2: edge.node1,
    endpoint1: edge.endpoint2,
    endpoint2: edge.endpoint1,
    ...(edge.metadata === undefined ? {} : { metadata: edge.metadata })
  };
}

export function createGenericGraph(nodeIds: readonly string[], edges: readonly EdgeDescriptor[]): GraphShape {
  const graph = CausalGraph.fromNodeIds(nodeIds, { kind: GRAPH_KIND.generic });
  for (const edge of edges) {
    graph.setEdge(edge.node1, edge.node2, edge.endpoint1, edge.endpoint2, edge.metadata);
  }
  return graph.toShape();
}

export function absentEdgeRecord(node1: string, node2: string): EdgeDescriptor {
  return {
    node1,
    node2,
    endpoint1: EDGE_ENDPOINT.none,
    endpoint2: EDGE_ENDPOINT.none
  };
}

export function normalizeGraphKind(kind: GraphKind | undefined): GraphKind {
  return kind ?? GRAPH_KIND.generic;
}
