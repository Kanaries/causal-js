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

function getDefaultUcPriority(ucRule: 0 | 1 | 2): 2 | 3 | 4 {
  if (ucRule === 2) {
    return 4;
  }

  return 3;
}

function resolveUcPriority(ucRule: 0 | 1 | 2, ucPriority: PcOptions["ucPriority"]): 0 | 1 | 2 | 3 | 4 {
  if (ucPriority === undefined) {
    return 2;
  }

  if (ucPriority === -1) {
    return getDefaultUcPriority(ucRule);
  }

  return ucPriority;
}

function sortConditioningSet(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function buildConditioningSetCandidates(graph: CausalGraph, x: number, z: number): number[][] {
  const candidates = new Map<string, number[]>();

  for (const neighbors of [graph.neighbors(x), graph.neighbors(z)]) {
    for (let size = 0; size <= neighbors.length; size += 1) {
      for (const conditioningSet of combinations(neighbors, size)) {
        const normalized = sortConditioningSet(conditioningSet);
        const key = normalized.join(",");
        if (!candidates.has(key)) {
          candidates.set(key, normalized);
        }
      }
    }
  }

  return [...candidates.values()];
}

function isColliderBlockedByBackgroundKnowledge(
  backgroundKnowledge: BackgroundKnowledge | undefined,
  graph: CausalGraph,
  x: number,
  y: number,
  z: number
): boolean {
  if (!backgroundKnowledge) {
    return false;
  }

  const xId = graph.getNodeIdAt(x);
  const yId = graph.getNodeIdAt(y);
  const zId = graph.getNodeIdAt(z);

  return (
    backgroundKnowledge.isForbidden(xId, yId) ||
    backgroundKnowledge.isForbidden(zId, yId) ||
    backgroundKnowledge.isRequired(yId, xId) ||
    backgroundKnowledge.isRequired(yId, zId)
  );
}

function orientColliderEndpointWithPriorityOne(
  graph: CausalGraph,
  fromId: string,
  toId: string
): void {
  if (graph.isParentOf(fromId, toId) || graph.isBidirectedEdge(fromId, toId)) {
    return;
  }

  if (graph.isParentOf(toId, fromId)) {
    graph.setEdge(fromId, toId, EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.arrow);
    return;
  }

  graph.orientEdge(fromId, toId);
}

function orientColliderWithPriority(
  graph: CausalGraph,
  x: number,
  y: number,
  z: number,
  priority: 0 | 1 | 2 | 3 | 4
): boolean {
  const xId = graph.getNodeIdAt(x);
  const yId = graph.getNodeIdAt(y);
  const zId = graph.getNodeIdAt(z);

  if (priority === 0) {
    graph.orientEdge(xId, yId);
    graph.orientEdge(zId, yId);
    return true;
  }

  if (priority === 1) {
    orientColliderEndpointWithPriorityOne(graph, xId, yId);
    orientColliderEndpointWithPriorityOne(graph, zId, yId);
    return true;
  }

  if (graph.isFullyDirected(y, x) || graph.isFullyDirected(y, z)) {
    return false;
  }

  graph.orientEdge(xId, yId);
  graph.orientEdge(zId, yId);
  return true;
}

function allSepsetsExcludeMiddle(
  sepsetLookup: Map<string, number[][]>,
  x: number,
  z: number,
  y: number
): boolean {
  return (sepsetLookup.get(pairKey(x, z)) ?? []).every((conditioningSet) => !conditioningSet.includes(y));
}

interface RankedCollider {
  triple: [number, number, number];
  score: number;
}

function sortRankedColliders(
  colliders: readonly RankedCollider[],
  direction: "ascending" | "descending"
): RankedCollider[] {
  return [...colliders].sort((left, right) => {
    return direction === "ascending" ? left.score - right.score : right.score - left.score;
  });
}

function orientUcSepset(
  graph: CausalGraph,
  sepsets: SeparationSetEntry[],
  priority: 0 | 1 | 2 | 3 | 4,
  ciTest: PcOptions["ciTest"],
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  const sepsetLookup = buildSepsetLookup(sepsets);
  const rankedColliders: RankedCollider[] = [];

  for (const [x, y, z] of graph.findUnshieldedTriples()) {
    if (x >= z || isColliderBlockedByBackgroundKnowledge(backgroundKnowledge, graph, x, y, z)) {
      continue;
    }

    if (!allSepsetsExcludeMiddle(sepsetLookup, x, z, y)) {
      continue;
    }

    if (priority <= 2) {
      orientColliderWithPriority(graph, x, y, z, priority);
      continue;
    }

    const conditioningSets = buildConditioningSetCandidates(graph, x, z).filter((conditioningSet) =>
      priority === 3 ? conditioningSet.includes(y) : !conditioningSet.includes(y)
    );
    const score = Math.max(...conditioningSets.map((conditioningSet) => ciTest.test(x, z, conditioningSet)));
    rankedColliders.push({
      triple: [x, y, z],
      score
    });
  }

  const orderedColliders = sortRankedColliders(
    rankedColliders,
    priority === 3 ? "ascending" : "descending"
  );

  for (const { triple: [x, y, z] } of orderedColliders) {
    if (isColliderBlockedByBackgroundKnowledge(backgroundKnowledge, graph, x, y, z)) {
      continue;
    }

    orientColliderWithPriority(graph, x, y, z, priority);
  }

  return graph;
}

function orientMaxP(
  graph: CausalGraph,
  priority: 0 | 1 | 2 | 3 | 4,
  ciTest: PcOptions["ciTest"],
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  const rankedColliders: RankedCollider[] = [];

  for (const [x, y, z] of graph.findUnshieldedTriples()) {
    if (x >= z || isColliderBlockedByBackgroundKnowledge(backgroundKnowledge, graph, x, y, z)) {
      continue;
    }

    const conditioningSets = buildConditioningSetCandidates(graph, x, z);
    const condWithY = conditioningSets.filter((conditioningSet) => conditioningSet.includes(y));
    const condWithoutY = conditioningSets.filter((conditioningSet) => !conditioningSet.includes(y));
    const maxPContainY = Math.max(...condWithY.map((conditioningSet) => ciTest.test(x, z, conditioningSet)));
    const maxPNotContainY = Math.max(
      ...condWithoutY.map((conditioningSet) => ciTest.test(x, z, conditioningSet))
    );

    if (maxPNotContainY <= maxPContainY) {
      continue;
    }

    if (priority <= 2) {
      orientColliderWithPriority(graph, x, y, z, priority);
      continue;
    }

    rankedColliders.push({
      triple: [x, y, z],
      score: priority === 3 ? maxPContainY : maxPNotContainY
    });
  }

  const orderedColliders = sortRankedColliders(
    rankedColliders,
    priority === 3 ? "ascending" : "descending"
  );

  for (const { triple: [x, y, z] } of orderedColliders) {
    if (isColliderBlockedByBackgroundKnowledge(backgroundKnowledge, graph, x, y, z)) {
      continue;
    }

    orientColliderWithPriority(graph, x, y, z, priority);
  }

  return graph;
}

function tripleKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function definiteMeekOrient(
  graph: CausalGraph,
  definiteUc: ReadonlySet<string>,
  definiteNonUc: ReadonlySet<string>,
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  const triangles = graph.findTriangles();
  const kites = graph.findKites();
  let changed = true;

  while (changed) {
    changed = false;

    for (const key of definiteNonUc) {
      const [iText, jText, kText] = key.split(":");
      const i = Number(iText);
      const j = Number(jText);
      const k = Number(kText);

      if (
        graph.isFullyDirected(i, j) &&
        graph.isUndirected(j, k) &&
        canOrient(backgroundKnowledge, graph.getNodeIdAt(j), graph.getNodeIdAt(k)) &&
        !graph.isAncestorOf(graph.getNodeIdAt(k), graph.getNodeIdAt(j))
      ) {
        if (orientUndirectedEdge(graph, graph.getNodeIdAt(j), graph.getNodeIdAt(k))) {
          changed = true;
        }
      } else if (
        graph.isFullyDirected(k, j) &&
        graph.isUndirected(j, i) &&
        canOrient(backgroundKnowledge, graph.getNodeIdAt(j), graph.getNodeIdAt(i)) &&
        !graph.isAncestorOf(graph.getNodeIdAt(i), graph.getNodeIdAt(j))
      ) {
        if (orientUndirectedEdge(graph, graph.getNodeIdAt(j), graph.getNodeIdAt(i))) {
          changed = true;
        }
      }
    }

    for (const [i, j, k] of triangles) {
      const iId = graph.getNodeIdAt(i);
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

    for (const [i, j, k, l] of kites) {
      const hasDefiniteUc =
        definiteUc.has(tripleKey(j, l, k)) || definiteUc.has(tripleKey(k, l, j));
      const hasDefiniteNonUc =
        definiteNonUc.has(tripleKey(j, i, k)) || definiteNonUc.has(tripleKey(k, i, j));

      if (!hasDefiniteUc || !hasDefiniteNonUc || !graph.isUndirected(i, l)) {
        continue;
      }

      const iId = graph.getNodeIdAt(i);
      const lId = graph.getNodeIdAt(l);
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

function orientDefiniteMaxP(
  graph: CausalGraph,
  alpha: number,
  priority: 2 | 3 | 4,
  ciTest: PcOptions["ciTest"],
  backgroundKnowledge?: BackgroundKnowledge
): CausalGraph {
  const rankedColliders: RankedCollider[] = [];
  const definiteUc = new Set<string>();
  const definiteNonUc = new Set<string>();

  for (const [x, y, z] of graph.findUnshieldedTriples()) {
    if (x >= z) {
      continue;
    }

    const conditioningSets = buildConditioningSetCandidates(graph, x, z);
    const condWithY = conditioningSets.filter((conditioningSet) => conditioningSet.includes(y));
    const condWithoutY = conditioningSets.filter((conditioningSet) => !conditioningSet.includes(y));
    let maxPContainY = 0;
    let maxPNotContainY = 0;
    let ucCandidate = true;
    let nonUcCandidate = true;

    for (const conditioningSet of condWithY) {
      const pValue = ciTest.test(x, z, conditioningSet);
      if (pValue > alpha) {
        ucCandidate = false;
        break;
      }
      if (pValue > maxPContainY) {
        maxPContainY = pValue;
      }
    }

    for (const conditioningSet of condWithoutY) {
      const pValue = ciTest.test(x, z, conditioningSet);
      if (pValue > alpha) {
        nonUcCandidate = false;
        if (!ucCandidate) {
          break;
        }
      }
      if (pValue > maxPNotContainY) {
        maxPNotContainY = pValue;
      }
    }

    if (ucCandidate) {
      if (nonUcCandidate) {
        if (maxPNotContainY > maxPContainY) {
          rankedColliders.push({
            triple: [x, y, z],
            score: priority === 4 ? maxPNotContainY : maxPContainY
          });
        } else {
          definiteNonUc.add(tripleKey(x, y, z));
        }
      } else {
        rankedColliders.push({
          triple: [x, y, z],
          score: priority === 4 ? maxPNotContainY : maxPContainY
        });
      }
    } else if (nonUcCandidate) {
      definiteNonUc.add(tripleKey(x, y, z));
    }
  }

  const orderedColliders = sortRankedColliders(
    rankedColliders,
    priority === 4 ? "descending" : "ascending"
  );

  for (const { triple: [x, y, z] } of orderedColliders) {
    if (isColliderBlockedByBackgroundKnowledge(backgroundKnowledge, graph, x, y, z)) {
      continue;
    }

    if (orientColliderWithPriority(graph, x, y, z, 2)) {
      definiteUc.add(tripleKey(x, y, z));
    }
  }

  definiteMeekOrient(graph, definiteUc, definiteNonUc, backgroundKnowledge);
  return graph;
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

    // causal-learn's uc_sepset(priority=2) only orients the collider when
    // neither side has already been directed out of the center node.
    if (graph.isParentOf(yId, xId) || graph.isParentOf(yId, zId)) {
      continue;
    }

    graph.orientEdge(xId, yId);
    graph.orientEdge(zId, yId);
  }

  return graph;
}

export function orientPcGraph(
  graph: CausalGraph,
  options: Pick<PcOptions, "alpha" | "backgroundKnowledge" | "ciTest" | "ucPriority" | "ucRule">,
  sepsets: SeparationSetEntry[]
): CausalGraph {
  const ucRule = options.ucRule ?? 0;
  const priority = resolveUcPriority(ucRule, options.ucPriority);

  if (ucRule === 2 && ![2, 3, 4].includes(priority)) {
    throw new Error(`pc ucPriority=${priority} is invalid for ucRule=2.`);
  }

  orientByBackgroundKnowledge(graph, options.backgroundKnowledge);

  if (ucRule === 0) {
    orientUcSepset(graph, sepsets, priority, options.ciTest, options.backgroundKnowledge);
    meekOrient(graph, options.backgroundKnowledge);
    return graph;
  }

  if (ucRule === 1) {
    orientMaxP(graph, priority, options.ciTest, options.backgroundKnowledge);
    meekOrient(graph, options.backgroundKnowledge);
    return graph;
  }

  orientDefiniteMaxP(graph, options.alpha ?? 0.05, priority as 2 | 3 | 4, options.ciTest, options.backgroundKnowledge);
  meekOrient(graph, options.backgroundKnowledge);
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
        const collectedSepsets: number[][] = [];

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
          collectedSepsets.push(sortConditioningSet(conditioningSet));
        }

        if (pendingRemoval.has(pairKey(x, y))) {
          const sepsetEntries = collectedSepsets.length > 0 ? collectedSepsets : [[]];
          for (const conditioningSet of sepsetEntries) {
            appendSepset(sepsets, x, y, conditioningSet);
            appendSepset(sepsets, y, x, conditioningSet);
          }
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
  orientPcGraph(graph, options, skeleton.sepsets);

  return {
    ...skeleton,
    graph: graph.toShape()
  };
}
