import { CausalGraph } from "@causal-js/core";

function getParentIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getParentIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
}

function getChildIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getChildIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
}

function getTopologicalOrder(graph: CausalGraph): number[] {
  const indegree = Array.from({ length: graph.size }, (_, index) => getParentIndices(graph, index).length);
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
    for (const child of getChildIndices(graph, current)) {
      indegree[child]! -= 1;
      if (indegree[child] === 0) {
        queue.push(child);
        queue.sort((left, right) => left - right);
      }
    }
  }

  if (order.length !== graph.size) {
    throw new Error("Expected a DAG when constructing a CPDAG.");
  }

  return order;
}

export function dagToCpdag(graph: CausalGraph): CausalGraph {
  const orderedNodes = getTopologicalOrder(graph);
  const orderedEdges: Array<readonly [number, number]> = [];
  const edgeCount = graph.getNumEdges();

  while (orderedEdges.length < edgeCount) {
    let target = -1;

    for (let targetOrder = orderedNodes.length - 1; targetOrder >= 0; targetOrder -= 1) {
      const candidateTarget = orderedNodes[targetOrder]!;
      const incidentParents = getParentIndices(graph, candidateTarget);
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

    const otherParents = getParentIndices(graph, to).filter((parent) => parent !== from);
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

  const cpdag = new CausalGraph(graph.getNodes());
  for (let index = 0; index < orderedEdges.length; index += 1) {
    const [from, to] = orderedEdges[index]!;
    const fromId = graph.getNodeIdAt(from);
    const toId = graph.getNodeIdAt(to);

    if (labels[index] === 1) {
      cpdag.addDirectedEdge(fromId, toId);
    } else {
      cpdag.addUndirectedEdge(fromId, toId);
    }
  }

  return cpdag;
}
