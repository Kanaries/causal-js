/**
 * Shared graph assertion helpers for tests.
 * Test-only module; mirrors the causal-learn endpoint encoding used by the
 * causal-parity regression suite (-1 tail, 1 arrow, 2 circle, 0 none).
 */

import { CausalGraph, EDGE_ENDPOINT, type EdgeEndpoint, type GraphShape } from "@causal-js/core";
import { expect } from "vitest";

function encodeEndpoint(endpoint: EdgeEndpoint): number {
  switch (endpoint) {
    case EDGE_ENDPOINT.tail:
      return -1;
    case EDGE_ENDPOINT.arrow:
      return 1;
    case EDGE_ENDPOINT.circle:
      return 2;
    default:
      return 0;
  }
}

/** Endpoint-coded adjacency matrix in the causal-learn convention. */
export function toCausalLearnMatrix(graph: CausalGraph | GraphShape): number[][] {
  const shape = graph instanceof CausalGraph ? graph.toShape() : graph;
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  for (const edge of shape.edges) {
    const i = nodeIndex.get(edge.node1);
    const j = nodeIndex.get(edge.node2);
    if (i === undefined || j === undefined) {
      throw new Error(`Missing node index for ${edge.node1}-${edge.node2}`);
    }
    matrix[i]![j] = encodeEndpoint(edge.endpoint1);
    matrix[j]![i] = encodeEndpoint(edge.endpoint2);
  }

  return matrix;
}

/** Asserts two CPDAG shapes are identical up to node order. */
export function expectSameCpdag(actual: CausalGraph | GraphShape, expected: CausalGraph | GraphShape): void {
  const actualShape = actual instanceof CausalGraph ? actual.toShape() : actual;
  const expectedShape = expected instanceof CausalGraph ? expected.toShape() : expected;
  const actualIds = actualShape.nodes.map((node) => node.id);
  const expectedIds = expectedShape.nodes.map((node) => node.id);
  expect([...actualIds].sort()).toEqual([...expectedIds].sort());

  const canonical = (shape: GraphShape): string[] =>
    shape.edges
      .map((edge) => {
        const forward = `${edge.node1}[${edge.endpoint1}]--[${edge.endpoint2}]${edge.node2}`;
        const backward = `${edge.node2}[${edge.endpoint2}]--[${edge.endpoint1}]${edge.node1}`;
        return forward < backward ? forward : backward;
      })
      .sort();

  expect(canonical(actualShape)).toEqual(canonical(expectedShape));
}
