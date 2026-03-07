import { CausalGraph, DenseMatrix, type NumericMatrix } from "@causal-js/core";

import type { CdnodOptions, CdnodResult } from "./contracts";
import {
  orientPcGraph,
  skeletonDiscovery
} from "./pc";

function isContextMatrix(context: CdnodOptions["context"]): context is NumericMatrix {
  return !Array.isArray(context);
}

function createAugmentedNodeLabels(
  variableCount: number,
  nodeLabels: readonly string[] | undefined,
  contextLabel: string | undefined
): string[] {
  const observedLabels = nodeLabels
    ? [...nodeLabels]
    : Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);

  if (observedLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${observedLabels.length}.`);
  }

  return [...observedLabels, contextLabel ?? "C"];
}

function normalizeContextColumn(context: CdnodOptions["context"], rows: number): number[] {
  if (!isContextMatrix(context)) {
    if (context.length !== rows) {
      throw new Error(`Expected ${rows} context values, got ${context.length}.`);
    }

    return context.map((value, index) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`Context value at row ${index} must be a valid number.`);
      }

      return value;
    });
  }

  if (context.rows !== rows) {
    throw new Error(`Expected ${rows} context rows, got ${context.rows}.`);
  }

  if (context.columns !== 1) {
    throw new Error(`Expected a single context column, got ${context.columns}.`);
  }

  return context.column(0).map((value: number, index: number) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Context value at row ${index} must be a valid number.`);
    }

    return value;
  });
}

function augmentWithContext(data: NumericMatrix, context: CdnodOptions["context"]): DenseMatrix {
  const contextColumn = normalizeContextColumn(context, data.rows);
  return new DenseMatrix(
    data.toArray().map((row, rowIndex) => {
      const contextValue = contextColumn[rowIndex];
      if (contextValue === undefined) {
        throw new Error(`Missing context value at row ${rowIndex}.`);
      }

      return [...row, contextValue];
    })
  );
}

function orientContextNode(graph: CausalGraph, contextNodeId: string): void {
  for (const adjacentNodeId of graph.getAdjacentNodeIds(contextNodeId)) {
    graph.orientEdge(contextNodeId, adjacentNodeId);
  }
}

export function cdnod(options: CdnodOptions): CdnodResult {
  const augmentedData = augmentWithContext(options.data, options.context);
  const nodeLabels = createAugmentedNodeLabels(
    options.data.columns,
    options.nodeLabels,
    options.contextLabel
  );
  const ciTest = options.createCiTest(augmentedData);

  const skeletonOptions = {
    ciTest,
    data: augmentedData,
    nodeLabels,
    ...(options.alpha !== undefined ? { alpha: options.alpha } : {}),
    ...(options.stable !== undefined ? { stable: options.stable } : {}),
    ...(options.backgroundKnowledge !== undefined
      ? { backgroundKnowledge: options.backgroundKnowledge }
      : {})
  };
  const skeleton = skeletonDiscovery(skeletonOptions);

  const graph = CausalGraph.fromShape(skeleton.graph);
  const contextNodeIndex = options.data.columns;
  const contextNodeId = nodeLabels[contextNodeIndex];
  if (contextNodeId === undefined) {
    throw new Error(`Missing context node label at index ${contextNodeIndex}.`);
  }

  orientContextNode(graph, contextNodeId);
  orientPcGraph(
    graph,
    {
      ciTest,
      ...(options.alpha !== undefined ? { alpha: options.alpha } : {}),
      ...(options.backgroundKnowledge !== undefined
        ? { backgroundKnowledge: options.backgroundKnowledge }
        : {}),
      ...(options.ucPriority !== undefined ? { ucPriority: options.ucPriority } : {}),
      ...(options.ucRule !== undefined ? { ucRule: options.ucRule } : {})
    },
    skeleton.sepsets
  );

  return {
    ...skeleton,
    graph: graph.toShape(),
    contextNodeIndex,
    observedNodeCount: options.data.columns
  };
}
