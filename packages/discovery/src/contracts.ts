import type { ConditionalIndependenceTest, GraphShape, LocalScoreFunction, NumericMatrix } from "@causal-js/core";

export interface PcOptions {
  alpha?: number;
  ciTest: ConditionalIndependenceTest;
  data: NumericMatrix;
  nodeLabels?: readonly string[];
}

export interface GesOptions {
  data: NumericMatrix;
  score: LocalScoreFunction;
  nodeLabels?: readonly string[];
}

export interface AlgorithmResult {
  graph: GraphShape;
}

export function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}
