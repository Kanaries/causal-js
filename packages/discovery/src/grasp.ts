import { CausalGraph } from "@causal-js/core";

import type { GraspOptions, GraspResult } from "./contracts";
import { dagToCpdag } from "./graph-conversion";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function createRandom(randomSeed?: number): () => number {
  if (randomSeed === undefined) {
    return Math.random;
  }

  let state = (randomSeed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = values[index];
    values[index] = values[swapIndex]!;
    values[swapIndex] = current!;
  }
}

class GstNode {
  readonly add: number | undefined;
  growScore: number;
  shrinkScore: number;
  branches: GstNode[] | null = null;
  remove: number[] | null = null;

  constructor(
    private readonly tree: Gst,
    add?: number,
    score?: number
  ) {
    const baseScore =
      score ?? -this.tree.score.score(this.tree.vertex, []);
    this.add = add;
    this.growScore = baseScore;
    this.shrinkScore = baseScore;
  }

  grow(available: number[], parents: number[]): void {
    this.branches = [];

    for (const add of available) {
      parents.push(add);
      const score = -this.tree.score.score(this.tree.vertex, parents);
      parents.pop();

      if (score > this.growScore) {
        this.branches.push(new GstNode(this.tree, add, score));
      }
    }

    this.branches.sort((left, right) => left.growScore - right.growScore);
  }

  shrink(parents: number[]): void {
    this.remove = [];

    while (true) {
      let best: number | undefined;
      for (const remove of [...parents]) {
        const removeIndex = parents.indexOf(remove);
        parents.splice(removeIndex, 1);
        const score = -this.tree.score.score(this.tree.vertex, parents);
        parents.push(remove);

        if (score > this.shrinkScore) {
          this.shrinkScore = score;
          best = remove;
        }
      }

      if (best === undefined) {
        break;
      }

      this.remove.push(best);
      const removeIndex = parents.indexOf(best);
      if (removeIndex >= 0) {
        parents.splice(removeIndex, 1);
      }
    }
  }

  trace(prefix: readonly number[], available: number[], parents: number[]): number {
    if (this.branches === null) {
      this.grow(available, parents);
    }

    for (const branch of this.branches ?? []) {
      const branchAdd = branch.add;
      if (branchAdd === undefined) {
        continue;
      }

      const availableIndex = available.indexOf(branchAdd);
      if (availableIndex >= 0) {
        available.splice(availableIndex, 1);
      }

      if (prefix.includes(branchAdd)) {
        parents.push(branchAdd);
        return branch.trace(prefix, available, parents);
      }
    }

    if (this.remove === null) {
      this.shrink(parents);
      return this.shrinkScore;
    }

    for (const remove of this.remove) {
      const removeIndex = parents.indexOf(remove);
      if (removeIndex >= 0) {
        parents.splice(removeIndex, 1);
      }
    }

    return this.shrinkScore;
  }
}

class Gst {
  readonly root: GstNode;
  forbidden: number[];
  required: number[] = [];

  constructor(
    readonly vertex: number,
    readonly score: GraspOptions["score"],
    private readonly variableCount: number
  ) {
    this.root = new GstNode(this);
    this.forbidden = [vertex];
  }

  trace(prefix: readonly number[], parents: number[] = []): number {
    const available = Array.from({ length: this.variableCount }, (_, index) => index).filter(
      (index) => !this.forbidden.includes(index)
    );
    return this.root.trace(prefix, available, parents);
  }
}

class Order {
  readonly order: number[];
  private readonly parents = new Map<number, number[]>();
  private readonly localScores = new Map<number, number>();
  private edges = 0;

  constructor(
    variableCount: number,
    score: GraspOptions["score"],
    random: () => number
  ) {
    this.order = Array.from({ length: variableCount }, (_, index) => index);
    shuffleInPlace(this.order, random);

    for (let index = 0; index < variableCount; index += 1) {
      const node = this.order[index]!;
      this.parents.set(node, []);
      this.localScores.set(node, -score.score(node, []));
    }
  }

  get(index: number): number {
    const value = this.order[index];
    if (value === undefined) {
      throw new Error(`Missing order value at index ${index}`);
    }
    return value;
  }

  set(index: number, value: number): void {
    this.order[index] = value;
  }

  index(value: number): number {
    return this.order.indexOf(value);
  }

  insert(index: number, value: number): void {
    this.order.splice(index, 0, value);
  }

  pop(index = -1): number {
    if (index < 0) {
      const value = this.order.pop();
      if (value === undefined) {
        throw new Error("Cannot pop from an empty order.");
      }
      return value;
    }

    const [value] = this.order.splice(index, 1);
    if (value === undefined) {
      throw new Error(`Missing order value at index ${index}`);
    }
    return value;
  }

  getParents(node: number): number[] {
    const parents = this.parents.get(node);
    if (!parents) {
      throw new Error(`Missing parents for node ${node}`);
    }
    return parents;
  }

  setParents(node: number, parents: number[]): void {
    this.parents.set(node, parents);
  }

  getLocalScore(node: number): number {
    const score = this.localScores.get(node);
    if (score === undefined) {
      throw new Error(`Missing local score for node ${node}`);
    }
    return score;
  }

  setLocalScore(node: number, score: number): void {
    this.localScores.set(node, score);
  }

  getEdges(): number {
    return this.edges;
  }

  setEdges(edges: number): void {
    this.edges = edges;
  }

  bumpEdges(delta: number): void {
    this.edges += delta;
  }

  len(): number {
    return this.order.length;
  }
}

function getAncestors(node: number, ancestors: number[], order: Order): void {
  ancestors.push(node);

  for (const parent of order.getParents(node)) {
    if (!ancestors.includes(parent)) {
      getAncestors(parent, ancestors, order);
    }
  }
}

function tuck(i: number, j: number, order: Order): void {
  const ancestors: number[] = [];
  getAncestors(order.get(i), ancestors, order);

  let shift = 0;
  for (let index = j + 1; index <= i; index += 1) {
    if (ancestors.includes(order.get(index))) {
      order.insert(j + shift, order.pop(index));
      shift += 1;
    }
  }
}

function update(i: number, j: number, order: Order, gsts: Gst[]): [number, number] {
  let edgeBump = 0;
  let oldScore = 0;
  let newScore = 0;

  for (let index = j; index <= i; index += 1) {
    const node = order.get(index);
    const parents = order.getParents(node);

    edgeBump -= parents.length;
    oldScore += order.getLocalScore(node);

    parents.length = 0;
    const candidates = Array.from({ length: index }, (_, candidateIndex) => order.get(candidateIndex));
    const localScore = gsts[node]!.trace(candidates, parents);
    order.setLocalScore(node, localScore);

    edgeBump += parents.length;
    newScore += localScore;
  }

  return [edgeBump, newScore - oldScore];
}

function dfs(
  depth: number,
  flipped: Set<string>,
  history: Set<string>[],
  order: Order,
  gsts: Gst[],
  random: () => number
): boolean {
  const cache: [Record<number, number>, Record<number, number[]>, Record<number, number>, number] = [
    {},
    {},
    {},
    0
  ];

  const indices = Array.from({ length: order.len() }, (_, index) => index);
  shuffleInPlace(indices, random);

  for (const i of indices) {
    const y = order.get(i);
    const yParents = order.getParents(y);
    const shuffledParents = [...yParents];
    shuffleInPlace(shuffledParents, random);

    for (const x of shuffledParents) {
      const covered = new Set([x, ...order.getParents(x)]).size === new Set(yParents).size &&
        [...new Set([x, ...order.getParents(x)])].every((value) => yParents.includes(value) || value === x);

      if (history.length > 0 && !covered) {
        continue;
      }

      const j = order.index(x);

      for (let index = j; index <= i; index += 1) {
        const node = order.get(index);
        cache[0][index] = node;
        cache[1][index] = [...order.getParents(node)];
        cache[2][index] = order.getLocalScore(node);
      }
      cache[3] = order.getEdges();

      tuck(i, j, order);
      const [edgeBump, scoreBump] = update(i, j, order, gsts);

      if (scoreBump > 1e-6) {
        order.bumpEdges(edgeBump);
        return true;
      }

      if (scoreBump > -1e-6) {
        const nextFlipped = new Set(flipped);
        for (const parent of order.getParents(x)) {
          if (order.index(parent) < i) {
            const key = [x, parent].sort((left, right) => left - right).join(":");
            if (nextFlipped.has(key)) {
              nextFlipped.delete(key);
            } else {
              nextFlipped.add(key);
            }
          }
        }

        const historyKey = [...nextFlipped].sort().join("|");
        if (nextFlipped.size > 0 && !history.some((entry) => [...entry].sort().join("|") === historyKey)) {
          history.push(nextFlipped);
          if (depth > 0 && dfs(depth - 1, nextFlipped, history, order, gsts, random)) {
            return true;
          }
          history.pop();
        }
      }

      for (let index = j; index <= i; index += 1) {
        const node = cache[0][index];
        if (node === undefined) {
          continue;
        }

        order.set(index, node);
        order.setParents(node, [...(cache[1][index] ?? [])]);
        order.setLocalScore(node, cache[2][index] ?? 0);
      }
      order.setEdges(cache[3]);
    }
  }

  return false;
}

function totalDagScore(order: Order): number {
  return order.order.reduce((sum, node) => sum - order.getLocalScore(node), 0);
}

export function grasp(options: GraspOptions): GraspResult {
  const variableCount = options.data.columns;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  const depth = options.depth ?? 3;
  const random = createRandom(options.randomSeed);

  const order = new Order(variableCount, options.score, random);
  const gsts = Array.from({ length: variableCount }, (_, index) => new Gst(index, options.score, variableCount));

  for (let index = 0; index < variableCount; index += 1) {
    const node = order.get(index);
    const parents = order.getParents(node);
    const candidates = Array.from({ length: index }, (_, candidateIndex) => order.get(candidateIndex));
    const localScore = gsts[node]!.trace(candidates, parents);
    order.setLocalScore(node, localScore);
    order.bumpEdges(parents.length);
  }

  while (dfs(depth - 1, new Set<string>(), [], order, gsts, random)) {
    if (options.verbose) {
      console.log(`GRaSP edge count: ${order.getEdges()}`);
    }
  }

  const dag = new CausalGraph(nodeLabels.map((id) => ({ id })));
  for (let node = 0; node < variableCount; node += 1) {
    for (const parent of order.getParents(node)) {
      dag.addDirectedEdge(nodeLabels[parent]!, nodeLabels[node]!);
    }
  }

  const cpdag = dagToCpdag(dag);
  return {
    dag: dag.toShape(),
    cpdag: cpdag.toShape(),
    order: [...order.order],
    edgeCount: order.getEdges(),
    score: totalDagScore(order),
    depth
  };
}
