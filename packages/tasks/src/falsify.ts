import { GRAPH_KIND } from "@causal-js/core";

import {
  asCausalGraph,
  assertNonEmptyMatrix,
  assertProbabilityAlpha,
  assertDagLike,
  deriveObservedNodeOrder,
  getMeasuredNodeIds,
  inferConditionalIndependenceTest
} from "./common";
import type {
  FalsifyGraphOptions,
  FalsifyGraphResult,
  ImpliedConditionalIndependence,
  TestedImplication
} from "./types";

function deriveLocalMarkovImplications(
  graph: ReturnType<typeof asCausalGraph>,
  observedNodeOrder: readonly string[]
): ImpliedConditionalIndependence[] {
  const observed = new Set(observedNodeOrder);
  const implications: ImpliedConditionalIndependence[] = [];

  for (const nodeId of observedNodeOrder) {
    const parents = graph.getParentIds(nodeId);
    if (parents.some((parent) => !observed.has(parent))) {
      continue;
    }
    const descendants = new Set(graph.getDescendantIds([nodeId]));
    for (const candidate of observedNodeOrder) {
      if (
        candidate === nodeId ||
        parents.includes(candidate) ||
        descendants.has(candidate)
      ) {
        continue;
      }

      if (!observed.has(candidate)) {
        continue;
      }

      implications.push({
        x: nodeId,
        y: candidate,
        conditioningSet: [...parents]
      });
    }
  }

  const seen = new Set<string>();
  return implications.filter((implication) => {
    const orderedPair = implication.x < implication.y ? [implication.x, implication.y] : [implication.y, implication.x];
    const key = `${orderedPair[0]}::${orderedPair[1]}|${[...implication.conditioningSet].sort().join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Benjamini-Hochberg step-up adjusted p-values:
 * q_(i) = min(1, min_{j >= i} p_(j) * m / j) over the ascending order.
 */
function benjaminiHochbergAdjusted(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues
    .map((pValue, index) => ({ pValue, index }))
    .sort((left, right) => left.pValue - right.pValue);

  const adjusted = new Array<number>(m).fill(1);
  let runningMin = 1;
  for (let rank = m - 1; rank >= 0; rank -= 1) {
    const { pValue, index } = order[rank]!;
    runningMin = Math.min(runningMin, (pValue * m) / (rank + 1));
    adjusted[index] = Math.min(1, runningMin);
  }
  return adjusted;
}

export function falsifyGraph(options: FalsifyGraphOptions): FalsifyGraphResult {
  const graph = asCausalGraph(options.graph);
  const validation = graph.validate();
  const alpha = options.alpha ?? 0.05;
  assertProbabilityAlpha(alpha, "falsifyGraph alpha");
  const correction = options.multipleTestingCorrection ?? "none";

  let dagSupported = true;
  try {
    assertDagLike(graph);
  } catch {
    dagSupported = false;
  }

  const graphValidity = {
    valid: validation.valid,
    dagSupported,
    issues: validation.issues
  };

  if (!dagSupported) {
    return {
      task: "falsifyGraph",
      graph: graph.toShape(),
      graphKind: graph.getKind(),
      graphValidity,
      impliedConditionalIndependences: [],
      testedImplications: [],
      failedImplications: [],
      inconclusiveImplications: [],
      overallSummary: {
        testedCount: 0,
        passedCount: 0,
        failedCount: 0,
        inconclusiveCount: 0,
        falsified: null
      },
      assumptions: ["This MVP falsification layer only supports DAG inputs."],
      limitations: ["PAG, CPDAG, ADMG, and permutation-based graph falsification are out of scope in this step."],
      caveats: ["Unsupported graph types are reported structurally but not statistically tested here."]
    };
  }

  if (options.data) {
    assertNonEmptyMatrix(options.data, "falsifyGraph data");
  }

  const observedNodeOrder =
    options.data === undefined
      ? getMeasuredNodeIds(graph)
      : deriveObservedNodeOrder(graph, options.data, options.observedNodeOrder);
  const implications = deriveLocalMarkovImplications(graph, observedNodeOrder);

  if (!options.data) {
    return {
      task: "falsifyGraph",
      graph: graph.toShape(),
      graphKind: GRAPH_KIND.dag,
      graphValidity,
      impliedConditionalIndependences: implications,
      testedImplications: [],
      failedImplications: [],
      inconclusiveImplications: [],
      overallSummary: {
        testedCount: 0,
        passedCount: 0,
        failedCount: 0,
        inconclusiveCount: 0,
        falsified: null
      },
      assumptions: ["Local Markov implications are derived from the supplied DAG."],
      limitations: ["No data matrix was provided, so this run only returns sanity checks and implied CI constraints."],
      caveats: ["A graph that survives these structural checks is not thereby confirmed to be true."]
    };
  }

  const ciTest = options.ciTest ?? inferConditionalIndependenceTest(options.data);
  const indexByNodeId = new Map(observedNodeOrder.map((nodeId, index) => [nodeId, index]));
  const testedImplications: TestedImplication[] = implications.map((implication) => {
    const xIndex = indexByNodeId.get(implication.x);
    const yIndex = indexByNodeId.get(implication.y);
    const conditioningIndices = implication.conditioningSet.map((nodeId) => indexByNodeId.get(nodeId));
    if (
      xIndex === undefined ||
      yIndex === undefined ||
      conditioningIndices.some((value) => value === undefined)
    ) {
      return {
        ...implication,
        status: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        alpha,
        reason: "Implication references nodes that are not aligned with the provided observed data order."
      };
    }

    try {
      const pValue = ciTest.test(
        xIndex,
        yIndex,
        conditioningIndices as number[]
      );
      return {
        ...implication,
        status: pValue > alpha ? "passed" : "failed",
        pValue,
        adjustedPValue: null,
        alpha
      };
    } catch (error) {
      return {
        ...implication,
        status: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        alpha,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  });

  if (correction === "benjamini-hochberg") {
    // Inconclusive implications are excluded from m; statuses of the rest are
    // recomputed from the adjusted p-values.
    const testedIndices = testedImplications
      .map((implication, index) => ({ implication, index }))
      .filter(({ implication }) => implication.pValue !== null);
    const adjusted = benjaminiHochbergAdjusted(
      testedIndices.map(({ implication }) => implication.pValue!)
    );
    testedIndices.forEach(({ index }, rank) => {
      const adjustedPValue = adjusted[rank]!;
      const implication = testedImplications[index]!;
      testedImplications[index] = {
        ...implication,
        adjustedPValue,
        status: adjustedPValue > alpha ? "passed" : "failed"
      };
    });
  }

  const failedImplications = testedImplications.filter((implication) => implication.status === "failed");
  const inconclusiveImplications = testedImplications.filter((implication) => implication.status === "inconclusive");
  const passedCount = testedImplications.filter((implication) => implication.status === "passed").length;

  return {
    task: "falsifyGraph",
    graph: graph.toShape(),
    graphKind: GRAPH_KIND.dag,
    graphValidity,
    impliedConditionalIndependences: implications,
    testedImplications,
    failedImplications,
    inconclusiveImplications,
    overallSummary: {
      testedCount: testedImplications.length,
      passedCount,
      failedCount: failedImplications.length,
      inconclusiveCount: inconclusiveImplications.length,
      falsified: failedImplications.length > 0
    },
    assumptions: [
      "Uses DAG local Markov implications as the falsifiable conditional independence constraints.",
      `Uses ${ciTest.name} as the conditional independence test.`
    ],
    limitations: [
      "This MVP does not implement the full permutation-based falsification procedure from the research literature.",
      "Only local Markov implications (each node independent of its non-descendants given its parents) are tested; the full set of d-separation-implied conditional independences is not enumerated, so a graph can pass every tested implication while violating a non-local constraint, and two Markov-equivalent graphs are indistinguishable here.",
      "Nodes with unobserved (latent) parents are skipped entirely when deriving implications."
    ],
    caveats: [
      "Not being falsified by these tests does not prove the graph is true.",
      correction === "benjamini-hochberg"
        ? `Benjamini-Hochberg FDR control at level ${alpha} was applied across the tested implications.`
        : "No multiple-testing control is applied; with many implications, expect false rejections at the raw alpha level."
    ]
  };
}
