import type {
  BackgroundKnowledge,
  ConditionalIndependenceTest,
  GraphShape,
  LocalScoreFunction,
  NumericMatrix
} from "@causal-js/core";

export type PcUcRule = 0 | 1 | 2;
export type PcUcPriority = -1 | 0 | 1 | 2 | 3 | 4;

export interface PcOptions {
  alpha?: number;
  ciTest: ConditionalIndependenceTest;
  data: NumericMatrix;
  nodeLabels?: readonly string[];
  stable?: boolean;
  ucRule?: PcUcRule;
  ucPriority?: PcUcPriority;
  backgroundKnowledge?: BackgroundKnowledge;
}

export interface GesOptions {
  data: NumericMatrix;
  score: LocalScoreFunction;
  nodeLabels?: readonly string[];
  maxParents?: number;
}

export interface ExactSearchOptions {
  data: NumericMatrix;
  score: LocalScoreFunction;
  nodeLabels?: readonly string[];
  maxParents?: number;
  searchMethod?: "dp" | "astar";
  usePathExtension?: boolean;
  useKCycleHeuristic?: boolean;
  superGraph?: NumericMatrix | readonly (readonly number[])[];
  includeGraph?: NumericMatrix | readonly (readonly number[])[];
}

export interface CdnodOptions {
  alpha?: number;
  data: NumericMatrix;
  context: NumericMatrix | readonly number[];
  createCiTest: (data: NumericMatrix) => ConditionalIndependenceTest;
  nodeLabels?: readonly string[];
  contextLabel?: string;
  stable?: boolean;
  ucRule?: PcUcRule;
  ucPriority?: PcUcPriority;
  backgroundKnowledge?: BackgroundKnowledge;
}

export interface GraspOptions {
  data: NumericMatrix;
  score: LocalScoreFunction;
  nodeLabels?: readonly string[];
  depth?: number;
  verbose?: boolean;
  randomSeed?: number;
}

export type GinIndependenceTestMethod = "hsic" | "kci";

export interface GinOptions {
  data: NumericMatrix;
  alpha?: number;
  indepTestMethod?: GinIndependenceTestMethod;
  nodeLabels?: readonly string[];
  latentLabelPrefix?: string;
}

export interface CamuvOptions {
  data: NumericMatrix;
  alpha?: number;
  maxExplanatoryVars?: number;
  nodeLabels?: readonly string[];
  polynomialDegree?: number;
  ridgePenalty?: number;
}

export interface RcdOptions {
  data: NumericMatrix;
  nodeLabels?: readonly string[];
  maxExplanatoryNum?: number;
  corAlpha?: number;
  indAlpha?: number;
  shapiroAlpha?: number;
  ridgePenalty?: number;
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

export interface CdnodResult extends PcResult {
  contextNodeIndex: number;
  observedNodeCount: number;
}

export interface GesResult {
  cpdag: GraphShape;
  dag: GraphShape;
  forwardSteps: number;
  backwardSteps: number;
  reverseSteps: number;
  score: number;
}

export interface ExactSearchResult {
  cpdag: GraphShape;
  dag: GraphShape;
  score: number;
  searchMethod: "dp" | "astar";
  evaluatedOrderStates: number;
  evaluatedParentSets: number;
}

export interface GraspResult {
  cpdag: GraphShape;
  dag: GraphShape;
  order: number[];
  edgeCount: number;
  score: number;
  depth: number;
}

export interface GinResult extends AlgorithmResult {
  causalOrder: number[][];
  remainingClusters: number[][];
  indepTestMethod: GinIndependenceTestMethod;
}

export interface CamuvResult extends AlgorithmResult {
  parents: number[][];
  confoundedPairs: number[][];
  maxExplanatoryVars: number;
}

export interface RcdResult extends AlgorithmResult {
  parents: number[][];
  ancestors: number[][];
  confoundedPairs: number[][];
  adjacencyMatrix: number[][];
}

export function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}
