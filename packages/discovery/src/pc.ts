import { CausalGraph, EDGE_ENDPOINT, type BackgroundKnowledge } from "@causal-js/core";

import type { PcOptions, PcSkeletonResult, SeparationSetEntry } from "./contracts";

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
