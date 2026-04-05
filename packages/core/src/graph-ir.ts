export const EDGE_ENDPOINT = {
  arrow: "arrow",
  circle: "circle",
  none: "none",
  star: "star",
  tail: "tail"
} as const;

export const EDGE_ENDPOINT_CODE = {
  arrow: 1,
  circle: 2,
  none: 0,
  star: 3,
  tail: -1
} as const;

export const GRAPH_KIND = {
  admg: "admg",
  cpdag: "cpdag",
  dag: "dag",
  generic: "generic",
  pag: "pag"
} as const;

export const GRAPH_EDGE_PATTERN = {
  absent: "absent",
  bidirected: "bidirected",
  directed: "directed",
  invalid: "invalid",
  nondirected: "nondirected",
  partiallyOriented: "partiallyOriented",
  partiallyUndirected: "partiallyUndirected",
  undirected: "undirected"
} as const;

export type EdgeEndpoint = (typeof EDGE_ENDPOINT)[keyof typeof EDGE_ENDPOINT];
export type GraphKind = (typeof GRAPH_KIND)[keyof typeof GRAPH_KIND];
export type GraphEdgePattern = (typeof GRAPH_EDGE_PATTERN)[keyof typeof GRAPH_EDGE_PATTERN];

export const NODE_TYPE = {
  error: "error",
  latent: "latent",
  measured: "measured",
  selection: "selection"
} as const;

export type NodeType = (typeof NODE_TYPE)[keyof typeof NODE_TYPE];

export interface NodePosition {
  x: number;
  y: number;
}

export type GraphMetadata = Record<string, unknown>;

export interface GraphNode {
  id: string;
  label?: string;
  nodeType?: NodeType;
  position?: NodePosition;
  attributes?: GraphMetadata;
  metadata?: GraphMetadata;
}

export interface EdgeDescriptor {
  node1: string;
  node2: string;
  endpoint1: EdgeEndpoint;
  endpoint2: EdgeEndpoint;
  metadata?: GraphMetadata;
}

export interface LegacyGraphShape {
  nodes: GraphNode[];
  edges: EdgeDescriptor[];
}

export interface GraphShape extends LegacyGraphShape {
  version?: 1;
  kind?: GraphKind;
  metadata?: GraphMetadata;
}

export interface DirectedEdgePair {
  from: string;
  to: string;
}

export type IndexPair = [number, number];
export type IndexTriple = [number, number, number];
export type IndexKite = [number, number, number, number];

export interface GraphValidationIssue {
  code:
    | "dangling-endpoint"
    | "duplicate-node"
    | "illegal-edge-pattern"
    | "self-edge"
    | "unknown-endpoint"
    | "directed-cycle"
    | "semi-directed-cycle";
  message: string;
  nodeId?: string;
  edge?: Pick<EdgeDescriptor, "node1" | "node2" | "endpoint1" | "endpoint2">;
  graphKind?: GraphKind;
}

export interface GraphValidationResult {
  valid: boolean;
  issues: GraphValidationIssue[];
}

export interface GraphConstructorOptions {
  kind?: GraphKind;
  metadata?: GraphMetadata;
  nodes?: readonly GraphNode[];
  validate?: boolean;
}

interface InternalNode {
  id: string;
  label?: string;
  nodeType: NodeType;
  position?: NodePosition;
  metadata: GraphMetadata | undefined;
}

const GRAPH_SHAPE_VERSION = 1 as const;

function cloneMetadata(metadata?: GraphMetadata): GraphMetadata | undefined {
  return metadata === undefined ? undefined : { ...metadata };
}

function mergeMetadata(metadata?: GraphMetadata, attributes?: GraphMetadata): GraphMetadata | undefined {
  if (metadata === undefined && attributes === undefined) {
    return undefined;
  }

  return {
    ...(attributes ?? {}),
    ...(metadata ?? {})
  };
}

function cloneNode(node: InternalNode): GraphNode {
  const cloned: GraphNode = {
    id: node.id,
    nodeType: node.nodeType
  };

  if (node.label !== undefined) {
    cloned.label = node.label;
  }

  if (node.position !== undefined) {
    cloned.position = { ...node.position };
  }

  if (node.metadata !== undefined) {
    const metadata = cloneMetadata(node.metadata)!;
    cloned.metadata = metadata;
    cloned.attributes = metadata;
  }

  return cloned;
}

function normalizeNode(node: GraphNode): InternalNode {
  const normalized: InternalNode = {
    id: node.id,
    nodeType: node.nodeType ?? NODE_TYPE.measured,
    metadata: undefined
  };

  if (node.label !== undefined) {
    normalized.label = node.label;
  }

  if (node.position !== undefined) {
    normalized.position = { ...node.position };
  }

  const metadata = mergeMetadata(node.metadata, node.attributes);
  if (metadata !== undefined) {
    normalized.metadata = metadata;
  }

  return normalized;
}

function cloneEdge(edge: EdgeDescriptor): EdgeDescriptor {
  const cloned: EdgeDescriptor = {
    node1: edge.node1,
    node2: edge.node2,
    endpoint1: edge.endpoint1,
    endpoint2: edge.endpoint2
  };

  if (edge.metadata !== undefined) {
    cloned.metadata = cloneMetadata(edge.metadata)!;
  }

  return cloned;
}

function canonicalEdgeKey(node1: string, node2: string): string {
  return node1 < node2 ? `${node1}::${node2}` : `${node2}::${node1}`;
}

function endpointToCode(endpoint: EdgeEndpoint): number {
  return EDGE_ENDPOINT_CODE[endpoint];
}

function assertEndpoint(endpoint: EdgeEndpoint): void {
  if (!Object.values(EDGE_ENDPOINT).includes(endpoint)) {
    throw new Error(`Unknown endpoint: ${endpoint}`);
  }
}

function validateEndpointPair(endpoint1: EdgeEndpoint, endpoint2: EdgeEndpoint): GraphEdgePattern {
  if (endpoint1 === EDGE_ENDPOINT.none && endpoint2 === EDGE_ENDPOINT.none) {
    return GRAPH_EDGE_PATTERN.absent;
  }

  if (endpoint1 === EDGE_ENDPOINT.none || endpoint2 === EDGE_ENDPOINT.none) {
    return GRAPH_EDGE_PATTERN.invalid;
  }

  if (endpoint1 === EDGE_ENDPOINT.star || endpoint2 === EDGE_ENDPOINT.star) {
    return GRAPH_EDGE_PATTERN.invalid;
  }

  if (
    (endpoint1 === EDGE_ENDPOINT.tail && endpoint2 === EDGE_ENDPOINT.arrow) ||
    (endpoint1 === EDGE_ENDPOINT.arrow && endpoint2 === EDGE_ENDPOINT.tail)
  ) {
    return GRAPH_EDGE_PATTERN.directed;
  }

  if (endpoint1 === EDGE_ENDPOINT.tail && endpoint2 === EDGE_ENDPOINT.tail) {
    return GRAPH_EDGE_PATTERN.undirected;
  }

  if (endpoint1 === EDGE_ENDPOINT.arrow && endpoint2 === EDGE_ENDPOINT.arrow) {
    return GRAPH_EDGE_PATTERN.bidirected;
  }

  if (endpoint1 === EDGE_ENDPOINT.circle && endpoint2 === EDGE_ENDPOINT.circle) {
    return GRAPH_EDGE_PATTERN.nondirected;
  }

  if (
    (endpoint1 === EDGE_ENDPOINT.circle && endpoint2 === EDGE_ENDPOINT.arrow) ||
    (endpoint1 === EDGE_ENDPOINT.arrow && endpoint2 === EDGE_ENDPOINT.circle)
  ) {
    return GRAPH_EDGE_PATTERN.partiallyOriented;
  }

  if (
    (endpoint1 === EDGE_ENDPOINT.circle && endpoint2 === EDGE_ENDPOINT.tail) ||
    (endpoint1 === EDGE_ENDPOINT.tail && endpoint2 === EDGE_ENDPOINT.circle)
  ) {
    return GRAPH_EDGE_PATTERN.partiallyUndirected;
  }

  return GRAPH_EDGE_PATTERN.invalid;
}

function allowsPattern(kind: GraphKind, pattern: GraphEdgePattern): boolean {
  if (pattern === GRAPH_EDGE_PATTERN.absent) {
    return true;
  }

  switch (kind) {
    case GRAPH_KIND.dag:
      return pattern === GRAPH_EDGE_PATTERN.directed;
    case GRAPH_KIND.cpdag:
      return pattern === GRAPH_EDGE_PATTERN.directed || pattern === GRAPH_EDGE_PATTERN.undirected;
    case GRAPH_KIND.pag:
      return pattern !== GRAPH_EDGE_PATTERN.invalid;
    case GRAPH_KIND.admg:
      return pattern === GRAPH_EDGE_PATTERN.directed || pattern === GRAPH_EDGE_PATTERN.bidirected;
    case GRAPH_KIND.generic:
      return pattern !== GRAPH_EDGE_PATTERN.invalid;
    default:
      return false;
  }
}

function shallowEqualMetadata(
  left: GraphMetadata | undefined,
  right: GraphMetadata | undefined
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

export function classifyEdge(
  endpoint1: EdgeEndpoint,
  endpoint2: EdgeEndpoint
): GraphEdgePattern {
  assertEndpoint(endpoint1);
  assertEndpoint(endpoint2);
  return validateEndpointPair(endpoint1, endpoint2);
}

export class GraphIR {
  private readonly nodes: InternalNode[] = [];
  private readonly nodeIndexById = new Map<string, number>();
  private readonly edgeMetadata = new Map<string, GraphMetadata>();
  private adjacency: EdgeEndpoint[][] = [];
  private kind: GraphKind;
  private metadata: GraphMetadata | undefined;

  constructor(options: GraphConstructorOptions = {}) {
    this.kind = options.kind ?? GRAPH_KIND.generic;
    this.metadata = options.metadata === undefined ? undefined : cloneMetadata(options.metadata);

    for (const node of options.nodes ?? []) {
      this.addNode(node);
    }

    if (options.validate !== false) {
      this.assertValid();
    }
  }

  static fromNodeIds(
    nodeIds: readonly string[],
    options: Omit<GraphConstructorOptions, "nodes"> = {}
  ): GraphIR {
    return new GraphIR({
      ...options,
      nodes: nodeIds.map((id) => ({ id }))
    });
  }

  static fromLegacyShape(
    shape: LegacyGraphShape,
    options: Omit<GraphConstructorOptions, "nodes" | "metadata"> = {}
  ): GraphIR {
    return GraphIR.fromShape({
      ...shape,
      kind: options.kind ?? GRAPH_KIND.generic
    });
  }

  static fromShape(shape: GraphShape): GraphIR {
    const graph = new GraphIR({
      kind: shape.kind ?? GRAPH_KIND.generic,
      ...(shape.metadata !== undefined ? { metadata: shape.metadata } : {}),
      nodes: shape.nodes,
      validate: false
    });

    for (const edge of shape.edges) {
      graph.setEdge(edge.node1, edge.node2, edge.endpoint1, edge.endpoint2, edge.metadata);
    }

    graph.assertValid();
    return graph;
  }

  static deserialize(serialized: string): GraphIR {
    const parsed = JSON.parse(serialized) as GraphShape;
    return GraphIR.fromShape(parsed);
  }

  clone(): GraphIR {
    return GraphIR.fromShape(this.toShape());
  }

  get size(): number {
    return this.nodes.length;
  }

  getKind(): GraphKind {
    return this.kind;
  }

  setKind(kind: GraphKind): this {
    const previousKind = this.kind;
    this.kind = kind;

    const validation = this.validate();
    if (!validation.valid) {
      this.kind = previousKind;
      throw new Error(
        `Graph kind ${kind} is incompatible with the current edges: ${validation.issues
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }

    return this;
  }

  getMetadata(): GraphMetadata | undefined {
    return cloneMetadata(this.metadata);
  }

  setMetadata(metadata?: GraphMetadata): this {
    this.metadata = metadata === undefined ? undefined : cloneMetadata(metadata);
    return this;
  }

  addNode(node: GraphNode): this {
    if (this.nodeIndexById.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }

    const nextIndex = this.nodes.length;
    this.nodes.push(normalizeNode(node));
    this.nodeIndexById.set(node.id, nextIndex);

    for (const row of this.adjacency) {
      row.push(EDGE_ENDPOINT.none);
    }

    this.adjacency.push(Array.from({ length: this.nodes.length }, () => EDGE_ENDPOINT.none));
    return this;
  }

  removeNode(nodeId: string): this {
    const index = this.getNodeIndex(nodeId);
    this.nodes.splice(index, 1);
    this.adjacency.splice(index, 1);

    for (const row of this.adjacency) {
      row.splice(index, 1);
    }

    this.nodeIndexById.clear();
    for (let nodeIndex = 0; nodeIndex < this.nodes.length; nodeIndex += 1) {
      this.nodeIndexById.set(this.nodes[nodeIndex]!.id, nodeIndex);
    }

    for (const key of [...this.edgeMetadata.keys()]) {
      if (key.includes(`${nodeId}::`) || key.endsWith(`::${nodeId}`)) {
        this.edgeMetadata.delete(key);
      }
    }

    return this;
  }

  getNode(nodeId: string): GraphNode | undefined {
    const index = this.nodeIndexById.get(nodeId);
    return index === undefined ? undefined : cloneNode(this.getNodeAt(index));
  }

  getNodes(): GraphNode[] {
    return this.nodes.map(cloneNode);
  }

  getNodeIds(): string[] {
    return this.nodes.map((node) => node.id);
  }

  getNodeIdAt(index: number): string {
    return this.getNodeAt(index).id;
  }

  getNodeIndex(nodeId: string): number {
    const index = this.nodeIndexById.get(nodeId);
    if (index === undefined) {
      throw new Error(`Unknown node id: ${nodeId}`);
    }

    return index;
  }

  setNodeMetadata(nodeId: string, metadata?: GraphMetadata): this {
    const node = this.getNodeAt(this.getNodeIndex(nodeId));
    node.metadata = metadata === undefined ? undefined : cloneMetadata(metadata);
    return this;
  }

  hasNode(nodeId: string): boolean {
    return this.nodeIndexById.has(nodeId);
  }

  getEndpoint(node1: string, node2: string): EdgeEndpoint {
    const [index1, index2] = this.getPairIndices(node1, node2);
    return this.getAdjacencyEndpoint(index1, index2);
  }

  setEdge(
    node1: string,
    node2: string,
    endpoint1: EdgeEndpoint,
    endpoint2: EdgeEndpoint,
    metadata?: GraphMetadata
  ): this {
    if (node1 === node2) {
      throw new Error("Self edges are not supported.");
    }

    assertEndpoint(endpoint1);
    assertEndpoint(endpoint2);

    const pattern = validateEndpointPair(endpoint1, endpoint2);
    if (pattern === GRAPH_EDGE_PATTERN.invalid) {
      throw new Error(`Invalid endpoint pair: ${endpoint1}/${endpoint2}.`);
    }

    if (!allowsPattern(this.kind, pattern)) {
      throw new Error(`Graph kind ${this.kind} does not allow ${pattern} edges.`);
    }

    const [index1, index2] = this.getPairIndices(node1, node2);
    this.adjacency[index1]![index2] = endpoint1;
    this.adjacency[index2]![index1] = endpoint2;

    const key = canonicalEdgeKey(node1, node2);
    if (pattern === GRAPH_EDGE_PATTERN.absent) {
      this.edgeMetadata.delete(key);
    } else if (metadata !== undefined) {
      this.edgeMetadata.set(key, cloneMetadata(metadata)!);
    }

    return this;
  }

  setEdgeMetadata(node1: string, node2: string, metadata?: GraphMetadata): this {
    if (!this.isAdjacentTo(node1, node2)) {
      throw new Error(`Cannot attach metadata to a missing edge: ${node1}-${node2}`);
    }

    const key = canonicalEdgeKey(node1, node2);
    if (metadata === undefined) {
      this.edgeMetadata.delete(key);
    } else {
      this.edgeMetadata.set(key, cloneMetadata(metadata)!);
    }

    return this;
  }

  getEdgeMetadata(node1: string, node2: string): GraphMetadata | undefined {
    if (!this.isAdjacentTo(node1, node2)) {
      return undefined;
    }

    return cloneMetadata(this.edgeMetadata.get(canonicalEdgeKey(node1, node2)));
  }

  removeEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.none, EDGE_ENDPOINT.none);
  }

  clearEdges(): this {
    this.adjacency = Array.from({ length: this.nodes.length }, () =>
      Array.from({ length: this.nodes.length }, () => EDGE_ENDPOINT.none)
    );
    this.edgeMetadata.clear();
    return this;
  }

  addDirectedEdge(from: string, to: string, metadata?: GraphMetadata): this {
    return this.setEdge(from, to, EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow, metadata);
  }

  addUndirectedEdge(node1: string, node2: string, metadata?: GraphMetadata): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.tail, EDGE_ENDPOINT.tail, metadata);
  }

  addBidirectedEdge(node1: string, node2: string, metadata?: GraphMetadata): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.arrow, metadata);
  }

  addNondirectedEdge(node1: string, node2: string, metadata?: GraphMetadata): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.circle, EDGE_ENDPOINT.circle, metadata);
  }

  addPartiallyOrientedEdge(node1: string, node2: string, metadata?: GraphMetadata): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.circle, EDGE_ENDPOINT.arrow, metadata);
  }

  orientEdge(from: string, to: string): this {
    return this.setEdge(from, to, EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow);
  }

  isAdjacentTo(node1: string, node2: string): boolean {
    return (
      this.getEndpoint(node1, node2) !== EDGE_ENDPOINT.none ||
      this.getEndpoint(node2, node1) !== EDGE_ENDPOINT.none
    );
  }

  isParentOf(parent: string, child: string): boolean {
    return (
      this.getEndpoint(parent, child) === EDGE_ENDPOINT.tail &&
      this.getEndpoint(child, parent) === EDGE_ENDPOINT.arrow
    );
  }

  isChildOf(child: string, parent: string): boolean {
    return this.isParentOf(parent, child);
  }

  isAncestorOf(ancestor: string, node: string): boolean {
    return this.getDescendantIds([ancestor]).includes(node);
  }

  isDescendantOf(node: string, ancestor: string): boolean {
    return this.isAncestorOf(ancestor, node);
  }

  isUndirectedFromTo(node1: string, node2: string): boolean {
    return (
      this.getEndpoint(node1, node2) === EDGE_ENDPOINT.tail &&
      this.getEndpoint(node2, node1) === EDGE_ENDPOINT.tail
    );
  }

  isBidirectedEdge(node1: string, node2: string): boolean {
    return (
      this.getEndpoint(node1, node2) === EDGE_ENDPOINT.arrow &&
      this.getEndpoint(node2, node1) === EDGE_ENDPOINT.arrow
    );
  }

  isCircleEdge(node1: string, node2: string): boolean {
    return (
      this.getEndpoint(node1, node2) === EDGE_ENDPOINT.circle &&
      this.getEndpoint(node2, node1) === EDGE_ENDPOINT.circle
    );
  }

  isPartiallyOrientedEdge(node1: string, node2: string): boolean {
    const forward = this.getEndpoint(node1, node2);
    const reverse = this.getEndpoint(node2, node1);
    return (
      (forward === EDGE_ENDPOINT.circle && reverse === EDGE_ENDPOINT.arrow) ||
      (forward === EDGE_ENDPOINT.arrow && reverse === EDGE_ENDPOINT.circle)
    );
  }

  isPartiallyUndirectedEdge(node1: string, node2: string): boolean {
    const forward = this.getEndpoint(node1, node2);
    const reverse = this.getEndpoint(node2, node1);
    return (
      (forward === EDGE_ENDPOINT.circle && reverse === EDGE_ENDPOINT.tail) ||
      (forward === EDGE_ENDPOINT.tail && reverse === EDGE_ENDPOINT.circle)
    );
  }

  existsDirectedPathFromTo(from: string, to: string): boolean {
    const visited = new Set<string>();
    const stack = [from];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (current === to && current !== from) {
        return true;
      }

      for (const child of this.getChildIds(current)) {
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
    }

    return false;
  }

  hasDirectedCycle(): boolean {
    return this.getNodeIds().some((nodeId) => {
      return this.getChildIds(nodeId).some((childId) => this.existsDirectedPathFromTo(childId, nodeId));
    });
  }

  getAdjacentNodeIds(nodeId: string): string[] {
    return this.neighbors(this.getNodeIndex(nodeId)).map((index) => this.getNodeAt(index).id);
  }

  neighbors(nodeIndex: number): number[] {
    const row = this.adjacency[nodeIndex];
    if (!row) {
      throw new Error(`Missing adjacency row for node index: ${nodeIndex}`);
    }

    const adjacent: number[] = [];
    for (let candidateIndex = 0; candidateIndex < row.length; candidateIndex += 1) {
      const endpoint = this.getAdjacencyEndpoint(nodeIndex, candidateIndex);
      const reverseEndpoint = this.getAdjacencyEndpoint(candidateIndex, nodeIndex);
      if (endpoint === EDGE_ENDPOINT.none && reverseEndpoint === EDGE_ENDPOINT.none) {
        continue;
      }

      adjacent.push(candidateIndex);
    }

    return adjacent;
  }

  getParents(nodeId: string): GraphNode[] {
    return this.getParentIds(nodeId).map((id) => cloneNode(this.getNodeById(id)));
  }

  getParentIds(nodeId: string): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => this.isParentOf(candidate, nodeId));
  }

  getChildren(nodeId: string): GraphNode[] {
    return this.getChildIds(nodeId).map((id) => cloneNode(this.getNodeById(id)));
  }

  getChildIds(nodeId: string): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => this.isParentOf(nodeId, candidate));
  }

  getSpouses(nodeId: string): GraphNode[] {
    return this.getSpouseIds(nodeId).map((id) => cloneNode(this.getNodeById(id)));
  }

  getSpouseIds(nodeId: string): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => this.isBidirectedEdge(nodeId, candidate));
  }

  getNeighbors(nodeId: string): GraphNode[] {
    return this.getNeighborIds(nodeId).map((id) => cloneNode(this.getNodeById(id)));
  }

  getNeighborIds(nodeId: string): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => this.isUndirectedFromTo(nodeId, candidate));
  }

  getNodesInto(nodeId: string, endpoint: EdgeEndpoint): GraphNode[] {
    return this.getNodeIdsInto(nodeId, endpoint).map((id) => cloneNode(this.getNodeById(id)));
  }

  getNodeIdsInto(nodeId: string, endpoint: EdgeEndpoint): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => {
      return this.getEndpoint(nodeId, candidate) === endpoint;
    });
  }

  getNodesOutOf(nodeId: string, endpoint: EdgeEndpoint): GraphNode[] {
    return this.getNodeIdsOutOf(nodeId, endpoint).map((id) => cloneNode(this.getNodeById(id)));
  }

  getNodeIdsOutOf(nodeId: string, endpoint: EdgeEndpoint): string[] {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => {
      return this.getEndpoint(candidate, nodeId) === endpoint;
    });
  }

  getAncestors(nodeIds: readonly string[]): GraphNode[] {
    return this.getAncestorIds(nodeIds).map((id) => cloneNode(this.getNodeById(id)));
  }

  getAncestorIds(nodeIds: readonly string[]): string[] {
    const visited = new Set<string>();
    const stack = [...nodeIds];

    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) {
        continue;
      }

      for (const parentId of this.getParentIds(nodeId)) {
        if (!visited.has(parentId)) {
          visited.add(parentId);
          stack.push(parentId);
        }
      }
    }

    return [...visited];
  }

  getDescendants(nodeIds: readonly string[]): GraphNode[] {
    return this.getDescendantIds(nodeIds).map((id) => cloneNode(this.getNodeById(id)));
  }

  getDescendantIds(nodeIds: readonly string[]): string[] {
    const visited = new Set<string>();
    const stack = [...nodeIds];

    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) {
        continue;
      }

      for (const childId of this.getChildIds(nodeId)) {
        if (!visited.has(childId)) {
          visited.add(childId);
          stack.push(childId);
        }
      }
    }

    return [...visited];
  }

  getEdge(node1: string, node2: string): EdgeDescriptor | undefined {
    if (!this.hasNode(node1) || !this.hasNode(node2)) {
      return undefined;
    }

    if (!this.isAdjacentTo(node1, node2)) {
      return undefined;
    }

    const edge: EdgeDescriptor = {
      node1,
      node2,
      endpoint1: this.getEndpoint(node1, node2),
      endpoint2: this.getEndpoint(node2, node1)
    };

    const metadata = this.getEdgeMetadata(node1, node2);
    if (metadata !== undefined) {
      edge.metadata = metadata;
    }

    return edge;
  }

  getEdges(): EdgeDescriptor[] {
    const edges: EdgeDescriptor[] = [];
    for (let index1 = 0; index1 < this.nodes.length; index1 += 1) {
      for (let index2 = index1 + 1; index2 < this.nodes.length; index2 += 1) {
        const endpoint1 = this.getAdjacencyEndpoint(index1, index2);
        const endpoint2 = this.getAdjacencyEndpoint(index2, index1);

        if (endpoint1 === EDGE_ENDPOINT.none && endpoint2 === EDGE_ENDPOINT.none) {
          continue;
        }

        const edge: EdgeDescriptor = {
          node1: this.getNodeAt(index1).id,
          node2: this.getNodeAt(index2).id,
          endpoint1,
          endpoint2
        };

        const metadata = this.getEdgeMetadata(edge.node1, edge.node2);
        if (metadata !== undefined) {
          edge.metadata = metadata;
        }

        edges.push(edge);
      }
    }

    return edges;
  }

  toLegacyShape(): LegacyGraphShape {
    return {
      nodes: this.getNodes().map((node) => {
        const legacy: GraphNode = { id: node.id };

        if (node.label !== undefined) {
          legacy.label = node.label;
        }

        if (node.nodeType !== undefined && node.nodeType !== NODE_TYPE.measured) {
          legacy.nodeType = node.nodeType;
        }

        if (node.position !== undefined) {
          legacy.position = { ...node.position };
        }

        if (node.metadata !== undefined) {
          legacy.attributes = cloneMetadata(node.metadata)!;
        }

        return legacy;
      }),
      edges: this.getEdges().map((edge) => {
        const { metadata, ...legacyEdge } = edge;
        return legacyEdge;
      })
    };
  }

  toShape(): GraphShape {
    const shape: GraphShape = {
      version: GRAPH_SHAPE_VERSION,
      kind: this.kind,
      nodes: this.getNodes(),
      edges: this.getEdges()
    };

    if (this.metadata !== undefined) {
      shape.metadata = cloneMetadata(this.metadata)!;
    }

    return shape;
  }

  serialize(pretty = false): string {
    return JSON.stringify(this.toShape(), null, pretty ? 2 : undefined);
  }

  inducedSubgraph(nodeIds: readonly string[]): GraphIR {
    const selected = new Set(nodeIds);
    const subgraph = new GraphIR({
      kind: this.kind,
      ...(this.metadata !== undefined ? { metadata: this.metadata } : {}),
      nodes: this.getNodes().filter((node) => selected.has(node.id)),
      validate: false
    });

    for (const edge of this.getEdges()) {
      if (selected.has(edge.node1) && selected.has(edge.node2)) {
        subgraph.setEdge(edge.node1, edge.node2, edge.endpoint1, edge.endpoint2, edge.metadata);
      }
    }

    subgraph.assertValid();
    return subgraph;
  }

  getNumEdges(): number {
    return this.getEdges().length;
  }

  getAdjacencyMatrix(): number[][] {
    return this.adjacency.map((row) => row.map(endpointToCode));
  }

  getDegree(nodeId: string): number {
    return this.getAdjacentNodeIds(nodeId).length;
  }

  getIndegree(nodeId: string): number {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => {
      const endpoint = this.getEndpoint(candidate, nodeId);
      return endpoint === EDGE_ENDPOINT.arrow;
    }).length;
  }

  getOutdegree(nodeId: string): number {
    return this.getAdjacentNodeIds(nodeId).filter((candidate) => {
      const endpoint = this.getEndpoint(nodeId, candidate);
      return endpoint === EDGE_ENDPOINT.tail || endpoint === EDGE_ENDPOINT.circle;
    }).length;
  }

  getMaxDegree(): number {
    return this.getNodeIds().reduce((maxDegree, nodeId) => {
      return Math.max(maxDegree, this.getDegree(nodeId));
    }, 0);
  }

  getDirectedEdgePairs(): DirectedEdgePair[] {
    return this.getEdges().flatMap((edge) => {
      if (edge.endpoint1 === EDGE_ENDPOINT.tail && edge.endpoint2 === EDGE_ENDPOINT.arrow) {
        return [{ from: edge.node1, to: edge.node2 }];
      }

      if (edge.endpoint2 === EDGE_ENDPOINT.tail && edge.endpoint1 === EDGE_ENDPOINT.arrow) {
        return [{ from: edge.node2, to: edge.node1 }];
      }

      return [];
    });
  }

  findArrowHeads(): IndexPair[] {
    const pairs: IndexPair[] = [];

    for (let rowIndex = 0; rowIndex < this.size; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < this.size; columnIndex += 1) {
        if (this.getAdjacencyEndpoint(rowIndex, columnIndex) === EDGE_ENDPOINT.arrow) {
          pairs.push([columnIndex, rowIndex]);
        }
      }
    }

    return pairs;
  }

  findTails(): IndexPair[] {
    const pairs: IndexPair[] = [];

    for (let rowIndex = 0; rowIndex < this.size; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < this.size; columnIndex += 1) {
        if (this.getAdjacencyEndpoint(rowIndex, columnIndex) === EDGE_ENDPOINT.tail) {
          pairs.push([columnIndex, rowIndex]);
        }
      }
    }

    return pairs;
  }

  findAdjacencies(): IndexPair[] {
    return [...this.findTails(), ...this.findArrowHeads()];
  }

  isUndirected(index1: number, index2: number): boolean {
    const node1 = this.getNodeIdAt(index1);
    const node2 = this.getNodeIdAt(index2);
    return this.isUndirectedFromTo(node1, node2);
  }

  isFullyDirected(index1: number, index2: number): boolean {
    const node1 = this.getNodeIdAt(index1);
    const node2 = this.getNodeIdAt(index2);
    return this.isParentOf(node1, node2);
  }

  isDefColliderByIds(left: string, center: string, right: string): boolean {
    return (
      this.isAdjacentTo(left, center) &&
      this.isAdjacentTo(center, right) &&
      this.getEndpoint(center, left) === EDGE_ENDPOINT.arrow &&
      this.getEndpoint(center, right) === EDGE_ENDPOINT.arrow
    );
  }

  isDefCollider(left: number, center: number, right: number): boolean {
    return this.isDefColliderByIds(
      this.getNodeIdAt(left),
      this.getNodeIdAt(center),
      this.getNodeIdAt(right)
    );
  }

  findUnshieldedTriples(): IndexTriple[] {
    const triples: IndexTriple[] = [];
    for (const [i, j] of this.findAdjacencies()) {
      for (const [j2, k] of this.findAdjacencies()) {
        if (j !== j2 || i === k || this.isAdjacentTo(this.getNodeIdAt(i), this.getNodeIdAt(k))) {
          continue;
        }

        triples.push([i, j, k]);
      }
    }

    return triples;
  }

  findTriangles(): IndexTriple[] {
    const triangles: IndexTriple[] = [];
    const adjacencySet = new Set(this.findAdjacencies().map(([from, to]) => `${from}:${to}`));

    for (const [i, j] of this.findAdjacencies()) {
      for (const [j2, k] of this.findAdjacencies()) {
        if (j !== j2 || i === k) {
          continue;
        }

        if (adjacencySet.has(`${i}:${k}`)) {
          triangles.push([i, j, k]);
        }
      }
    }

    return triangles;
  }

  findKites(): IndexKite[] {
    const kites: IndexKite[] = [];
    for (const [i1, j, l1] of this.findTriangles()) {
      for (const [i2, k, l2] of this.findTriangles()) {
        if (i1 !== i2 || l1 !== l2 || j >= k) {
          continue;
        }

        if (!this.isAdjacentTo(this.getNodeIdAt(j), this.getNodeIdAt(k))) {
          kites.push([i1, j, k, l1]);
        }
      }
    }

    return kites;
  }

  fullyConnect(endpoint: EdgeEndpoint): this {
    assertEndpoint(endpoint);

    for (let index1 = 0; index1 < this.nodes.length; index1 += 1) {
      for (let index2 = index1 + 1; index2 < this.nodes.length; index2 += 1) {
        this.setEdge(this.getNodeAt(index1).id, this.getNodeAt(index2).id, endpoint, endpoint);
      }
    }

    return this;
  }

  reorientAllWith(endpoint: EdgeEndpoint): this {
    assertEndpoint(endpoint);

    for (const edge of this.getEdges()) {
      this.setEdge(edge.node1, edge.node2, endpoint, endpoint);
    }

    return this;
  }

  topologicalOrder(): string[] {
    if (this.kind !== GRAPH_KIND.dag && this.kind !== GRAPH_KIND.generic) {
      throw new Error(`Topological order is only defined for DAG-like graphs, received ${this.kind}.`);
    }

    return this.topologicalOrderIndices().map((index) => this.getNodeIdAt(index));
  }

  topologicalOrderIndices(): number[] {
    if (this.getEdges().some((edge) => classifyEdge(edge.endpoint1, edge.endpoint2) !== GRAPH_EDGE_PATTERN.directed)) {
      throw new Error("Topological order requires a directed acyclic graph.");
    }

    const indegree = Array.from({ length: this.size }, (_, index) => this.getParentIds(this.getNodeIdAt(index)).length);
    const queue = indegree
      .map((degree, index) => ({ degree, index }))
      .filter((entry) => entry.degree === 0)
      .map((entry) => entry.index)
      .sort((left, right) => left - right);
    const order: number[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        continue;
      }

      order.push(current);
      for (const child of this.getChildIds(this.getNodeIdAt(current)).map((nodeId) => this.getNodeIndex(nodeId))) {
        indegree[child]! -= 1;
        if (indegree[child] === 0) {
          queue.push(child);
          queue.sort((left, right) => left - right);
        }
      }
    }

    if (order.length !== this.size) {
      throw new Error("Expected a DAG when constructing a topological order.");
    }

    return order;
  }

  validate(): GraphValidationResult {
    const issues: GraphValidationIssue[] = [];
    const nodeIds = new Set<string>();

    for (const node of this.nodes) {
      if (nodeIds.has(node.id)) {
        issues.push({
          code: "duplicate-node",
          message: `Duplicate node id: ${node.id}`,
          nodeId: node.id
        });
      }
      nodeIds.add(node.id);
    }

    for (let index1 = 0; index1 < this.nodes.length; index1 += 1) {
      for (let index2 = index1 + 1; index2 < this.nodes.length; index2 += 1) {
        const node1 = this.getNodeAt(index1).id;
        const node2 = this.getNodeAt(index2).id;
        const endpoint1 = this.getAdjacencyEndpoint(index1, index2);
        const endpoint2 = this.getAdjacencyEndpoint(index2, index1);
        const pattern = validateEndpointPair(endpoint1, endpoint2);

        if (pattern === GRAPH_EDGE_PATTERN.invalid) {
          issues.push({
            code: endpoint1 === EDGE_ENDPOINT.none || endpoint2 === EDGE_ENDPOINT.none ? "dangling-endpoint" : "illegal-edge-pattern",
            message: `Invalid endpoint pair between ${node1} and ${node2}: ${endpoint1}/${endpoint2}.`,
            edge: { node1, node2, endpoint1, endpoint2 },
            graphKind: this.kind
          });
          continue;
        }

        if (!allowsPattern(this.kind, pattern)) {
          issues.push({
            code: "illegal-edge-pattern",
            message: `Graph kind ${this.kind} does not allow ${pattern} edges between ${node1} and ${node2}.`,
            edge: { node1, node2, endpoint1, endpoint2 },
            graphKind: this.kind
          });
        }
      }
    }

    if (
      this.kind === GRAPH_KIND.dag ||
      this.kind === GRAPH_KIND.cpdag ||
      this.kind === GRAPH_KIND.admg ||
      this.kind === GRAPH_KIND.pag
    ) {
      if (this.hasDirectedCycle()) {
        issues.push({
          code: "directed-cycle",
          message: `Graph kind ${this.kind} does not allow directed cycles.`,
          graphKind: this.kind
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  assertValid(): this {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(validation.issues.map((issue) => issue.message).join("; "));
    }

    return this;
  }

  protected hasSemiDirectedCycle(): boolean {
    for (let index = 0; index < this.size; index += 1) {
      if (this.existsSemiDirectedCycle(index, index, new Set<number>([index]), undefined, 0)) {
        return true;
      }
    }

    return false;
  }

  private existsSemiDirectedCycle(
    start: number,
    current: number,
    visited: Set<number>,
    previous: number | undefined,
    depth: number
  ): boolean {
    for (const next of this.neighbors(current)) {
      if (previous !== undefined && next === previous) {
        continue;
      }

      if (!this.canTraverseSemiDirected(current, next)) {
        continue;
      }

      if (next === start && depth >= 1) {
        return true;
      }

      if (visited.has(next)) {
        continue;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(next);
      if (this.existsSemiDirectedCycle(start, next, nextVisited, current, depth + 1)) {
        return true;
      }
    }

    return false;
  }

  private canTraverseSemiDirected(fromIndex: number, toIndex: number): boolean {
    const fromId = this.getNodeIdAt(fromIndex);
    const toId = this.getNodeIdAt(toIndex);
    return this.isAdjacentTo(fromId, toId) && this.getEndpoint(fromId, toId) !== EDGE_ENDPOINT.arrow;
  }

  private getPairIndices(node1: string, node2: string): [number, number] {
    return [this.getNodeIndex(node1), this.getNodeIndex(node2)];
  }

  private getNodeAt(index: number): InternalNode {
    const node = this.nodes[index];
    if (!node) {
      throw new Error(`Unknown node index: ${index}`);
    }
    return node;
  }

  private getNodeById(nodeId: string): InternalNode {
    return this.getNodeAt(this.getNodeIndex(nodeId));
  }

  private getAdjacencyEndpoint(rowIndex: number, columnIndex: number): EdgeEndpoint {
    const row = this.adjacency[rowIndex];
    if (!row) {
      throw new Error(`Unknown adjacency row index: ${rowIndex}`);
    }

    const endpoint = row[columnIndex];
    if (endpoint === undefined) {
      throw new Error(`Unknown adjacency column index: ${columnIndex}`);
    }

    return endpoint;
  }
}

function edgeMetadataMatches(
  left: GraphMetadata | undefined,
  right: GraphMetadata | undefined
): boolean {
  return shallowEqualMetadata(left, right);
}

export function pdagToDag(cpdag: GraphIR): GraphIR {
  const kind = cpdag.getKind();
  if (kind !== GRAPH_KIND.cpdag && kind !== GRAPH_KIND.generic) {
    throw new Error(`PDAG to DAG conversion requires a CPDAG-like graph, received ${kind}.`);
  }

  for (const edge of cpdag.getEdges()) {
    const pattern = classifyEdge(edge.endpoint1, edge.endpoint2);
    if (pattern !== GRAPH_EDGE_PATTERN.directed && pattern !== GRAPH_EDGE_PATTERN.undirected) {
      throw new Error("PDAG to DAG conversion only supports directed and undirected edges.");
    }
  }

  const dagOptions: GraphConstructorOptions = {
    kind: GRAPH_KIND.dag,
    nodes: cpdag.getNodes(),
    validate: false
  };
  const cpdagMetadata = cpdag.getMetadata();
  if (cpdagMetadata !== undefined) {
    dagOptions.metadata = cpdagMetadata;
  }
  const dag = new GraphIR(dagOptions);

  for (const edge of cpdag.getEdges()) {
    if (classifyEdge(edge.endpoint1, edge.endpoint2) === GRAPH_EDGE_PATTERN.directed) {
      const directed = cpdag.getDirectedEdgePairs().find(
        (pair) =>
          (pair.from === edge.node1 && pair.to === edge.node2) ||
          (pair.from === edge.node2 && pair.to === edge.node1)
      );
      if (!directed) {
        throw new Error(`Expected a directed edge for ${edge.node1}-${edge.node2}.`);
      }
      dag.addDirectedEdge(directed.from, directed.to, edge.metadata);
    }
  }

  const active = new Set<number>(Array.from({ length: cpdag.size }, (_, index) => index));
  while (active.size > 0) {
    let removed = false;

    for (let nodeIndex = 0; nodeIndex < cpdag.size; nodeIndex += 1) {
      if (!active.has(nodeIndex)) {
        continue;
      }

      const nodeId = cpdag.getNodeIdAt(nodeIndex);
      const activeChildren = cpdag
        .getChildIds(nodeId)
        .map((childId) => cpdag.getNodeIndex(childId))
        .filter((index) => active.has(index));
      if (activeChildren.length > 0) {
        continue;
      }

      const neighbors = cpdag
        .getNeighborIds(nodeId)
        .map((neighborId) => cpdag.getNodeIndex(neighborId))
        .filter((index) => active.has(index));
      const adjacent = cpdag.neighbors(nodeIndex).filter((index) => active.has(index));

      let sink = true;
      for (const neighbor of neighbors) {
        for (const candidate of adjacent) {
          if (candidate === neighbor) {
            continue;
          }

          if (!cpdag.isAdjacentTo(cpdag.getNodeIdAt(neighbor), cpdag.getNodeIdAt(candidate))) {
            sink = false;
            break;
          }
        }

        if (!sink) {
          break;
        }
      }

      if (!sink) {
        continue;
      }

      for (const neighborIndex of neighbors) {
        const neighborId = cpdag.getNodeIdAt(neighborIndex);
        const edgeMetadata = cpdag.getEdgeMetadata(nodeId, neighborId);
        dag.addDirectedEdge(neighborId, nodeId, edgeMetadata);
      }

      active.delete(nodeIndex);
      removed = true;
      break;
    }

    if (!removed) {
      throw new Error("Failed to find a consistent extension for the current PDAG.");
    }
  }

  dag.assertValid();
  return dag;
}

export function dagToCpdag(graph: GraphIR): GraphIR {
  const kind = graph.getKind();
  if (kind !== GRAPH_KIND.dag && kind !== GRAPH_KIND.generic) {
    throw new Error(`DAG to CPDAG conversion requires a DAG-like graph, received ${kind}.`);
  }

  const orderedNodes = graph.topologicalOrderIndices();
  const edges = graph.getDirectedEdgePairs().map((edge) => [
    graph.getNodeIndex(edge.from),
    graph.getNodeIndex(edge.to)
  ] as const);
  const orderedEdges: Array<readonly [number, number]> = [];

  while (orderedEdges.length < edges.length) {
    let target = -1;

    for (let targetOrder = orderedNodes.length - 1; targetOrder >= 0; targetOrder -= 1) {
      const candidateTarget = orderedNodes[targetOrder]!;
      const incidentParents = graph
        .getParentIds(graph.getNodeIdAt(candidateTarget))
        .map((nodeId) => graph.getNodeIndex(nodeId));
      if (incidentParents.length === 0) {
        continue;
      }

      const orderedParents = orderedEdges
        .filter(([, child]) => child === candidateTarget)
        .map(([parent]) => parent);

      if (incidentParents.some((parent) => !orderedParents.includes(parent))) {
        target = candidateTarget;
        break;
      }
    }

    if (target < 0) {
      throw new Error("Failed to order DAG edges for CPDAG conversion.");
    }

    for (const source of orderedNodes) {
      const alreadyOrdered = orderedEdges.some(([parent, child]) => parent === source && child === target);
      if (!alreadyOrdered && graph.isParentOf(graph.getNodeIdAt(source), graph.getNodeIdAt(target))) {
        orderedEdges.push([source, target]);
        break;
      }
    }
  }

  const labels = Array.from({ length: orderedEdges.length }, () => 0);
  while (labels.includes(0)) {
    let edgeIndex = -1;
    for (let index = orderedEdges.length - 1; index >= 0; index -= 1) {
      if (labels[index] === 0) {
        edgeIndex = index;
        break;
      }
    }

    if (edgeIndex < 0) {
      break;
    }

    const [from, to] = orderedEdges[edgeIndex]!;
    let forced = false;

    for (let parentEdgeIndex = 0; parentEdgeIndex < orderedEdges.length; parentEdgeIndex += 1) {
      const [parent, child] = orderedEdges[parentEdgeIndex]!;
      if (child !== from || labels[parentEdgeIndex] !== 1) {
        continue;
      }

      if (!graph.isParentOf(graph.getNodeIdAt(parent), graph.getNodeIdAt(to))) {
        for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
          if (orderedEdges[labelIndex]![1] === to) {
            labels[labelIndex] = 1;
          }
        }
        forced = true;
        break;
      }

      const targetEdgeIndex = orderedEdges.findIndex(
        ([candidateParent, candidateChild]) => candidateParent === parent && candidateChild === to
      );
      if (targetEdgeIndex >= 0) {
        labels[targetEdgeIndex] = 1;
      }
    }

    if (forced) {
      continue;
    }

    const otherParents = graph
      .getParentIds(graph.getNodeIdAt(to))
      .map((nodeId) => graph.getNodeIndex(nodeId))
      .filter((parent) => parent !== from);
    const compelled = otherParents.some(
      (parent) => !graph.isParentOf(graph.getNodeIdAt(parent), graph.getNodeIdAt(from))
    );

    if (compelled) {
      labels[edgeIndex] = 1;
      for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
        if (orderedEdges[labelIndex]![1] === to && labels[labelIndex] === 0) {
          labels[labelIndex] = 1;
        }
      }
      continue;
    }

    labels[edgeIndex] = -1;
    for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
      if (orderedEdges[labelIndex]![1] === to && labels[labelIndex] === 0) {
        labels[labelIndex] = -1;
      }
    }
  }

  const cpdagOptions: GraphConstructorOptions = {
    kind: GRAPH_KIND.cpdag,
    nodes: graph.getNodes(),
    validate: false
  };
  const graphMetadata = graph.getMetadata();
  if (graphMetadata !== undefined) {
    cpdagOptions.metadata = graphMetadata;
  }
  const cpdag = new GraphIR(cpdagOptions);

  for (let index = 0; index < orderedEdges.length; index += 1) {
    const [from, to] = orderedEdges[index]!;
    const fromId = graph.getNodeIdAt(from);
    const toId = graph.getNodeIdAt(to);
    const edge = graph.getEdge(fromId, toId);

    if (labels[index] === 1) {
      cpdag.addDirectedEdge(fromId, toId, edge?.metadata);
    } else {
      cpdag.addUndirectedEdge(fromId, toId, edge?.metadata);
    }
  }

  cpdag.assertValid();
  return cpdag;
}

export function graphShapesEqual(left: GraphShape, right: GraphShape): boolean {
  if ((left.kind ?? GRAPH_KIND.generic) !== (right.kind ?? GRAPH_KIND.generic)) {
    return false;
  }

  if (!shallowEqualMetadata(left.metadata, right.metadata)) {
    return false;
  }

  if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) {
    return false;
  }

  for (let index = 0; index < left.nodes.length; index += 1) {
    const leftNode = left.nodes[index]!;
    const rightNode = right.nodes[index]!;
    if (
      leftNode.id !== rightNode.id ||
      leftNode.label !== rightNode.label ||
      leftNode.nodeType !== rightNode.nodeType ||
      leftNode.position?.x !== rightNode.position?.x ||
      leftNode.position?.y !== rightNode.position?.y ||
      !shallowEqualMetadata(mergeMetadata(leftNode.metadata, leftNode.attributes), mergeMetadata(rightNode.metadata, rightNode.attributes))
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.edges.length; index += 1) {
    const leftEdge = left.edges[index]!;
    const rightEdge = right.edges[index]!;
    if (
      leftEdge.node1 !== rightEdge.node1 ||
      leftEdge.node2 !== rightEdge.node2 ||
      leftEdge.endpoint1 !== rightEdge.endpoint1 ||
      leftEdge.endpoint2 !== rightEdge.endpoint2 ||
      !edgeMetadataMatches(leftEdge.metadata, rightEdge.metadata)
    ) {
      return false;
    }
  }

  return true;
}
