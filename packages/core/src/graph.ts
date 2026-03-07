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

export type EdgeEndpoint = (typeof EDGE_ENDPOINT)[keyof typeof EDGE_ENDPOINT];

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

export interface GraphNode {
  id: string;
  label?: string;
  nodeType?: NodeType;
  position?: NodePosition;
  attributes?: Record<string, unknown>;
}

export interface EdgeDescriptor {
  node1: string;
  node2: string;
  endpoint1: EdgeEndpoint;
  endpoint2: EdgeEndpoint;
}

export interface GraphShape {
  nodes: GraphNode[];
  edges: EdgeDescriptor[];
}

export interface DirectedEdgePair {
  from: string;
  to: string;
}

export type IndexPair = [number, number];
export type IndexTriple = [number, number, number];
export type IndexKite = [number, number, number, number];

function cloneNode(node: GraphNode): GraphNode {
  const cloned: GraphNode = { id: node.id };

  if (node.label !== undefined) {
    cloned.label = node.label;
  }

  if (node.nodeType !== undefined) {
    cloned.nodeType = node.nodeType;
  }

  if (node.position !== undefined) {
    cloned.position = { ...node.position };
  }

  if (node.attributes !== undefined) {
    cloned.attributes = { ...node.attributes };
  }

  return cloned;
}

function assertEndpoint(endpoint: EdgeEndpoint): void {
  if (!Object.values(EDGE_ENDPOINT).includes(endpoint)) {
    throw new Error(`Unknown endpoint: ${endpoint}`);
  }
}

function endpointToCode(endpoint: EdgeEndpoint): number {
  return EDGE_ENDPOINT_CODE[endpoint];
}

export class CausalGraph {
  private readonly nodes: GraphNode[] = [];
  private readonly nodeIndexById = new Map<string, number>();
  private adjacency: EdgeEndpoint[][] = [];

  constructor(nodes: readonly GraphNode[] = []) {
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  static fromNodeIds(nodeIds: readonly string[]): CausalGraph {
    return new CausalGraph(nodeIds.map((id) => ({ id })));
  }

  static fromShape(shape: GraphShape): CausalGraph {
    const graph = new CausalGraph(shape.nodes);
    for (const edge of shape.edges) {
      graph.setEdge(edge.node1, edge.node2, edge.endpoint1, edge.endpoint2);
    }
    return graph;
  }

  clone(): CausalGraph {
    return CausalGraph.fromShape(this.toShape());
  }

  get size(): number {
    return this.nodes.length;
  }

  addNode(node: GraphNode): this {
    if (this.nodeIndexById.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }

    const nextIndex = this.nodes.length;
    this.nodes.push({
      nodeType: NODE_TYPE.measured,
      ...cloneNode(node)
    });
    this.nodeIndexById.set(node.id, nextIndex);

    for (const row of this.adjacency) {
      row.push(EDGE_ENDPOINT.none);
    }

    this.adjacency.push(Array.from({ length: this.nodes.length }, () => EDGE_ENDPOINT.none));
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
    endpoint2: EdgeEndpoint
  ): this {
    if (node1 === node2) {
      throw new Error("Self edges are not supported.");
    }

    assertEndpoint(endpoint1);
    assertEndpoint(endpoint2);

    const [index1, index2] = this.getPairIndices(node1, node2);
    this.adjacency[index1]![index2] = endpoint1;
    this.adjacency[index2]![index1] = endpoint2;
    return this;
  }

  removeEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.none, EDGE_ENDPOINT.none);
  }

  clearEdges(): this {
    this.adjacency = Array.from({ length: this.nodes.length }, () =>
      Array.from({ length: this.nodes.length }, () => EDGE_ENDPOINT.none)
    );
    return this;
  }

  addDirectedEdge(from: string, to: string): this {
    return this.setEdge(from, to, EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow);
  }

  addUndirectedEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.tail, EDGE_ENDPOINT.tail);
  }

  addBidirectedEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.arrow);
  }

  addNondirectedEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.circle, EDGE_ENDPOINT.circle);
  }

  addPartiallyOrientedEdge(node1: string, node2: string): this {
    return this.setEdge(node1, node2, EDGE_ENDPOINT.circle, EDGE_ENDPOINT.arrow);
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

  isPartiallyOrientedEdge(node1: string, node2: string): boolean {
    const forward = this.getEndpoint(node1, node2);
    const reverse = this.getEndpoint(node2, node1);
    return (
      (forward === EDGE_ENDPOINT.circle && reverse === EDGE_ENDPOINT.arrow) ||
      (forward === EDGE_ENDPOINT.arrow && reverse === EDGE_ENDPOINT.circle)
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
    if (!this.isAdjacentTo(node1, node2)) {
      return undefined;
    }

    return {
      node1,
      node2,
      endpoint1: this.getEndpoint(node1, node2),
      endpoint2: this.getEndpoint(node2, node1)
    };
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

        edges.push({
          node1: this.getNodeAt(index1).id,
          node2: this.getNodeAt(index2).id,
          endpoint1,
          endpoint2
        });
      }
    }

    return edges;
  }

  toShape(): GraphShape {
    return {
      nodes: this.getNodes(),
      edges: this.getEdges()
    };
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
    return this.getEdges()
      .flatMap((edge) => {
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

  private getPairIndices(node1: string, node2: string): [number, number] {
    return [this.getNodeIndex(node1), this.getNodeIndex(node2)];
  }

  private getNodeAt(index: number): GraphNode {
    const node = this.nodes[index];
    if (!node) {
      throw new Error(`Unknown node index: ${index}`);
    }
    return node;
  }

  private getNodeById(nodeId: string): GraphNode {
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
