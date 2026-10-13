import type { GraphShape } from "@causal-js/core";
import { describe, expect, it } from "vitest";

import { identifyById } from "./id";

type Pair = readonly [number, number];
interface SmallGraph {
  size: number;
  directed: readonly Pair[];
  bidirected: readonly Pair[];
}
interface Forest {
  vertices: number;
  edges: number;
  roots: number;
}

// Independent finite-graph oracle, not a second implementation of ID.
// Sources: Shpitser & Pearl, r327 (2006), Definitions 4/6/7 and Theorem 4;
// r329, Definition 5 and Theorem 3 restate the complete hedge criterion.
// https://ftp.cs.ucla.edu/pub/stat_ser/r327.pdf
// https://ftp.cs.ucla.edu/pub/stat_ser/r329.pdf
//
// The exhaustive comparisons below are restricted to singleton treatment and
// outcome. Therefore the nonempty X', Y' subsets in r327 Corollary 3 are exactly
// the supplied query. No unverified generalization to set interventions is used.
// Nothing here imports ID's graph traversal, districts, or expression helpers.

function shape(graph: SmallGraph): GraphShape {
  return {
    kind: "admg",
    nodes: Array.from({ length: graph.size }, (_, index) => ({ id: `V${index}` })),
    edges: [
      ...graph.directed.map(([from, to]) => ({
        node1: `V${from}`, node2: `V${to}`, endpoint1: "tail" as const, endpoint2: "arrow" as const
      })),
      ...graph.bidirected.map(([left, right]) => ({
        node1: `V${left}`, node2: `V${right}`, endpoint1: "arrow" as const, endpoint2: "arrow" as const
      }))
    ]
  };
}

function bidirectedConnected(vertices: number, pairs: readonly Pair[]): boolean {
  let reached = vertices & -vertices;
  let previous: number;
  do {
    previous = reached;
    for (const [left, right] of pairs) {
      const endpoints = (1 << left) | (1 << right);
      if ((vertices & endpoints) === endpoints && (reached & endpoints) !== 0) reached |= endpoints;
    }
  } while (previous !== reached);
  return reached === vertices;
}

function enumerateForests(graph: SmallGraph): Forest[] {
  const result: Forest[] = [];
  // Fixtures only contain arrows from a lower to a higher index. Thus every
  // enumerated directed edge subset is acyclic without relying on GraphIR/ID.
  if (graph.directed.some(([from, to]) => from >= to)) throw new Error("Oracle requires ordered DAG arrows.");
  for (let vertices = 1; vertices < 1 << graph.size; vertices += 1) {
    if (!bidirectedConnected(vertices, graph.bidirected)) continue;
    for (let edges = 0; edges < 1 << graph.directed.length; edges += 1) {
      let nonRoots = 0;
      let valid = true;
      for (let index = 0; index < graph.directed.length; index += 1) {
        if ((edges & (1 << index)) === 0) continue;
        const [from, to] = graph.directed[index]!;
        const endpoints = (1 << from) | (1 << to);
        if ((vertices & endpoints) !== endpoints || (nonRoots & (1 << from)) !== 0) {
          valid = false;
          break;
        }
        nonRoots |= 1 << from;
      }
      if (valid) result.push({ vertices, edges, roots: vertices & ~nonRoots });
    }
  }
  return result;
}

function ancestorMaskAfterIntervention(graph: SmallGraph, treatment: number, outcome: number): number {
  // Boolean transitive closure of G_barX, rather than ID's backward search.
  const reachability = Array.from({ length: graph.size }, (_, index) => 1 << index);
  for (const [from, to] of graph.directed) {
    if (to !== treatment) reachability[from] = reachability[from]! | (1 << to);
  }
  for (let via = 0; via < graph.size; via += 1) {
    for (let from = 0; from < graph.size; from += 1) {
      if ((reachability[from]! & (1 << via)) !== 0) {
        reachability[from] = reachability[from]! | reachability[via]!;
      }
    }
  }
  return reachability.reduce((ancestors, descendants, node) =>
    (descendants & (1 << outcome)) !== 0 ? ancestors | (1 << node) : ancestors, 0);
}

function findHedge(
  graph: SmallGraph,
  treatment: number,
  outcome: number,
  forests = enumerateForests(graph)
): { outer: Forest; inner: Forest } | undefined {
  const x = 1 << treatment;
  const ancestors = ancestorMaskAfterIntervention(graph, treatment, outcome);
  for (const outer of forests) {
    if ((outer.vertices & x) === 0 || (outer.roots & ancestors) !== outer.roots) continue;
    for (const inner of forests) {
      if ((inner.vertices & x) !== 0 || inner.roots !== outer.roots) continue;
      if ((inner.vertices & outer.vertices) !== inner.vertices || inner.vertices === outer.vertices) continue;
      // Vertex nesting alone is insufficient: F' must be an edge subgraph of F
      // as well. The bit positions refer to the same original directed edges.
      if ((inner.edges & outer.edges) !== inner.edges) continue;
      // Keeping all available bidirected edges is sufficient: connectedness is
      // equivalent to having a spanning tree (Definition 4), and the inner
      // bidirected edges are then automatically a subset of the outer edges.
      return { outer, inner };
    }
  }
  return undefined;
}

describe("ID decisions against an independent exhaustive hedge oracle", () => {
  it("matches hedge existence for all 384 singleton queries on 64 ordered three-node ADMGs", () => {
    const pairs: Pair[] = [[0, 1], [0, 2], [1, 2]];
    let identified = 0;
    let nonIdentified = 0;
    for (let arrows = 0; arrows < 8; arrows += 1) {
      for (let confounding = 0; confounding < 8; confounding += 1) {
        const graph: SmallGraph = {
          size: 3,
          directed: pairs.filter((_, index) => (arrows & (1 << index)) !== 0),
          bidirected: pairs.filter((_, index) => (confounding & (1 << index)) !== 0)
        };
        const forests = enumerateForests(graph);
        for (let treatment = 0; treatment < 3; treatment += 1) {
          for (let outcome = 0; outcome < 3; outcome += 1) {
            if (treatment === outcome) continue;
            const hedge = findHedge(graph, treatment, outcome, forests);
            const expected = hedge === undefined;
            if (expected) identified += 1;
            else nonIdentified += 1;
            const actual = identifyById({ graph: shape(graph), treatment: [`V${treatment}`], outcome: [`V${outcome}`] });
            expect(actual.identified, `arrows=${arrows}, bidirected=${confounding}, V${treatment}->V${outcome}`)
              .toBe(expected);
          }
        }
      }
    }
    expect(identified + nonIdentified).toBe(384);
    expect(identified).toBeGreaterThan(0);
    expect(nonIdentified).toBeGreaterThan(0);
  });

  it("requires multiple roots, nested directed edges, and reachability to the outcome in four-node fixtures", () => {
    const fixtures: Array<{ label: string; graph: SmallGraph; treatment: number; outcome: number; identifiable: boolean }> = [
      {
        // X=V0, A=V1, B=V2, Y=V3. The only possible hedge uses
        // roots {A,B}; neither an isolated bow check nor a C-tree suffices.
        label: "two-root C-forest",
        graph: { size: 4, directed: [[0, 1], [1, 3], [2, 3]], bidirected: [[0, 2], [1, 2]] },
        treatment: 0, outcome: 3, identifiable: false
      },
      {
        label: "frontdoor with downstream outcome",
        graph: { size: 4, directed: [[0, 1], [1, 2], [2, 3]], bidirected: [[0, 2]] },
        treatment: 0, outcome: 3, identifiable: true
      },
      {
        label: "bow disconnected from the queried causal mechanism",
        graph: { size: 4, directed: [[0, 1], [2, 3]], bidirected: [[0, 1]] },
        treatment: 2, outcome: 3, identifiable: true
      },
      {
        label: "bow upstream of the outcome",
        graph: { size: 4, directed: [[0, 1], [1, 2], [2, 3]], bidirected: [[0, 1]] },
        treatment: 0, outcome: 3, identifiable: false
      }
    ];
    for (const fixture of fixtures) {
      const hedge = findHedge(fixture.graph, fixture.treatment, fixture.outcome);
      expect(hedge === undefined, `${fixture.label}: independent oracle`).toBe(fixture.identifiable);
      const result = identifyById({
        graph: shape(fixture.graph), treatment: [`V${fixture.treatment}`], outcome: [`V${fixture.outcome}`]
      });
      expect(result.identified, `${fixture.label}: ID`).toBe(fixture.identifiable);
      if (fixture.label === "two-root C-forest") {
        expect(hedge!.outer.roots).toBe((1 << 1) | (1 << 2));
        expect(hedge!.inner.roots).toBe(hedge!.outer.roots);
      }
    }
  });
});
