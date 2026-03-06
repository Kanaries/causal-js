import { CausalGraph, EDGE_ENDPOINT, type BackgroundKnowledge } from "@causal-js/core";

import type { PcOptions, PcResult, PcSkeletonResult, SeparationSetEntry } from "./contracts";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function pairKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function appendSepset(
  sepsets: Map<string, number[][]>,
  x: number,
  y: number,
  conditioningSet: readonly number[]
): void {
  const key = pairKey(x, y);
  const existing = sepsets.get(key) ?? [];
  const normalized = [...conditioningSet].sort((left, right) => left - right);
  if (!existing.some((entry) => entry.length === normalized.length && entry.every((value, index) => value === normalized[index]))) {
    existing.push(normalized);
  }
  sepsets.set(key, existing);
}

function* combinations(values: readonly number[], size: number): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }

  if (values.length < size) {
    return;
  }

  for (let index = 0; index <= values.length - size; index += 1) {
    const head = values[index];
    if (head === undefined) {
      continue;
    }

    for (const tail of combinations(values.slice(index + 1), size - 1)) {
      yield [head, ...tail];
    }
  }
}

function removeEdge(graph: CausalGraph, x: number, y: number): void {
  graph.removeEdge(graph.getNodeIdAt(x), graph.getNodeIdAt(y));
}

function isKnowledgeForbiddenBothWays(
  backgroundKnowledge: BackgroundKnowledge | undefined,
  graph: CausalGraph,
  x: number,
  y: number
): boolean {
  if (!backgroundKnowledge) {
    return false;
  }

  const xId = graph.getNodeIdAt(x);
  const yId = graph.getNodeIdAt(y);
  return backgroundKnowledge.isForbidden(xId, yId) && backgroundKnowledge.isForbidden(yId, xId);
}

function serializeSepsets(sepsets: Map<string, number[][]>): SeparationSetEntry[] {
  return [...sepsets.entries()].map(([key, conditioningSets]) => {
    const [xText, yText] = key.split(":");
    const x = Number(xText);
    const y = Number(yText);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error(`Invalid sepset key: ${key}`);
    }

    return {
      x,
      y,
      conditioningSets: conditioningSets.map((entry) => [...entry])
    };
  });
}

function materializeGraph(result: PcSkeletonResult): CausalGraph {
  return CausalGraph.fromShape(result.graph);
}

function canOrient(
  backgroundKnowledge: BackgroundKnowledge | undefined,
  from: string,
  to: string
): boolean {
  if (!backgroundKnowledge) {
    return true;
  }

  if (backgroundKnowledge.isForbidden(from, to)) {
    return false;
  }

  if (backgroundKnowledge.isRequired(to, from)) {
    return false;
  }

  return true;
}

function buildSepsetLookup(sepsets: SeparationSetEntry[]): Map<string, number[][]> {
  return new Map(sepsets.map((entry) => [pairKey(entry.x, entry.y), entry.conditioningSets.map((set) => [...set])]));
}

function orientUndirectedEdge(graph: CausalGraph, from: string, to: string): boolean {
  if (!graph.isUndirectedFromTo(from, to)) {
    return false;
  }

  graph.orientEdge(from, to);
  return true;
}

export function orientByBackgroundKnowledge(
  graph: CausalGraph,
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  if (!backgroundKnowledge) {
    return graph;
  }

  for (const edge of graph.getEdges()) {
    if (!graph.isUndirectedFromTo(edge.node1, edge.node2)) {
      continue;
    }

    if (backgroundKnowledge.isForbidden(edge.node2, edge.node1)) {
      orientUndirectedEdge(graph, edge.node1, edge.node2);
      continue;
    }

    if (backgroundKnowledge.isForbidden(edge.node1, edge.node2)) {
      orientUndirectedEdge(graph, edge.node2, edge.node1);
      continue;
    }

    if (backgroundKnowledge.isRequired(edge.node2, edge.node1)) {
      orientUndirectedEdge(graph, edge.node2, edge.node1);
      continue;
    }

    if (backgroundKnowledge.isRequired(edge.node1, edge.node2)) {
      orientUndirectedEdge(graph, edge.node1, edge.node2);
    }
  }

  return graph;
}

export function orientColliders(
  graph: CausalGraph,
  sepsets: SeparationSetEntry[],
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  const sepsetLookup = buildSepsetLookup(sepsets);

  for (const [x, y, z] of graph.findUnshieldedTriples()) {
    if (x >= z) {
      continue;
    }

    const xId = graph.getNodeIdAt(x);
    const yId = graph.getNodeIdAt(y);
    const zId = graph.getNodeIdAt(z);

    if (
      !canOrient(backgroundKnowledge, xId, yId) ||
      !canOrient(backgroundKnowledge, zId, yId)
    ) {
      continue;
    }

    const conditioningSets = sepsetLookup.get(pairKey(x, z)) ?? [];
    const yInSepset = conditioningSets.some((conditioningSet) => conditioningSet.includes(y));
    if (yInSepset) {
      continue;
    }

    if (graph.isUndirectedFromTo(xId, yId)) {
      graph.orientEdge(xId, yId);
    }

    if (graph.isUndirectedFromTo(zId, yId)) {
      graph.orientEdge(zId, yId);
    }
  }

  return graph;
}

export function meekOrient(
  graph: CausalGraph,
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  let changed = true;

  while (changed) {
    changed = false;

    for (const [i, j, k] of graph.findUnshieldedTriples()) {
      const iId = graph.getNodeIdAt(i);
      const jId = graph.getNodeIdAt(j);
      const kId = graph.getNodeIdAt(k);

      if (!graph.isFullyDirected(i, j) || !graph.isUndirected(j, k)) {
        continue;
      }

      if (!canOrient(backgroundKnowledge, jId, kId) || graph.isAncestorOf(kId, jId)) {
        continue;
      }

      if (orientUndirectedEdge(graph, jId, kId)) {
        changed = true;
      }
    }

    for (const [i, j, k] of graph.findTriangles()) {
      const iId = graph.getNodeIdAt(i);
      const jId = graph.getNodeIdAt(j);
      const kId = graph.getNodeIdAt(k);

      if (!graph.isFullyDirected(i, j) || !graph.isFullyDirected(j, k) || !graph.isUndirected(i, k)) {
        continue;
      }

      if (!canOrient(backgroundKnowledge, iId, kId) || graph.isAncestorOf(kId, iId)) {
        continue;
      }

      if (orientUndirectedEdge(graph, iId, kId)) {
        changed = true;
      }
    }

    for (const [i, j, k, l] of graph.findKites()) {
      const iId = graph.getNodeIdAt(i);
      const jId = graph.getNodeIdAt(j);
      const kId = graph.getNodeIdAt(k);
      const lId = graph.getNodeIdAt(l);

      if (
        !graph.isUndirected(i, j) ||
        !graph.isUndirected(i, k) ||
        !graph.isFullyDirected(j, l) ||
        !graph.isFullyDirected(k, l) ||
        !graph.isUndirected(i, l)
      ) {
        continue;
      }

      if (!canOrient(backgroundKnowledge, iId, lId) || graph.isAncestorOf(lId, iId)) {
        continue;
      }

      if (orientUndirectedEdge(graph, iId, lId)) {
        changed = true;
      }
    }
  }

  return graph;
}

export function skeletonDiscovery(options: PcOptions): PcSkeletonResult {
  const alpha = options.alpha ?? 0.05;
  const stable = options.stable ?? true;
  const variableCount = options.data.columns;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  const graph = new CausalGraph(nodeLabels.map((id) => ({ id }))).fullyConnect(EDGE_ENDPOINT.tail);
  const sepsets = new Map<string, number[][]>();

  let depth = -1;
  let testsRun = 0;

  while (graph.getMaxDegree() - 1 > depth) {
    depth += 1;
    const pendingRemoval = new Set<string>();

    for (let x = 0; x < variableCount; x += 1) {
      const neighborsOfX = graph.neighbors(x);
      if (neighborsOfX.length < depth) {
        continue;
      }

      for (const y of neighborsOfX) {
        if (!graph.isAdjacentTo(graph.getNodeIdAt(x), graph.getNodeIdAt(y))) {
          continue;
        }

        if (isKnowledgeForbiddenBothWays(options.backgroundKnowledge, graph, x, y)) {
          if (stable) {
            pendingRemoval.add(pairKey(x, y));
            pendingRemoval.add(pairKey(y, x));
          } else {
            removeEdge(graph, x, y);
            appendSepset(sepsets, x, y, []);
            appendSepset(sepsets, y, x, []);
          }
          continue;
        }

        const candidateNeighbors = neighborsOfX.filter((neighbor) => neighbor !== y);
        const collectedSepsets = new Set<number>();

        for (const conditioningSet of combinations(candidateNeighbors, depth)) {
          testsRun += 1;
          const pValue = options.ciTest.test(x, y, conditioningSet);
          if (pValue <= alpha) {
            continue;
          }

          if (!stable) {
            removeEdge(graph, x, y);
            appendSepset(sepsets, x, y, conditioningSet);
            appendSepset(sepsets, y, x, conditioningSet);
            break;
          }

          pendingRemoval.add(pairKey(x, y));
          pendingRemoval.add(pairKey(y, x));
          for (const entry of conditioningSet) {
            collectedSepsets.add(entry);
          }
        }

        if (pendingRemoval.has(pairKey(x, y))) {
          const merged = [...collectedSepsets].sort((left, right) => left - right);
          appendSepset(sepsets, x, y, merged);
          appendSepset(sepsets, y, x, merged);
        }
      }
    }

    for (const key of pendingRemoval) {
      const [xText, yText] = key.split(":");
      const x = Number(xText);
      const y = Number(yText);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new Error(`Invalid removal key: ${key}`);
      }
      removeEdge(graph, x, y);
    }
  }

  return {
    graph: graph.toShape(),
    maxDepth: depth,
    sepsets: serializeSepsets(sepsets),
    testsRun
  };
}

export function pc(options: PcOptions): PcResult {
  const skeleton = skeletonDiscovery(options);
  const graph = materializeGraph(skeleton);

  orientByBackgroundKnowledge(graph, options.backgroundKnowledge);
  orientColliders(graph, skeleton.sepsets, options.backgroundKnowledge);
  meekOrient(graph, options.backgroundKnowledge);

  return {
    ...skeleton,
    graph: graph.toShape()
  };
}
