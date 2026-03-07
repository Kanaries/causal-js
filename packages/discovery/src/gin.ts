import {
  CausalGraph,
  KciUnconditionalTest,
  NODE_TYPE,
  type GraphNode,
  type NumericMatrix
} from "@causal-js/core";

import type { GinIndependenceTestMethod, GinOptions, GinResult } from "./contracts";

function createObservedLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covariance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error("Covariance requires vectors of equal length.");
  }

  const meanLeft = mean(left);
  const meanRight = mean(right);
  let total = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error(`Missing value at index ${index}`);
    }
    total += (leftValue - meanLeft) * (rightValue - meanRight);
  }

  return total / (left.length - 1);
}

function covarianceMatrix(data: NumericMatrix): number[][] {
  const columns = Array.from({ length: data.columns }, (_, index) => data.column(index));
  return columns.map((leftColumn) => columns.map((rightColumn) => covariance(leftColumn, rightColumn)));
}

function transpose(matrix: readonly (readonly number[])[]): number[][] {
  if (matrix.length === 0) {
    return [];
  }

  const width = matrix[0]?.length ?? 0;
  return Array.from({ length: width }, (_, columnIndex) =>
    matrix.map((row, rowIndex) => {
      const value = row[columnIndex];
      if (value === undefined) {
        throw new Error(`Missing matrix value at row ${rowIndex}, column ${columnIndex}`);
      }
      return value;
    })
  );
}

function multiplyMatrices(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[]
): number[][] {
  const rightTransposed = transpose(right);
  return left.map((row, rowIndex) =>
    rightTransposed.map((column, columnIndex) => {
      if (row.length !== column.length) {
        throw new Error(
          `Incompatible matrix shapes at row ${rowIndex}, column ${columnIndex}.`
        );
      }

      let total = 0;
      for (let index = 0; index < row.length; index += 1) {
        const leftValue = row[index];
        const rightValue = column[index];
        if (leftValue === undefined || rightValue === undefined) {
          throw new Error(`Missing matrix value at index ${index}`);
        }
        total += leftValue * rightValue;
      }
      return total;
    })
  );
}

function identityMatrix(size: number): number[][] {
  return Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  );
}

function jacobiEigenvectors(
  matrix: readonly (readonly number[])[],
  maxIterations = 100,
  tolerance = 1e-12
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const size = matrix.length;
  if (size === 0) {
    return { eigenvalues: [], eigenvectors: [] };
  }

  const diagonalized = matrix.map((row) => [...row]);
  const eigenvectors = identityMatrix(size);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let maxValue = 0;

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
        const value = Math.abs(diagonalized[rowIndex]?.[columnIndex] ?? 0);
        if (value > maxValue) {
          maxValue = value;
          p = rowIndex;
          q = columnIndex;
        }
      }
    }

    if (maxValue < tolerance) {
      break;
    }

    const app = diagonalized[p]?.[p] ?? 0;
    const aqq = diagonalized[q]?.[q] ?? 0;
    const apq = diagonalized[p]?.[q] ?? 0;

    if (Math.abs(apq) < tolerance) {
      continue;
    }

    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    for (let index = 0; index < size; index += 1) {
      if (index === p || index === q) {
        continue;
      }

      const aip = diagonalized[index]?.[p] ?? 0;
      const aiq = diagonalized[index]?.[q] ?? 0;
      diagonalized[index]![p] = c * aip - s * aiq;
      diagonalized[p]![index] = diagonalized[index]![p]!;
      diagonalized[index]![q] = c * aiq + s * aip;
      diagonalized[q]![index] = diagonalized[index]![q]!;
    }

    diagonalized[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    diagonalized[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    diagonalized[p]![q] = 0;
    diagonalized[q]![p] = 0;

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      const vip = eigenvectors[rowIndex]?.[p] ?? 0;
      const viq = eigenvectors[rowIndex]?.[q] ?? 0;
      eigenvectors[rowIndex]![p] = c * vip - s * viq;
      eigenvectors[rowIndex]![q] = s * vip + c * viq;
    }
  }

  return {
    eigenvalues: Array.from({ length: size }, (_, index) => diagonalized[index]?.[index] ?? 0),
    eigenvectors
  };
}

function smallestRightSingularVector(matrix: readonly (readonly number[])[]): number[] {
  if (matrix.length === 0) {
    throw new Error("GIN requires a non-empty matrix when computing the residual direction.");
  }

  const width = matrix[0]?.length ?? 0;
  if (width === 0) {
    throw new Error("GIN requires at least one X variable when computing the residual direction.");
  }

  if (width === 1) {
    return [1];
  }

  const gram = multiplyMatrices(transpose(matrix), matrix);
  const { eigenvalues, eigenvectors } = jacobiEigenvectors(gram);
  let smallestIndex = 0;

  for (let index = 1; index < eigenvalues.length; index += 1) {
    if ((eigenvalues[index] ?? Number.POSITIVE_INFINITY) < (eigenvalues[smallestIndex] ?? 0)) {
      smallestIndex = index;
    }
  }

  return eigenvectors.map((row, rowIndex) => {
    const value = row[smallestIndex];
    if (value === undefined) {
      throw new Error(`Missing eigenvector value at row ${rowIndex}`);
    }
    return value;
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[center - 1] ?? 0) + (sorted[center] ?? 0)) / 2;
  }
  return sorted[center] ?? 0;
}

function getKernelWidth(values: readonly number[]): number {
  const sample = values.slice(0, Math.min(100, values.length));
  const distances: number[] = [];

  for (let leftIndex = 0; leftIndex < sample.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sample.length; rightIndex += 1) {
      const leftValue = sample[leftIndex];
      const rightValue = sample[rightIndex];
      if (leftValue === undefined || rightValue === undefined) {
        throw new Error(`Missing kernel value at ${leftIndex}, ${rightIndex}`);
      }
      const distance = (leftValue - rightValue) * (leftValue - rightValue);
      if (distance > 0) {
        distances.push(distance);
      }
    }
  }

  if (distances.length === 0) {
    return 1;
  }

  const width = Math.sqrt(0.5 * median(distances));
  return Number.isFinite(width) && width > 0 ? width : 1;
}

function getGramMatrix(values: readonly number[], width: number): { gram: number[][]; centered: number[][] } {
  const size = values.length;
  const gram = Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => {
      const leftValue = values[rowIndex];
      const rightValue = values[columnIndex];
      if (leftValue === undefined || rightValue === undefined) {
        throw new Error(`Missing Gram value at ${rowIndex}, ${columnIndex}`);
      }
      const distance = (leftValue - rightValue) * (leftValue - rightValue);
      return Math.exp(-distance / (2 * width * width));
    })
  );

  const columnSums = Array.from({ length: size }, (_, columnIndex) =>
    gram.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0)
  );
  const rowSums = gram.map((row) => row.reduce((sum, value) => sum + value, 0));
  const allSum = rowSums.reduce((sum, value) => sum + value, 0);

  const centered = gram.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value -
        ((columnSums[columnIndex] ?? 0) + (rowSums[rowIndex] ?? 0)) / size +
        allSum / (size * size)
    )
  );

  return { gram, centered };
}

function hsicStatistic(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
  sampleSize: number
): number {
  let total = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      total += (left[rowIndex]?.[columnIndex] ?? 0) * (right[rowIndex]?.[columnIndex] ?? 0);
    }
  }
  return total / sampleSize;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7
  ];

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  let x = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index]! / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

function regularizedGammaP(shape: number, value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    for (let iteration = 1; iteration <= 1000; iteration += 1) {
      term *= value / (shape + iteration);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) {
        break;
      }
    }

    return sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
  }

  let b = value + 1 - shape;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;

  for (let iteration = 1; iteration <= 1000; iteration += 1) {
    const an = -iteration * (iteration - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }
    c = b + an / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) {
      break;
    }
  }

  return 1 - Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * h;
}

function gammaCdf(value: number, shape: number, scale: number): number {
  if (value <= 0) {
    return 0;
  }

  if (shape <= 0 || scale <= 0 || !Number.isFinite(shape) || !Number.isFinite(scale)) {
    return 1;
  }

  return regularizedGammaP(shape, value / scale);
}

function hsicGammaPValue(left: readonly number[], right: readonly number[]): number {
  const leftWidth = getKernelWidth(left);
  const rightWidth = getKernelWidth(right);
  const { gram: leftGram, centered: leftCentered } = getGramMatrix(left, leftWidth);
  const { gram: rightGram, centered: rightCentered } = getGramMatrix(right, rightWidth);

  const sampleSize = left.length;
  const testStatistic = hsicStatistic(leftCentered, rightCentered, sampleSize);

  let variance = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      const value =
        ((leftCentered[rowIndex]?.[columnIndex] ?? 0) *
          (rightCentered[rowIndex]?.[columnIndex] ?? 0)) /
        6;
      variance += value * value;
    }
    variance -=
      Math.pow(
        ((leftCentered[rowIndex]?.[rowIndex] ?? 0) * (rightCentered[rowIndex]?.[rowIndex] ?? 0)) /
          6,
        2
      );
  }

  variance /= sampleSize * (sampleSize - 1);
  variance *=
    (72 * (sampleSize - 4) * (sampleSize - 5)) /
    (sampleSize * (sampleSize - 1) * (sampleSize - 2) * (sampleSize - 3));

  let leftSum = 0;
  let rightSum = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    leftGram[rowIndex]![rowIndex] = 0;
    rightGram[rowIndex]![rowIndex] = 0;
    leftSum += leftGram[rowIndex]!.reduce((sum, value) => sum + value, 0);
    rightSum += rightGram[rowIndex]!.reduce((sum, value) => sum + value, 0);
  }

  const muX = leftSum / (sampleSize * (sampleSize - 1));
  const muY = rightSum / (sampleSize * (sampleSize - 1));
  const mean = (1 / sampleSize) * (1 + muX * muY - muX - muY);

  if (variance <= 0 || mean <= 0) {
    return testStatistic <= 0 ? 1 : 0;
  }

  const shape = (mean * mean) / variance;
  const scale = (variance * sampleSize) / mean;
  const cdf = gammaCdf(testStatistic, shape, scale);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function fisherTest(pValues: readonly number[]): number {
  const floored = pValues.map((value) => Math.max(value, 1e-5));
  const statistic = -2 * floored.reduce((sum, value) => sum + Math.log(value), 0);
  const seriesValue = statistic / 2;
  let tail = 0;
  let term = 1;

  for (let index = 0; index < floored.length; index += 1) {
    if (index > 0) {
      term *= seriesValue / index;
    }
    tail += term;
  }

  return Math.exp(-seriesValue) * tail;
}

function combinations(values: readonly number[], size: number): number[][] {
  if (size === 0) {
    return [[]];
  }
  if (size > values.length) {
    return [];
  }

  const result: number[][] = [];

  function visit(start: number, prefix: number[]): void {
    if (prefix.length === size) {
      result.push([...prefix]);
      return;
    }

    for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
      const value = values[index];
      if (value === undefined) {
        throw new Error(`Missing combination value at index ${index}`);
      }
      prefix.push(value);
      visit(index + 1, prefix);
      prefix.pop();
    }
  }

  visit(0, []);
  return result;
}

function getAllElements(clusters: readonly (readonly number[])[]): Set<number> {
  const result = new Set<number>();
  for (const cluster of clusters) {
    for (const value of cluster) {
      result.add(value);
    }
  }
  return result;
}

function mergeOverlappingClusters(clusterList: readonly (readonly number[])[]): number[][] {
  const labels = [...getAllElements(clusterList)].sort((left, right) => left - right);
  if (labels.length === 0) {
    return [];
  }

  const clusterIndexByValue = new Map<number, number>();
  const memberships = new Map<number, number[]>();
  for (const label of labels) {
    memberships.set(label, []);
  }

  for (let clusterIndex = 0; clusterIndex < clusterList.length; clusterIndex += 1) {
    for (const value of clusterList[clusterIndex] ?? []) {
      memberships.get(value)?.push(clusterIndex);
    }
  }

  const visited = new Array(clusterList.length).fill(false);
  let componentCount = 0;
  let hasPending = true;

  while (hasPending) {
    hasPending = false;
    const queue: number[] = [];
    const start = visited.findIndex((value) => !value);
    if (start >= 0) {
      queue.push(start);
      visited[start] = true;
    }

    while (queue.length > 0) {
      const top = queue.shift()!;
      for (const value of clusterList[top] ?? []) {
        clusterIndexByValue.set(value, componentCount);
        for (const clusterIndex of memberships.get(value) ?? []) {
          if (!visited[clusterIndex]) {
            visited[clusterIndex] = true;
            queue.push(clusterIndex);
          }
        }
      }
    }

    hasPending = visited.some((value) => !value);
    componentCount += 1;
  }

  const merged = Array.from({ length: componentCount }, () => [] as number[]);
  for (const label of labels) {
    const component = clusterIndexByValue.get(label);
    if (component === undefined) {
      continue;
    }
    merged[component]!.push(label);
  }

  return merged;
}

function arraySplit(values: readonly number[], parts: number): number[][] {
  const result: number[][] = [];
  let start = 0;
  const sectionLength = Math.floor(values.length / parts);
  const extra = values.length % parts;

  for (let index = 0; index < extra; index += 1) {
    result.push(values.slice(start, start + sectionLength + 1));
    start += sectionLength + 1;
  }

  for (let index = 0; index < parts - extra; index += 1) {
    result.push(values.slice(start, start + sectionLength));
    start += sectionLength;
  }

  return result;
}

function calEWithGin(
  data: readonly (readonly number[])[],
  covarianceValues: readonly (readonly number[])[],
  x: readonly number[],
  z: readonly number[]
): number[] {
  const covarianceSlice = z.map((zIndex) =>
    x.map((xIndex) => {
      const value = covarianceValues[zIndex]?.[xIndex];
      if (value === undefined) {
        throw new Error(`Missing covariance value at ${zIndex}, ${xIndex}`);
      }
      return value;
    })
  );

  const omega = smallestRightSingularVector(covarianceSlice);
  return data.map((row, rowIndex) => {
    let total = 0;
    for (let index = 0; index < x.length; index += 1) {
      const xIndex = x[index];
      const weight = omega[index];
      if (xIndex === undefined || weight === undefined) {
        throw new Error(`Missing residual component at row ${rowIndex}, index ${index}`);
      }
      total += (row[xIndex] ?? 0) * weight;
    }
    return total;
  });
}

function calDepForGin(
  data: readonly (readonly number[])[],
  covarianceValues: readonly (readonly number[])[],
  x: readonly number[],
  z: readonly number[]
): number {
  const e = calEWithGin(data, covarianceValues, x, z);
  let statistic = 0;

  for (const zIndex of z) {
    statistic += 1 - hsicGammaPValue(e, data.map((row) => row[zIndex] ?? 0));
  }

  return statistic / z.length;
}

function findRoot(
  data: readonly (readonly number[])[],
  covarianceValues: readonly (readonly number[])[],
  clusters: readonly (readonly number[])[],
  causalOrder: readonly (readonly number[])[]
): number[] {
  if (clusters.length === 1) {
    return [...(clusters[0] ?? [])];
  }

  let root = [...(clusters[0] ?? [])];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of clusters) {
    for (const other of clusters) {
      if (candidate === other) {
        continue;
      }

      const x = [candidate[0]!, other[0]!];
      const z = candidate.slice(1);

      for (const cluster of causalOrder) {
        x.push(cluster[0]!);
        z.push(cluster[1]!);
      }

      const score = calDepForGin(data, covarianceValues, x, z);
      if (score < bestScore) {
        bestScore = score;
        root = [...candidate];
      }
    }
  }

  return root;
}

function createIndependenceTest(method: GinIndependenceTestMethod): (left: readonly number[], right: readonly number[]) => number {
  if (method !== "hsic" && method !== "kci") {
    throw new Error(`Independent test method ${method} is not implemented.`);
  }

  if (method === "hsic") {
    return (left, right) => hsicGammaPValue(left, right);
  }

  const kci = new KciUnconditionalTest();
  return (left, right) => kci.computePValue(left, right).pValue;
}

export function gin(options: GinOptions): GinResult {
  const alpha = options.alpha ?? 0.05;
  const indepTestMethod = options.indepTestMethod ?? "kci";
  const latentLabelPrefix = options.latentLabelPrefix ?? "L";
  const data = options.data.toArray();
  const variableCount = options.data.columns;
  const observedLabels = createObservedLabels(variableCount, options.nodeLabels);
  const covarianceValues = covarianceMatrix(options.data);
  const indepTest = createIndependenceTest(indepTestMethod);

  const varSet = new Set<number>(Array.from({ length: variableCount }, (_, index) => index));
  let clusterSize = 2;
  const clustersList: number[][] = [];

  while (clusterSize < varSet.size) {
    let nextClusters: number[][] = [];
    const sortedVars = [...varSet].sort((left, right) => left - right);

    for (const cluster of combinations(sortedVars, clusterSize)) {
      const clusterSet = new Set(cluster);
      const remainVars = sortedVars.filter((value) => !clusterSet.has(value));
      const residual = calEWithGin(data, covarianceValues, cluster, remainVars);
      const pValues: number[] = [];

      for (const variable of remainVars) {
        pValues.push(indepTest(data.map((row) => row[variable] ?? 0), residual));
      }

      if (fisherTest(pValues) >= alpha) {
        nextClusters.push(cluster);
      }
    }

    nextClusters = mergeOverlappingClusters(nextClusters);
    clustersList.push(...nextClusters);

    for (const cluster of nextClusters) {
      for (const value of cluster) {
        varSet.delete(value);
      }
    }

    clusterSize += 1;
  }

  const causalOrder: number[][] = [];
  let updated = true;

  while (updated) {
    updated = false;
    const x: number[] = [];
    const z: number[] = [];

    for (const cluster of causalOrder) {
      const [cluster1 = [], cluster2 = []] = arraySplit(cluster, 2);
      x.push(...cluster1);
      z.push(...cluster2);
    }

    for (let clusterIndex = 0; clusterIndex < clustersList.length; clusterIndex += 1) {
      const clusterI = clustersList[clusterIndex];
      if (!clusterI) {
        continue;
      }

      let isRoot = true;
      const [clusterI1 = [], clusterI2 = []] = arraySplit(clusterI, 2);

      for (let otherIndex = 0; otherIndex < clustersList.length; otherIndex += 1) {
        if (clusterIndex === otherIndex) {
          continue;
        }

        const clusterJ = clustersList[otherIndex];
        if (!clusterJ) {
          continue;
        }

        const [clusterJ1 = []] = arraySplit(clusterJ, 2);
        const residual = calEWithGin(
          data,
          covarianceValues,
          [...x, ...clusterI1, ...clusterJ1],
          [...z, ...clusterI2]
        );
        const pValues: number[] = [];

        for (const variable of [...z, ...clusterI2]) {
          pValues.push(indepTest(data.map((row) => row[variable] ?? 0), residual));
        }

        if (fisherTest(pValues) < alpha) {
          isRoot = false;
          break;
        }
      }

      if (isRoot) {
        causalOrder.push([...clusterI]);
        clustersList.splice(clusterIndex, 1);
        updated = true;
        break;
      }
    }
  }

  const graph = new CausalGraph();

  function createMeasuredNode(variable: number): GraphNode {
    const label = observedLabels[variable];
    if (label === undefined) {
      throw new Error(`Missing observed label for variable ${variable}`);
    }
    return {
      id: label,
      label,
      nodeType: NODE_TYPE.measured,
      attributes: { originalIndex: variable }
    };
  }

  for (const variable of [...varSet].sort((left, right) => left - right)) {
    graph.addNode(createMeasuredNode(variable));
  }

  let latentId = 1;
  const latentNodes: string[] = [];

  for (const cluster of causalOrder) {
    const latentIdValue = `${latentLabelPrefix}${latentId}`;
    graph.addNode({
      id: latentIdValue,
      label: latentIdValue,
      nodeType: NODE_TYPE.latent,
      attributes: { cluster: [...cluster] }
    });

    for (const parent of latentNodes) {
      graph.addDirectedEdge(parent, latentIdValue);
    }
    latentNodes.push(latentIdValue);

    for (const observed of cluster) {
      graph.addNode(createMeasuredNode(observed));
      graph.addDirectedEdge(latentIdValue, observedLabels[observed]!);
    }

    latentId += 1;
  }

  const undirectedLatentNodes: string[] = [];
  for (const cluster of clustersList) {
    const latentIdValue = `${latentLabelPrefix}${latentId}`;
    graph.addNode({
      id: latentIdValue,
      label: latentIdValue,
      nodeType: NODE_TYPE.latent,
      attributes: { cluster: [...cluster] }
    });

    for (const parent of latentNodes) {
      graph.addDirectedEdge(parent, latentIdValue);
    }

    for (const sibling of undirectedLatentNodes) {
      graph.addUndirectedEdge(sibling, latentIdValue);
    }
    undirectedLatentNodes.push(latentIdValue);

    for (const observed of cluster) {
      graph.addNode(createMeasuredNode(observed));
      graph.addDirectedEdge(latentIdValue, observedLabels[observed]!);
    }

    latentId += 1;
  }

  return {
    graph: graph.toShape(),
    causalOrder: causalOrder.map((cluster) => [...cluster]),
    remainingClusters: clustersList.map((cluster) => [...cluster]),
    indepTestMethod
  };
}
