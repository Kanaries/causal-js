function ratio(numerator, denominator) {
  if (denominator === 0) {
    return numerator === 0 ? 1 : 0;
  }
  return numerator / denominator;
}

function toKeyedSet(values) {
  return new Set(values);
}

function unorderedEdgeSet(matrix) {
  const edges = [];
  for (let left = 0; left < matrix.length; left += 1) {
    for (let right = left + 1; right < matrix.length; right += 1) {
      const leftValue = matrix[left]?.[right] ?? 0;
      const rightValue = matrix[right]?.[left] ?? 0;
      if (leftValue !== 0 || rightValue !== 0) {
        edges.push(`${left}-${right}`);
      }
    }
  }
  return toKeyedSet(edges);
}

function directedEdgeSet(matrix) {
  const edges = [];
  for (let left = 0; left < matrix.length; left += 1) {
    for (let right = 0; right < matrix.length; right += 1) {
      if (left === right) {
        continue;
      }
      if ((matrix[left]?.[right] ?? 0) === -1 && (matrix[right]?.[left] ?? 0) === 1) {
        edges.push(`${left}->${right}`);
      }
    }
  }
  return toKeyedSet(edges);
}

function setCounts(predicted, expected) {
  let truePositive = 0;
  for (const value of predicted) {
    if (expected.has(value)) {
      truePositive += 1;
    }
  }
  return {
    truePositive,
    precision: ratio(truePositive, predicted.size),
    recall: ratio(truePositive, expected.size)
  };
}

function compareGraphMatrix(received, expected) {
  const adjacencyReceived = unorderedEdgeSet(received);
  const adjacencyExpected = unorderedEdgeSet(expected);
  const directionReceived = directedEdgeSet(received);
  const directionExpected = directedEdgeSet(expected);

  const adjacencyCounts = setCounts(adjacencyReceived, adjacencyExpected);
  const directionCounts = setCounts(directionReceived, directionExpected);

  const edgeDiffs = [];
  let endpointMismatchCount = 0;
  for (let left = 0; left < Math.max(received.length, expected.length); left += 1) {
    for (let right = left + 1; right < Math.max(received.length, expected.length); right += 1) {
      const receivedPair = [received[left]?.[right] ?? 0, received[right]?.[left] ?? 0];
      const expectedPair = [expected[left]?.[right] ?? 0, expected[right]?.[left] ?? 0];
      if (receivedPair[0] !== expectedPair[0] || receivedPair[1] !== expectedPair[1]) {
        endpointMismatchCount += 1;
        edgeDiffs.push({
          edge: `${left}-${right}`,
          received: receivedPair,
          expected: expectedPair
        });
      }
    }
  }

  const adjacencyUnion = new Set([...adjacencyReceived, ...adjacencyExpected]);
  let skeletonShd = 0;
  for (const edge of adjacencyUnion) {
    if (!(adjacencyReceived.has(edge) && adjacencyExpected.has(edge))) {
      skeletonShd += 1;
    }
  }

  return {
    exactMatch: JSON.stringify(received) === JSON.stringify(expected),
    skeletonShd,
    adjacencyPrecision: adjacencyCounts.precision,
    adjacencyRecall: adjacencyCounts.recall,
    directionPrecision: directionCounts.precision,
    directionRecall: directionCounts.recall,
    endpointMismatchCount,
    edgeDiffSummary: edgeDiffs.slice(0, 10)
  };
}

function compareDistribution(receivedRuns, expectedRuns) {
  const expectedBySeed = new Map(expectedRuns.map((entry) => [entry.seed, entry]));
  const perSeed = receivedRuns.map((entry) => {
    const expected = expectedBySeed.get(entry.seed);
    if (!expected) {
      return {
        seed: entry.seed,
        missingExpectedSeed: true
      };
    }
    return {
      seed: entry.seed,
      ...compareGraphMatrix(entry.graphMatrix, expected.graphMatrix)
    };
  });

  const aggregate = {
    meanSkeletonShd:
      perSeed.reduce((sum, entry) => sum + (entry.skeletonShd ?? 0), 0) / Math.max(perSeed.length, 1),
    meanAdjacencyPrecision:
      perSeed.reduce((sum, entry) => sum + (entry.adjacencyPrecision ?? 0), 0) /
      Math.max(perSeed.length, 1),
    meanAdjacencyRecall:
      perSeed.reduce((sum, entry) => sum + (entry.adjacencyRecall ?? 0), 0) /
      Math.max(perSeed.length, 1),
    meanDirectionPrecision:
      perSeed.reduce((sum, entry) => sum + (entry.directionPrecision ?? 0), 0) /
      Math.max(perSeed.length, 1),
    meanDirectionRecall:
      perSeed.reduce((sum, entry) => sum + (entry.directionRecall ?? 0), 0) /
      Math.max(perSeed.length, 1),
    exactSeedMatches: perSeed.filter((entry) => entry.exactMatch === true).length
  };

  return {
    exactMatch:
      receivedRuns.length === expectedRuns.length && perSeed.every((entry) => entry.exactMatch === true),
    perSeed,
    aggregate
  };
}

function deepCompare(received, expected, tolerance, path = "root", state = undefined) {
  const nextState =
    state ??
    {
      differenceCount: 0,
      structuralDifferenceCount: 0,
      maxNumericAbsDiff: 0,
      differences: []
    };

  if (typeof received === "number" && typeof expected === "number") {
    const absDiff = Math.abs(received - expected);
    nextState.maxNumericAbsDiff = Math.max(nextState.maxNumericAbsDiff, absDiff);
    if (!(Number.isNaN(received) && Number.isNaN(expected)) && absDiff > tolerance) {
      nextState.differenceCount += 1;
      nextState.differences.push(`${path}: expected ${expected}, received ${received}`);
    }
    return nextState;
  }

  if (received === expected) {
    return nextState;
  }

  if (Array.isArray(received) && Array.isArray(expected)) {
    if (received.length !== expected.length) {
      nextState.differenceCount += 1;
      nextState.structuralDifferenceCount += 1;
      nextState.differences.push(`${path}: expected length ${expected.length}, received ${received.length}`);
    }
    const sharedLength = Math.min(received.length, expected.length);
    for (let index = 0; index < sharedLength; index += 1) {
      deepCompare(received[index], expected[index], tolerance, `${path}.${index}`, nextState);
    }
    return nextState;
  }

  if (
    received &&
    expected &&
    typeof received === "object" &&
    typeof expected === "object" &&
    !Array.isArray(received) &&
    !Array.isArray(expected)
  ) {
    const keys = [...new Set([...Object.keys(received), ...Object.keys(expected)])].sort();
    for (const key of keys) {
      if (!(key in received) || !(key in expected)) {
        nextState.differenceCount += 1;
        nextState.structuralDifferenceCount += 1;
        nextState.differences.push(`${path}.${key}: key mismatch`);
        continue;
      }
      deepCompare(received[key], expected[key], tolerance, `${path}.${key}`, nextState);
    }
    return nextState;
  }

  nextState.differenceCount += 1;
  nextState.structuralDifferenceCount += 1;
  nextState.differences.push(`${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`);
  return nextState;
}

function compareStatTest(received, expected) {
  return {
    pValueAbsDiff: Math.abs((received.pValue ?? 0) - (expected.pValue ?? 0)),
    statisticAbsDiff: Math.abs((received.statistic ?? 0) - (expected.statistic ?? 0)),
    degreesOfFreedomDelta: Math.abs((received.degreesOfFreedom ?? 0) - (expected.degreesOfFreedom ?? 0))
  };
}

function compareScore(received, expected) {
  return {
    scoreAbsDiff: Math.abs((received.score ?? 0) - (expected.score ?? 0))
  };
}

function compareStructured(received, expected) {
  const diffs = deepCompare(received, expected, 1e-6);
  return {
    exactMatch: diffs.differenceCount === 0,
    differenceCount: diffs.differenceCount,
    structuralDifferenceCount: diffs.structuralDifferenceCount,
    maxNumericAbsDiff: diffs.maxNumericAbsDiff,
    diffSummary: diffs.differences.slice(0, 10)
  };
}

function evaluateStatus(kind, mode, metrics, inputMatches, outputMatches) {
  if (!inputMatches || !outputMatches) {
    return {
      status: "fail",
      gate: "metadata-mismatch"
    };
  }

  if (kind === "graph" && mode === "strict") {
    return {
      status: metrics.exactMatch ? "pass" : "fail",
      gate: metrics.exactMatch ? "exact-graph-match" : "graph-mismatch"
    };
  }

  if (kind === "graph" && mode === "tolerance") {
    if (
      metrics.skeletonShd === 0 &&
      metrics.endpointMismatchCount === 0 &&
      metrics.adjacencyPrecision === 1 &&
      metrics.adjacencyRecall === 1 &&
      metrics.directionPrecision === 1 &&
      metrics.directionRecall === 1
    ) {
      return { status: "pass", gate: "graph-within-pass-thresholds" };
    }
    if (
      metrics.skeletonShd <= 1 &&
      metrics.endpointMismatchCount <= 2 &&
      metrics.adjacencyPrecision >= 0.95 &&
      metrics.adjacencyRecall >= 0.95 &&
      metrics.directionPrecision >= 0.9 &&
      metrics.directionRecall >= 0.9
    ) {
      return { status: "warn", gate: "graph-within-warn-thresholds" };
    }
    return { status: "fail", gate: "graph-outside-thresholds" };
  }

  if (kind === "graph-distribution") {
    if (
      metrics.exactMatch ||
      (metrics.aggregate.meanSkeletonShd === 0 &&
        metrics.aggregate.meanAdjacencyPrecision === 1 &&
        metrics.aggregate.meanAdjacencyRecall === 1 &&
        metrics.aggregate.meanDirectionPrecision === 1 &&
        metrics.aggregate.meanDirectionRecall === 1)
    ) {
      return { status: "pass", gate: "distribution-within-pass-thresholds" };
    }
    if (
      metrics.aggregate.meanSkeletonShd <= 1 &&
      metrics.aggregate.meanAdjacencyPrecision >= 0.9 &&
      metrics.aggregate.meanAdjacencyRecall >= 0.9
    ) {
      return { status: "warn", gate: "distribution-within-warn-thresholds" };
    }
    return { status: "fail", gate: "distribution-outside-thresholds" };
  }

  if (kind === "stat-test") {
    if (
      metrics.pValueAbsDiff <= 1e-6 &&
      metrics.statisticAbsDiff <= 1e-6 &&
      metrics.degreesOfFreedomDelta === 0
    ) {
      return { status: "pass", gate: "stat-within-pass-thresholds" };
    }
    if (
      metrics.pValueAbsDiff <= 1e-4 &&
      metrics.statisticAbsDiff <= 1e-4 &&
      metrics.degreesOfFreedomDelta === 0
    ) {
      return { status: "warn", gate: "stat-within-warn-thresholds" };
    }
    return { status: "fail", gate: "stat-outside-thresholds" };
  }

  if (kind === "score") {
    if (metrics.scoreAbsDiff <= 1e-6) {
      return { status: "pass", gate: "score-within-pass-thresholds" };
    }
    if (metrics.scoreAbsDiff <= 1e-4) {
      return { status: "warn", gate: "score-within-warn-thresholds" };
    }
    return { status: "fail", gate: "score-outside-thresholds" };
  }

  if (kind === "structured") {
    if (metrics.exactMatch || (metrics.differenceCount === 0 && metrics.maxNumericAbsDiff <= 1e-6)) {
      return { status: "pass", gate: "structured-within-pass-thresholds" };
    }
    if (metrics.structuralDifferenceCount === 0 && metrics.maxNumericAbsDiff <= 1e-4) {
      return { status: "warn", gate: "structured-within-warn-thresholds" };
    }
    return { status: "fail", gate: "structured-outside-thresholds" };
  }

  return { status: "fail", gate: "unsupported-comparison-kind" };
}

function compareCase(jsCase, pythonCase, comparison) {
  const inputMatches = JSON.stringify(jsCase.input) === JSON.stringify(pythonCase.input);
  const outputMatches = JSON.stringify(jsCase.output) === JSON.stringify(pythonCase.output);

  let metrics;
  if (comparison.kind === "graph") {
    metrics = compareGraphMatrix(jsCase.result.graphMatrix, pythonCase.result.graphMatrix);
  } else if (comparison.kind === "graph-distribution") {
    metrics = compareDistribution(jsCase.result.runs, pythonCase.result.runs);
  } else if (comparison.kind === "stat-test") {
    metrics = compareStatTest(jsCase.result, pythonCase.result);
  } else if (comparison.kind === "score") {
    metrics = compareScore(jsCase.result, pythonCase.result);
  } else if (comparison.kind === "structured") {
    metrics = compareStructured(jsCase.result, pythonCase.result);
  } else {
    throw new Error(`Unsupported comparison kind: ${comparison.kind}`);
  }

  const decision = evaluateStatus(
    comparison.kind,
    comparison.mode,
    metrics,
    inputMatches,
    outputMatches
  );

  return {
    inputMatches,
    outputMatches,
    metrics,
    ...decision
  };
}

module.exports = {
  compareCase
};
