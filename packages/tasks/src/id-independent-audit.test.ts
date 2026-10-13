import { expect, it } from "vitest";
import type { GraphShape } from "@causal-js/core";
import { identifyById } from "./id";
import { getFreeVariables } from "./expressions";
import type { IdentificationExpressionNode } from "./types";

// Independent binary SCM enumeration, separate from ID's graph
// traversal and formula construction. Each bidirected edge has its own latent
// Bernoulli parent, and every observed mechanism has strictly positive noise.
type Pair = [number, number];
function graphOf(n: number, directed: Pair[], bidirected: Pair[]): GraphShape {
  return {
    version: 1, kind: "admg", nodes: Array.from({ length: n }, (_, i) => ({ id: `V${i}`, nodeType: "measured" })),
    edges: [
      ...directed.map(([a, b]) => ({ node1: `V${a}`, node2: `V${b}`, endpoint1: "tail" as const, endpoint2: "arrow" as const })),
      ...bidirected.map(([a, b]) => ({ node1: `V${a}`, node2: `V${b}`, endpoint1: "arrow" as const, endpoint2: "arrow" as const }))
    ]
  };
}

function distribution(n: number, directed: Pair[], bidirected: Pair[], intervention = new Map<number, number>()): number[] {
  const result = Array.from({ length: 1 << n }, () => 0);
  for (let u = 0; u < 1 << bidirected.length; u += 1) {
    let latentMass = 1;
    for (let k = 0; k < bidirected.length; k += 1) {
      const p = 0.23 + 0.53 * (k + 1) / (bidirected.length + 1);
      latentMass *= (u >> k) & 1 ? p : 1 - p;
    }
    for (let v = 0; v < 1 << n; v += 1) {
      let mass = latentMass;
      for (let node = 0; node < n; node += 1) {
        const value = (v >> node) & 1;
        if (intervention.has(node)) {
          if (value !== intervention.get(node)) mass = 0;
          continue;
        }
        let predictor = -0.8 + node * 0.13;
        for (const [parent, child] of directed) if (child === node) predictor += (0.6 + 0.1 * parent) * ((v >> parent) & 1);
        for (let k = 0; k < bidirected.length; k += 1) {
          if (bidirected[k]!.includes(node)) predictor += (0.8 + 0.07 * k) * ((u >> k) & 1);
        }
        const p = 0.1 + 0.8 / (1 + Math.exp(-predictor));
        mass *= value ? p : 1 - p;
      }
      result[v] = result[v]! + mass;
    }
  }
  return result;
}

function evaluate(tree: IdentificationExpressionNode, n: number, joint: number[], supplied: Record<string, number>): number {
  const cache = new WeakMap<IdentificationExpressionNode, Map<string, number>>();
  const recurse = (node: IdentificationExpressionNode, assignment: Record<string, number>): number => {
    const key = Array.from({ length: n }, (_, i) => assignment[`V${i}`] ?? "?").join("");
    const cached = cache.get(node)?.get(key);
    if (cached !== undefined) return cached;
    let result: number;
    switch (node.type) {
      case "constant": result = Number(node.value); break;
      case "probability": {
        const marginal = (variables: string[]): number => joint.reduce((mass, p, v) => {
          const matches = variables.every((name) => {
            if (assignment[name] === undefined) throw new Error(`Unbound ${name}`);
            return ((v >> Number(name.slice(1))) & 1) === assignment[name];
          });
          return mass + (matches ? p : 0);
        }, 0);
        result = marginal([...node.variables, ...node.conditionedOn]) / marginal(node.conditionedOn);
        break;
      }
      case "product": result = node.factors.reduce((value, factor) => value * recurse(factor, assignment), 1); break;
      case "quotient": result = recurse(node.numerator, assignment) / recurse(node.denominator, assignment); break;
      case "sum": {
        const sum = (i: number, current: Record<string, number>): number => i === node.variables.length
          ? recurse(node.expression, current)
          : sum(i + 1, { ...current, [node.variables[i]!]: 0 }) + sum(i + 1, { ...current, [node.variables[i]!]: 1 });
        result = sum(0, assignment);
      }
    }
    if (!cache.has(node)) cache.set(node, new Map());
    cache.get(node)!.set(key, result);
    return result;
  };
  return recurse(tree, supplied);
}

for (const n of [4, 5]) it(`independently evaluates seeded ${n}-vertex mixed-graph ID functionals`, () => {
  let random = 12357 + n;
  const next = (): number => { random = (1664525 * random + 1013904223) >>> 0; return random / 4294967296; };
  let identified = 0;
  let failed = 0;
  let comparisons = 0;
  const steps = new Set<number>();
  for (let sample = 0; sample < 40; sample += 1) {
    const directed: Pair[] = [];
    const bidirected: Pair[] = [];
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) {
      if (next() < 0.42) directed.push([a, b]);
      if (next() < 0.34 && bidirected.length < 6) bidirected.push([a, b]);
    }
    const graph = graphOf(n, directed, bidirected);
    const joint = distribution(n, directed, bidirected);
    expect(joint.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 12);
    for (const [treatment, outcome] of [[[0], [n - 1]], [[1], [n - 1]], [[0, 1], [2, n - 1]]] as const) {
      const result = identifyById({ graph, treatment: treatment.map((i) => `V${i}`), outcome: outcome.map((i) => `V${i}`) });
      result.trace.forEach((entry) => steps.add(entry.step));
      if (!result.identified) { failed += 1; continue; }
      identified += 1;
      expect(getFreeVariables(result.expressionTree).every((name) => [...treatment, ...outcome].some((i) => name === `V${i}`))).toBe(true);
      for (let t = 0; t < 1 << treatment.length; t += 1) {
        const intervention = new Map(treatment.map((node, i) => [node, (t >> i) & 1]));
        const causal = distribution(n, directed, bidirected, intervention);
        for (let y = 0; y < 1 << outcome.length; y += 1) {
          const expected = causal.reduce((mass, p, v) => mass + (outcome.every((node, i) => ((v >> node) & 1) === ((y >> i) & 1)) ? p : 0), 0);
          const assignment = Object.fromEntries([...treatment.map((node, i) => [`V${node}`, (t >> i) & 1]), ...outcome.map((node, i) => [`V${node}`, (y >> i) & 1])]);
          const actual = evaluate(result.expressionTree, n, joint, assignment);
          expect(actual, JSON.stringify({ sample, directed, bidirected, treatment, outcome, t, y })).toBeCloseTo(expected, 10);
          comparisons += 1;
        }
      }
    }
  }
  expect(identified).toBeGreaterThan(30);
  expect(failed).toBeGreaterThan(10);
  expect(comparisons).toBeGreaterThan(200);
  expect([...steps].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
