import { describe, expect, it } from "vitest";

import { CausalGraph, DSeparationTest, GRAPH_KIND } from "@causal-js/core";

import {
  createDagKernelGraphSnapshot,
  jsDagDSeparationKernel,
  loadBundledRustWasmDagDSeparationKernel
} from "./index";
import { randomDag, enumerateSubsets, type DirectedEdgeSpec } from "../../../tests/helpers/synthetic";

/**
 * Brute-force d-separation oracle: enumerate all undirected paths between x
 * and y (nodes are distinct along a path), a path is blocked iff it contains
 * a non-collider in Z, or a collider whose descendants (including itself)
 * are all outside Z. d-separated iff every path is blocked.
 */
function bruteForceDSeparated(
  nodeCount: number,
  edges: readonly DirectedEdgeSpec[],
  x: number,
  y: number,
  conditioned: readonly number[]
): boolean {
  const conditionedSet = new Set(conditioned);
  const children: number[][] = Array.from({ length: nodeCount }, () => []);
  const parents: number[][] = Array.from({ length: nodeCount }, () => []);
  const hasEdge = new Set<string>();
  for (const edge of edges) {
    children[edge.from]!.push(edge.to);
    parents[edge.to]!.push(edge.from);
    hasEdge.add(`${edge.from}>${edge.to}`);
  }

  const descendantsOf = (root: number): Set<number> => {
    const seen = new Set<number>([root]);
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const child of children[node]!) {
        if (!seen.has(child)) {
          seen.add(child);
          stack.push(child);
        }
      }
    }
    return seen;
  };

  const colliderOpen = (node: number): boolean => {
    for (const descendant of descendantsOf(node)) {
      if (conditionedSet.has(descendant)) {
        return true;
      }
    }
    return false;
  };

  // DFS over simple undirected paths, tracking edge directions to classify
  // interior nodes as colliders or non-colliders.
  const neighbors: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    neighbors[edge.from]!.push(edge.to);
    neighbors[edge.to]!.push(edge.from);
  }

  const pathIsOpen = (path: readonly number[]): boolean => {
    for (let index = 1; index < path.length - 1; index += 1) {
      const previous = path[index - 1]!;
      const node = path[index]!;
      const next = path[index + 1]!;
      const inFromPrevious = hasEdge.has(`${previous}>${node}`);
      const inFromNext = hasEdge.has(`${next}>${node}`);
      const isCollider = inFromPrevious && inFromNext;
      if (isCollider) {
        if (!colliderOpen(node)) {
          return false;
        }
      } else if (conditionedSet.has(node)) {
        return false;
      }
    }
    return true;
  };

  let foundOpenPath = false;
  const visit = (path: number[]): void => {
    if (foundOpenPath) {
      return;
    }
    const last = path[path.length - 1]!;
    if (last === y) {
      if (pathIsOpen(path)) {
        foundOpenPath = true;
      }
      return;
    }
    for (const neighbor of neighbors[last]!) {
      if (!path.includes(neighbor)) {
        path.push(neighbor);
        visit(path);
        path.pop();
      }
    }
  };
  visit([x]);

  return !foundOpenPath;
}

function buildGraph(nodeCount: number, edges: readonly DirectedEdgeSpec[]): CausalGraph {
  const labels = Array.from({ length: nodeCount }, (_, index) => `X${index}`);
  const graph = CausalGraph.fromNodeIds(labels, { kind: GRAPH_KIND.dag });
  for (const edge of edges) {
    graph.addDirectedEdge(`X${edge.from}`, `X${edge.to}`);
  }
  return graph;
}

describe("d-separation cross-check", () => {
  it("agrees across core DSeparationTest, JS kernel, WASM kernel, and a brute-force oracle", async () => {
    const nodeCount = 7;
    const wasmKernel = await loadBundledRustWasmDagDSeparationKernel();

    for (let seed = 1; seed <= 10; seed += 1) {
      const edges = randomDag(nodeCount, 0.3, seed);
      const graph = buildGraph(nodeCount, edges);
      const snapshot = createDagKernelGraphSnapshot(graph);
      const coreTest = new DSeparationTest(graph);

      for (let x = 0; x < nodeCount; x += 1) {
        for (let y = x + 1; y < nodeCount; y += 1) {
          const others = Array.from({ length: nodeCount }, (_, index) => index).filter(
            (index) => index !== x && index !== y
          );
          for (const conditioningSet of enumerateSubsets(others, 3)) {
            const expected = bruteForceDSeparated(nodeCount, edges, x, y, conditioningSet);
            const label = `seed=${seed} x=${x} y=${y} Z=[${conditioningSet.join(",")}]`;

            const jsResult = jsDagDSeparationKernel.dSeparates(snapshot, x, y, conditioningSet);
            expect(jsResult, `js kernel ${label}`).toBe(expected);

            const wasmResult = wasmKernel.dSeparates(snapshot, x, y, conditioningSet);
            expect(wasmResult, `wasm kernel ${label}`).toBe(expected);

            const corePValue = coreTest.test(x, y, conditioningSet);
            expect(corePValue > 0.5, `core DSeparationTest ${label}`).toBe(expected);
          }
        }
      }
    }
  });
});
