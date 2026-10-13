import { describe, expect, it } from "vitest";
import type { EdgeDescriptor, GraphShape } from "@causal-js/core";
import { identifyById } from "./id";
import { getFreeVariables } from "./expressions";
import type { IdentificationExpressionNode } from "./types";

type Assignment = Record<string, number>;
type Distribution = { values: Assignment; probability: number }[];
type Pair = [string, string];

function shape(vertices: string[], directed: Pair[], bidirected: Pair[]): GraphShape {
  return {
    kind: bidirected.length === 0 ? "dag" : "admg", nodes: vertices.map((id) => ({ id })),
    edges: [
      ...directed.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "tail", endpoint2: "arrow" })),
      ...bidirected.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "arrow", endpoint2: "arrow" }))
    ]
  };
}

function assignments(names: readonly string[]): Assignment[] {
  return Array.from({ length: 2 ** names.length }, (_, bits) => Object.fromEntries(names.map((name, index) => [name, (bits >> index) & 1])));
}

function probability(distribution: Distribution, event: Assignment): number {
  return distribution.reduce((total, row) => total + (Object.entries(event).every(([name, value]) => row.values[name] === value) ? row.probability : 0), 0);
}

/** Independent finite semi-Markovian SCM. Every bidirected edge has its own
 * independent latent parent; node conditionals are strictly positive binary
 * tables. Truncated-factor enumeration produces intervention ground truth. */
function scm(vertices: string[], directed: Pair[], bidirected: Pair[], seed: number) {
  const latentNames = bidirected.map((_, index) => `latent${index}`);
  const parentNames = vertices.map((node) => directed.filter(([, child]) => child === node).map(([parent]) => parent));
  const latentParents = vertices.map((node) => bidirected.flatMap(([left, right], index) => left === node || right === node ? [latentNames[index]!] : []));
  const latentRows = assignments(latentNames).map((values) => ({
    values,
    probability: latentNames.reduce((weight, name, index) => weight * (values[name] === 1 ? 0.25 + ((index + seed) % 5) * 0.1 : 0.75 - ((index + seed) % 5) * 0.1), 1)
  }));
  const bernoulli = (index: number, observed: Assignment, latent: Assignment): number => {
    // A small table lookup hash supplies nonlinear, distinct probabilities.
    // No ID result, graph traversal, or expression construction is used here.
    let hash = (seed + 1) * 97 + (index + 1) * 31;
    for (const parent of parentNames[index]!) hash = (hash * 17 + observed[parent]! * 23 + 3) % 997;
    for (const parent of latentParents[index]!) hash = (hash * 19 + latent[parent]! * 29 + 7) % 997;
    return 0.05 + (hash % 89) * 0.9 / 88;
  };
  return (intervention: Assignment = {}): Distribution => assignments(vertices).map((values) => {
    if (Object.entries(intervention).some(([name, value]) => values[name] !== value)) return { values, probability: 0 };
    let weight = 0;
    for (const latent of latentRows) {
      let joint = latent.probability;
      for (let index = 0; index < vertices.length; index += 1) {
        const node = vertices[index]!;
        if (Object.hasOwn(intervention, node)) continue;
        const p = bernoulli(index, values, latent.values);
        joint *= values[node] === 1 ? p : 1 - p;
      }
      weight += joint;
    }
    return { values, probability: weight };
  });
}

/** AST evaluation independently implements probability and local sum binding. */
function evaluate(expression: IdentificationExpressionNode, observed: Distribution, environment: Assignment): number {
  switch (expression.type) {
    case "constant": return Number(expression.value);
    case "probability": {
      const event = Object.fromEntries([...expression.variables, ...expression.conditionedOn].map((name) => {
        if (!Object.hasOwn(environment, name)) throw new Error(`Unbound variable ${name}`);
        return [name, environment[name]!];
      }));
      const condition = Object.fromEntries(expression.conditionedOn.map((name) => [name, environment[name]!]));
      return probability(observed, event) / probability(observed, condition);
    }
    case "product": return expression.factors.reduce((value, factor) => value * evaluate(factor, observed, environment), 1);
    case "sum": return assignments(expression.variables).reduce((value, bound) => value + evaluate(expression.expression, observed, { ...environment, ...bound }), 0);
    case "quotient": return evaluate(expression.numerator, observed, environment) / evaluate(expression.denominator, observed, environment);
  }
}

function verify(vertices: string[], directed: Pair[], bidirected: Pair[], treatment: string[], outcome: string[], seed = 1): Set<number> {
  const result = identifyById({ graph: shape(vertices, directed, bidirected), treatment, outcome });
  expect(result.identified).toBe(true);
  if (!result.identified) throw new Error("Expected this fixture to be identifiable.");
  expect(getFreeVariables(result.expressionTree).every((node) => treatment.includes(node) || outcome.includes(node))).toBe(true);
  const model = scm(vertices, directed, bidirected, seed);
  const observed = model();
  expect(probability(observed, {})).toBeCloseTo(1, 12);
  for (const intervention of assignments(treatment)) {
    const intervened = model(intervention);
    let sum = 0;
    for (const event of assignments(outcome)) {
      const actual = evaluate(result.expressionTree, observed, { ...intervention, ...event });
      const expected = probability(intervened, event);
      expect(actual).toBeCloseTo(expected, 10);
      sum += actual;
    }
    expect(sum).toBeCloseTo(1, 10);
  }
  return new Set(result.trace.map(({ step }) => step));
}

describe("ID independently enumerated finite SCM validation", () => {
  it("matches frontdoor interventions through the recursive district kernel", () => {
    const steps = verify(["X", "M", "Y"], [["X", "M"], ["M", "Y"]], [["X", "Y"]], ["X"], ["Y"]);
    expect(steps).toContain(7);
    expect(steps).toContain(4);
  });

  it("matches a multi-district multi-outcome intervention", () => {
    verify(["X", "M", "N", "Y"], [["X", "M"], ["X", "N"], ["M", "Y"], ["N", "Y"]], [["M", "N"]], ["X"], ["M", "Y"], 5);
  });

  it("matches multiple interventions with apostrophe-containing vertices and local sum binding", () => {
    verify(["X", "X'", "M", "Y'"], [["X", "M"], ["X'", "M"], ["M", "Y'"]], [["X", "Y'"]], ["X", "X'"], ["Y'"], 9);
    verify(["X", "X'", "Y"], [["X", "X'"], ["X'", "Y"]], [["X", "Y"]], ["X"], ["Y"], 11);
  });

  it("matches step 2 and step 3 reductions against intervention enumeration", () => {
    expect(verify(["Z", "X", "Y", "W"], [["Z", "X"], ["X", "Y"]], [], ["X"], ["Y"])).toEqual(new Set([2, 3, 6]));
    verify(["Z", "X", "Y"], [["Z", "X"], ["X", "Y"]], [], [], ["X", "Y"]);
  });

  it("reproduces the five-node identifiable and non-identifiable examples in Shpitser and Pearl Figure 1", () => {
    // Primary reference: https://ftp.cs.ucla.edu/pub/stat_ser/r327.pdf,
    // Figure 1 and the accompanying causal-model description on page 2.
    const vertices = ["W1", "X", "Y1", "W2", "Y2"];
    const directed: Pair[] = [["W1", "X"], ["X", "Y1"], ["W2", "Y2"]];
    const bidirected: Pair[] = [["W1", "Y1"], ["X", "W2"], ["W1", "W2"], ["W1", "Y2"]];
    verify(vertices, directed, bidirected, ["X"], ["Y1", "Y2"], 13);
    const result = identifyById({ graph: shape(vertices, [...directed, ["W1", "W2"]], bidirected), treatment: ["X"], outcome: ["Y1", "Y2"] });
    expect(result.identified).toBe(false);
    expect(result.trace.some(({ step }) => step === 5)).toBe(true);
  });

  it("has positive observationally identical bow countermodels with different interventions", () => {
    // U is a fair coin, X=U. Independent outcome noise implements the tables.
    // Rows: x=0/1; columns: u=0/1. Both models depend on X and U.
    const first = [[0.2, 0.7], [0.3, 0.8]];
    const second = [[0.2, 0.1], [0.9, 0.8]];
    const model = (table: number[][], intervention?: number): Distribution => assignments(["X", "Y"]).map((values) => ({
      values,
      probability: [0, 1].reduce((total, u) => {
        const x = intervention ?? u;
        if (values.X !== x) return total;
        const p = table[x]![u]!;
        return total + 0.5 * (values.Y === 1 ? p : 1 - p);
      }, 0)
    }));
    expect(model(first)).toEqual(model(second));
    expect(model(first).every((row) => row.probability > 0)).toBe(true);
    expect(probability(model(first, 1), { Y: 1 })).toBeCloseTo(0.55, 12);
    expect(probability(model(second, 1), { Y: 1 })).toBeCloseTo(0.85, 12);
    const result = identifyById({ graph: shape(["X", "Y"], [["X", "Y"]], [["X", "Y"]]), treatment: ["X"], outcome: ["Y"] });
    expect(result.identified).toBe(false);
  });

  it("matches every identified singleton query across all 64 ordered three-node ADMGs and two SCM tables", () => {
    const vertices = ["A", "B", "C"];
    const pairs: Pair[] = [["A", "B"], ["A", "C"], ["B", "C"]];
    let identified = 0;
    let failed = 0;
    const steps = new Set<number>();
    for (let arrows = 0; arrows < 8; arrows += 1) {
      for (let confounding = 0; confounding < 8; confounding += 1) {
        const directed = pairs.filter((_, index) => (arrows & (1 << index)) !== 0);
        const bidirected = pairs.filter((_, index) => (confounding & (1 << index)) !== 0);
        for (const x of vertices) for (const y of vertices) {
          if (x === y) continue;
          const result = identifyById({ graph: shape(vertices, directed, bidirected), treatment: [x], outcome: [y] });
          result.trace.forEach(({ step }) => steps.add(step));
          if (!result.identified) { failed += 1; continue; }
          identified += 1;
          expect(getFreeVariables(result.expressionTree).every((node) => node === x || node === y)).toBe(true);
          for (const seed of [2, 7]) {
            const model = scm(vertices, directed, bidirected, seed);
            const observed = model();
            for (const xValue of [0, 1]) for (const yValue of [0, 1]) {
              const actual = evaluate(result.expressionTree, observed, { [x]: xValue, [y]: yValue });
              const expected = probability(model({ [x]: xValue }), { [y]: yValue });
              expect(actual, `arrows=${arrows}, bidirected=${confounding}, ${x}->${y}, seed=${seed}, x=${xValue}, y=${yValue}`).toBeCloseTo(expected, 10);
            }
          }
        }
      }
    }
    expect(identified + failed).toBe(384);
    expect(identified).toBeGreaterThan(200);
    expect(failed).toBeGreaterThan(0);
    expect(steps).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
  });
});
