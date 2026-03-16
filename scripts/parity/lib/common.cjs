const fs = require("node:fs");
const path = require("node:path");

const PYTHON_DEPENDENCIES = [
  "numpy",
  "pandas==1.5.3",
  "scipy",
  "scikit-learn",
  "pydot",
  "networkx",
  "graphviz",
  "momentchi2",
  "statsmodels",
  "pygam"
];

function loadPackages(root) {
  try {
    return {
      core: require(path.join(root, "packages", "core", "dist", "index.cjs")),
      discovery: require(path.join(root, "packages", "discovery", "dist", "index.cjs"))
    };
  } catch (error) {
    throw new Error(
      "Failed to load built workspace packages. Run `pnpm build` before running parity.\n" +
        String(error instanceof Error ? error.message : error)
    );
  }
}

function loadTxtMatrix(filePath, skipRows = 0) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text
    .split(/\n+/)
    .slice(skipRows)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

function centerColumns(rows) {
  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? 0;
  const means = Array.from({ length: columnCount }, (_, columnIndex) => {
    let total = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      total += rows[rowIndex]?.[columnIndex] ?? 0;
    }
    return total / rowCount;
  });

  return rows.map((row) => row.map((value, columnIndex) => value - (means[columnIndex] ?? 0)));
}

function createNodeLabels(count) {
  return Array.from({ length: count }, (_, index) => `X${index + 1}`);
}

function createOracleData(DenseMatrix, observedCount) {
  return new DenseMatrix([Array.from({ length: observedCount }, () => 0)]);
}

function buildBackgroundKnowledge(BackgroundKnowledge, definition) {
  if (!definition) {
    return undefined;
  }

  const knowledge = new BackgroundKnowledge();
  for (const [from, to] of definition.forbidden ?? []) {
    knowledge.addForbidden(from, to);
  }
  for (const [from, to] of definition.required ?? []) {
    knowledge.addRequired(from, to);
  }
  return knowledge;
}

function createDag(CausalGraph, totalNodes, edges) {
  const graph = CausalGraph.fromNodeIds(createNodeLabels(totalNodes));
  for (const [from, to] of edges) {
    graph.orientEdge(`X${from + 1}`, `X${to + 1}`);
  }
  return graph;
}

function endpointCode(endpoint) {
  switch (endpoint) {
    case "tail":
      return -1;
    case "arrow":
      return 1;
    case "circle":
      return 2;
    case "star":
      return 3;
    case "none":
      return 0;
    default:
      throw new Error(`Unsupported endpoint: ${endpoint}`);
  }
}

function graphMatrix(shape) {
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  for (const edge of shape.edges) {
    const index1 = nodeIndex.get(edge.node1);
    const index2 = nodeIndex.get(edge.node2);
    if (index1 === undefined || index2 === undefined) {
      throw new Error(`Missing node index for edge ${edge.node1}-${edge.node2}`);
    }
    matrix[index1][index2] = endpointCode(edge.endpoint1);
    matrix[index2][index1] = endpointCode(edge.endpoint2);
  }

  return matrix;
}

function graphNodes(shape) {
  return [...shape.nodes]
    .map((node) => ({
      id: node.id,
      nodeType: node.nodeType ?? "measured"
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function graphEdges(shape) {
  return [...shape.edges]
    .map((edge) => ({
      node1: edge.node1,
      node2: edge.node2,
      endpoint1: edge.endpoint1,
      endpoint2: edge.endpoint2
    }))
    .sort((left, right) => {
      return (
        left.node1.localeCompare(right.node1) ||
        left.node2.localeCompare(right.node2) ||
        left.endpoint1.localeCompare(right.endpoint1) ||
        left.endpoint2.localeCompare(right.endpoint2)
      );
    });
}

function graphOutputSummary(shape) {
  return {
    nodeCount: shape.nodes.length,
    edgeCount: shape.edges.length
  };
}

function normalizeClusters(clusters) {
  return clusters.map((cluster) => [...cluster].map(Number).sort((left, right) => left - right));
}

function adjacencyMatrixToJsonable(matrix) {
  return matrix.map((row) => row.map((value) => (Number.isNaN(value) ? null : value)));
}

function encodeDiscreteColumns(rows) {
  const columnCount = rows[0]?.length ?? 0;
  const encodedColumns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const mapping = new Map();
    return rows.map((row) => {
      const value = row[columnIndex];
      const existing = mapping.get(value);
      if (existing !== undefined) {
        return existing;
      }
      const next = mapping.size;
      mapping.set(value, next);
      return next;
    });
  });

  return {
    encodedColumns,
    cardinalities: encodedColumns.map((column) => Math.max(...column) + 1)
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covariance(left, right) {
  const meanLeft = mean(left);
  const meanRight = mean(right);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += ((left[index] ?? 0) - meanLeft) * ((right[index] ?? 0) - meanRight);
  }
  return total / (left.length - 1);
}

function standardDeviation(values) {
  return Math.sqrt(covariance(values, values));
}

function correlation(left, right) {
  const leftStd = standardDeviation(left);
  const rightStd = standardDeviation(right);
  if (leftStd === 0 || rightStd === 0) {
    throw new Error("Correlation requires non-constant columns.");
  }
  return covariance(left, right) / (leftStd * rightStd);
}

function buildCorrelationMatrix(rows) {
  const columnCount = rows[0]?.length ?? 0;
  const columns = Array.from({ length: columnCount }, (_, index) => rows.map((row) => row[index] ?? 0));
  return columns.map((leftColumn) => columns.map((rightColumn) => correlation(leftColumn, rightColumn)));
}

function selectSubmatrix(matrix, indices) {
  return indices.map((rowIndex) => indices.map((columnIndex) => matrix[rowIndex]?.[columnIndex] ?? 0));
}

function invertMatrix(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  ]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    let pivotValue = Math.abs(augmented[pivotIndex]?.[pivotIndex] ?? 0);
    for (let candidate = pivotIndex + 1; candidate < size; candidate += 1) {
      const candidateValue = Math.abs(augmented[candidate]?.[pivotIndex] ?? 0);
      if (candidateValue > pivotValue) {
        pivotRow = candidate;
        pivotValue = candidateValue;
      }
    }

    if (pivotValue === 0) {
      throw new Error("Matrix is singular.");
    }

    if (pivotRow !== pivotIndex) {
      const current = augmented[pivotIndex];
      const selected = augmented[pivotRow];
      augmented[pivotIndex] = selected;
      augmented[pivotRow] = current;
    }

    const pivot = augmented[pivotIndex]?.[pivotIndex] ?? 0;
    for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
      augmented[pivotIndex][columnIndex] /= pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }
      const factor = augmented[rowIndex]?.[pivotIndex] ?? 0;
      for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t);
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function chiSquareSurvival(statistic, degreesOfFreedom) {
  if (degreesOfFreedom <= 0) {
    return 1;
  }

  const transformed =
    (Math.pow(statistic / degreesOfFreedom, 1 / 3) - (1 - 2 / (9 * degreesOfFreedom))) /
    Math.sqrt(2 / (9 * degreesOfFreedom));
  return 1 - normalCdf(transformed);
}

function formatConditioningSet(conditioningSet) {
  return [...new Set(conditioningSet ?? [])].sort((left, right) => left - right);
}

function fisherZStats(rows, x, y, conditioningSet = []) {
  const normalizedConditioningSet = formatConditioningSet(conditioningSet);
  const degreesOfFreedom = rows.length - normalizedConditioningSet.length - 3;
  const variableIndices = [x, y, ...normalizedConditioningSet];
  const subCorrelationMatrix = selectSubmatrix(buildCorrelationMatrix(rows), variableIndices);
  const inverse = invertMatrix(subCorrelationMatrix);
  const numerator = -(inverse[0]?.[1] ?? 0);
  const denominator = Math.sqrt(Math.abs((inverse[0]?.[0] ?? 0) * (inverse[1]?.[1] ?? 0)));
  let partialCorrelation = numerator / denominator;
  if (Math.abs(partialCorrelation) >= 1) {
    partialCorrelation = (1 - Number.EPSILON) * Math.sign(partialCorrelation);
  }
  const fisherZ = 0.5 * Math.log((1 + partialCorrelation) / (1 - partialCorrelation));
  const statistic = Math.sqrt(degreesOfFreedom) * Math.abs(fisherZ);
  return {
    pValue: 2 * (1 - normalCdf(Math.abs(statistic))),
    statistic,
    degreesOfFreedom
  };
}

function count2D(xValues, yValues, xCardinality, yCardinality) {
  const table = Array.from({ length: xCardinality }, () =>
    Array.from({ length: yCardinality }, () => 0)
  );
  for (let index = 0; index < xValues.length; index += 1) {
    table[xValues[index]][yValues[index]] += 1;
  }
  return table;
}

function xMarginals(table) {
  return table.map((row) => row.reduce((sum, value) => sum + value, 0));
}

function yMarginals(table) {
  const width = table[0]?.length ?? 0;
  return Array.from({ length: width }, (_, columnIndex) =>
    table.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0)
  );
}

function expected2D(table) {
  const xTotals = xMarginals(table);
  const yTotals = yMarginals(table);
  const sampleSize = xTotals.reduce((sum, value) => sum + value, 0);
  return table.map((row, rowIndex) =>
    row.map((_, columnIndex) => (xTotals[rowIndex] * yTotals[columnIndex]) / sampleSize)
  );
}

function zeroRowCount(table) {
  return table.filter((row) => row.every((value) => value === 0)).length;
}

function zeroColumnCount(table) {
  const width = table[0]?.length ?? 0;
  let count = 0;
  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    if (table.every((row) => row[columnIndex] === 0)) {
      count += 1;
    }
  }
  return count;
}

function statisticFromTables(observed, expected, useGSquare) {
  let statistic = 0;
  for (let rowIndex = 0; rowIndex < observed.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < observed[rowIndex].length; columnIndex += 1) {
      const observedValue = observed[rowIndex][columnIndex];
      const expectedValue = expected[rowIndex][columnIndex];
      if (expectedValue === 0) {
        continue;
      }
      if (useGSquare) {
        if (observedValue !== 0) {
          statistic += 2 * observedValue * Math.log(observedValue / expectedValue);
        }
      } else {
        statistic += ((observedValue - expectedValue) ** 2) / expectedValue;
      }
    }
  }

  return {
    statistic,
    degreesOfFreedom:
      (observed.length - 1 - zeroRowCount(observed)) *
      ((observed[0]?.length ?? 0) - 1 - zeroColumnCount(observed))
  };
}

function groupedRows(conditioningColumns) {
  const rowCount = conditioningColumns[0]?.length ?? 0;
  const groups = new Map();
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const key = conditioningColumns.map((column) => column[rowIndex]).join("|");
    const rows = groups.get(key) ?? [];
    rows.push(rowIndex);
    groups.set(key, rows);
  }
  return groups;
}

function discreteCiStats(rows, x, y, conditioningSet = [], useGSquare = false) {
  const normalizedConditioningSet = formatConditioningSet(conditioningSet);
  const { encodedColumns, cardinalities } = encodeDiscreteColumns(rows);
  const xValues = encodedColumns[x];
  const yValues = encodedColumns[y];

  let statistic = 0;
  let degreesOfFreedom = 0;

  if (normalizedConditioningSet.length === 0) {
    const observed = count2D(xValues, yValues, cardinalities[x], cardinalities[y]);
    const expected = expected2D(observed);
    const result = statisticFromTables(observed, expected, useGSquare);
    statistic = result.statistic;
    degreesOfFreedom = result.degreesOfFreedom;
  } else {
    const conditioningColumns = normalizedConditioningSet.map((index) => encodedColumns[index]);
    const groups = groupedRows(conditioningColumns);
    for (const rowIndices of groups.values()) {
      const groupedX = rowIndices.map((rowIndex) => xValues[rowIndex]);
      const groupedY = rowIndices.map((rowIndex) => yValues[rowIndex]);
      const observed = count2D(groupedX, groupedY, cardinalities[x], cardinalities[y]);
      const expected = expected2D(observed);
      const result = statisticFromTables(observed, expected, useGSquare);
      statistic += result.statistic;
      degreesOfFreedom += result.degreesOfFreedom;
    }
  }

  return {
    pValue: chiSquareSurvival(statistic, degreesOfFreedom),
    statistic,
    degreesOfFreedom
  };
}

function resolveFixturePath(root, oracleRoot, fixture) {
  if (fixture.scope === "oracle") {
    if (!oracleRoot) {
      throw new Error(`Fixture ${fixture.id} requires an oracle root.`);
    }
    return path.join(oracleRoot, fixture.path);
  }
  return path.join(root, fixture.path);
}

function loadFixturePayload(root, oracleRoot, fixture) {
  if (fixture.kind === "oracle-dag") {
    return { kind: fixture.kind, fixture };
  }

  if (fixture.kind === "stacked-context") {
    const rows = [];
    const context = [];
    for (const source of fixture.sources) {
      const sourceRows = loadTxtMatrix(path.join(root, source.path), source.skipRows ?? 0).slice(
        0,
        source.sliceRows ?? Number.POSITIVE_INFINITY
      );
      rows.push(...sourceRows);
      context.push(...Array.from({ length: sourceRows.length }, () => source.contextValue));
    }
    return {
      kind: fixture.kind,
      dataRows: rows,
      context
    };
  }

  if (fixture.kind === "matrix-file") {
    let dataRows = loadTxtMatrix(resolveFixturePath(root, oracleRoot, fixture), fixture.skipRows ?? 0);
    for (const step of fixture.preprocess ?? []) {
      if (step === "center-columns") {
        dataRows = centerColumns(dataRows);
      }
    }
    return {
      kind: fixture.kind,
      dataRows
    };
  }

  throw new Error(`Unsupported fixture kind: ${fixture.kind}`);
}

module.exports = {
  PYTHON_DEPENDENCIES,
  loadPackages,
  loadTxtMatrix,
  centerColumns,
  createNodeLabels,
  createOracleData,
  buildBackgroundKnowledge,
  createDag,
  graphMatrix,
  graphNodes,
  graphEdges,
  graphOutputSummary,
  normalizeClusters,
  adjacencyMatrixToJsonable,
  fisherZStats,
  discreteCiStats,
  loadFixturePayload
};
