/**
 * Seeded synthetic-data and random-graph generators for tests.
 * Test-only module; see rng.ts for the shared stream implementation.
 */

import {
  createLaplaceSampler,
  createNormalSampler,
  createUniformSampler,
  mulberry32
} from "./rng";

export type NoiseKind = "gaussian" | "uniform" | "laplace";

export interface DirectedEdgeSpec {
  from: number;
  to: number;
  coefficient: number;
}

function createNoiseSampler(kind: NoiseKind, random: () => number): () => number {
  switch (kind) {
    case "gaussian":
      return createNormalSampler(random);
    case "uniform":
      return createUniformSampler(random, -1, 1);
    case "laplace":
      return createLaplaceSampler(random, 1);
  }
}

function topologicalOrder(nodeCount: number, edges: readonly DirectedEdgeSpec[]): number[] {
  const indegree = new Array<number>(nodeCount).fill(0);
  const children: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    indegree[edge.to] = (indegree[edge.to] ?? 0) + 1;
    children[edge.from]!.push(edge.to);
  }
  const queue: number[] = [];
  for (let node = 0; node < nodeCount; node += 1) {
    if (indegree[node] === 0) {
      queue.push(node);
    }
  }
  const order: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const child of children[node]!) {
      indegree[child] = indegree[child]! - 1;
      if (indegree[child] === 0) {
        queue.push(child);
      }
    }
  }
  if (order.length !== nodeCount) {
    throw new Error("sampleSem: edge list contains a directed cycle");
  }
  return order;
}

/** Linear SEM: each node = sum(coefficient * parent) + noise. */
export function sampleLinearSem(
  nodeCount: number,
  edges: readonly DirectedEdgeSpec[],
  noise: NoiseKind,
  sampleCount: number,
  seed: number
): number[][] {
  return sampleAdditiveSem(
    nodeCount,
    edges.map((edge) => ({ ...edge, fn: (value: number) => edge.coefficient * value })),
    noise,
    sampleCount,
    seed
  );
}

export interface AdditiveEdgeSpec extends DirectedEdgeSpec {
  /** Applied to the parent value; the coefficient field is informational when fn is given. */
  fn: (value: number) => number;
}

/** Additive SEM: each node = sum(fn(parent)) + noise. Used for CAM-UV style data. */
export function sampleAdditiveSem(
  nodeCount: number,
  edges: readonly AdditiveEdgeSpec[],
  noise: NoiseKind,
  sampleCount: number,
  seed: number
): number[][] {
  const random = mulberry32(seed);
  const sampleNoise = createNoiseSampler(noise, random);
  const order = topologicalOrder(nodeCount, edges);
  const parentsOf: AdditiveEdgeSpec[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    parentsOf[edge.to]!.push(edge);
  }

  const rows: number[][] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const values = new Array<number>(nodeCount).fill(0);
    for (const node of order) {
      let total = sampleNoise();
      for (const edge of parentsOf[node]!) {
        total += edge.fn(values[edge.from]!);
      }
      values[node] = total;
    }
    rows.push(values);
  }
  return rows;
}

export interface LatentFactorModelSpec {
  /** Number of latent factors. */
  factorCount: number;
  /** loadings[f] lists the loading of each observed child of factor f. */
  loadings: readonly (readonly number[])[];
  /** Directed edges between factors (from, to, coefficient). */
  factorEdges: readonly DirectedEdgeSpec[];
  noise: NoiseKind;
  sampleCount: number;
  seed: number;
}

/**
 * Latent factor model for GIN-style tests: factors follow a linear SEM among
 * themselves, each observed variable loads on exactly one factor plus noise.
 * Observed columns are ordered factor by factor (factor 0's children first).
 */
export function sampleLatentFactorModel(spec: LatentFactorModelSpec): number[][] {
  const random = mulberry32(spec.seed);
  const sampleNoise = createNoiseSampler(spec.noise, random);
  const order = topologicalOrder(spec.factorCount, spec.factorEdges);
  const parentsOf: DirectedEdgeSpec[][] = Array.from({ length: spec.factorCount }, () => []);
  for (const edge of spec.factorEdges) {
    parentsOf[edge.to]!.push(edge);
  }

  const observedCount = spec.loadings.reduce((total, row) => total + row.length, 0);
  const rows: number[][] = [];
  for (let sample = 0; sample < spec.sampleCount; sample += 1) {
    const factors = new Array<number>(spec.factorCount).fill(0);
    for (const factor of order) {
      let total = sampleNoise();
      for (const edge of parentsOf[factor]!) {
        total += edge.coefficient * factors[edge.from]!;
      }
      factors[factor] = total;
    }
    const observed = new Array<number>(observedCount);
    let column = 0;
    for (let factor = 0; factor < spec.factorCount; factor += 1) {
      for (const loading of spec.loadings[factor]!) {
        observed[column] = loading * factors[factor]! + sampleNoise();
        column += 1;
      }
    }
    rows.push(observed);
  }
  return rows;
}

/**
 * Random DAG over nodes 0..nodeCount-1: for each pair (i, j) with i < j an
 * edge i -> j is added with the given probability, so the identity order is
 * always a valid topological order.
 */
export function randomDag(
  nodeCount: number,
  edgeProbability: number,
  seed: number
): DirectedEdgeSpec[] {
  const random = mulberry32(seed);
  const edges: DirectedEdgeSpec[] = [];
  for (let from = 0; from < nodeCount; from += 1) {
    for (let to = from + 1; to < nodeCount; to += 1) {
      if (random() < edgeProbability) {
        edges.push({ from, to, coefficient: 0.5 + random() });
      }
    }
  }
  return edges;
}

/** All subsets of `values` with size <= maxSize (including the empty set). */
export function enumerateSubsets<T>(values: readonly T[], maxSize: number): T[][] {
  const subsets: T[][] = [[]];
  for (const value of values) {
    const existing = subsets.length;
    for (let index = 0; index < existing; index += 1) {
      const base = subsets[index]!;
      if (base.length < maxSize) {
        subsets.push([...base, value]);
      }
    }
  }
  return subsets;
}
