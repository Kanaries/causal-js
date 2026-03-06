import type {
  BackgroundKnowledge,
  ConditionalIndependenceTest,
  GraphShape,
  LocalScoreFunction,
  NumericMatrix
} from "@causal-js/core";

export interface PcOptions {
  alpha?: number;
  ciTest: ConditionalIndependenceTest;
  data: NumericMatrix;
  nodeLabels?: readonly string[];
  stable?: boolean;
  backgroundKnowledge?: BackgroundKnowledge;
}

export interface GesOptions {
  data: NumericMatrix;
  score: LocalScoreFunction;
  nodeLabels?: readonly string[];
  maxParents?: number;
}

export interface AlgorithmResult {
  graph: GraphShape;
}

export interface SeparationSetEntry {
  x: number;
  y: number;
  conditioningSets: number[][];
}

export interface PcSkeletonResult extends AlgorithmResult {
  maxDepth: number;
  sepsets: SeparationSetEntry[];
  testsRun: number;
}

export interface PcResult extends PcSkeletonResult {}

export interface GesResult {
  cpdag: GraphShape;
  dag: GraphShape;
  forwardSteps: number;
  backwardSteps: number;
  reverseSteps: number;
  score: number;
}

export function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}
