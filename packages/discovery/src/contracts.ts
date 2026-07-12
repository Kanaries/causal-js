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

export interface FciOptions {
  alpha?: number;
  ciTest: ConditionalIndependenceTest;
  data: NumericMatrix;
  nodeLabels?: readonly string[];
  stable?: boolean;
  depth?: number;
  maxPathLength?: number;
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
  /**
   * "astar" (default): A* over the order graph with an admissible
   * per-variable-minimum heuristic. "dp": Silander-Myllymaki dynamic
   * programming. Both return the same optimal score; tie-breaking between
   * equally-scored DAGs may differ (the CPDAG is the stable artifact).
   */
  searchMethod?: "dp" | "astar";
  /** A* only: greedily absorb variables whose optimal parents are already available (default true). */
  usePathExtension?: boolean;
  /** A* only: k-cycle conflict pattern-database heuristic (default false). */
  useKCycleHeuristic?: boolean;
  /** Pattern-database depth for useKCycleHeuristic (default 3). */
  kCycleK?: number;
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
  bwMethod?: "mdbs" | "scott" | "silverman";
  /**
   * "spline" (default): truncated-power cubic spline with quantile knots and
   * backfitting. "pspline": cubic B-spline basis with a second-order
   * difference penalty — closer to the pygam GAM used by causal-learn's
   * CAM-UV (opt-in; may become the default after a parity re-baseline).
   * "polynomial": plain polynomial basis.
   */
  smoother?: "spline" | "polynomial" | "pspline";
  /** pspline only: number of B-spline basis functions (default 20, pygam-like). */
  nSplines?: number;
  /** pspline only: curvature penalty weight (default 0.6, pygam-like). */
  psplineLambda?: number;
  splineKnots?: number;
  gamMaxIterations?: number;
  gamTolerance?: number;
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
  mlhsicr?: boolean;
  bwMethod?: "mdbs" | "scott" | "silverman";
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

export type MvpcCorrection = "mvcrtn-fisher-z" | "none";

export interface MvpcOptions {
  /** Data matrix; missing entries are NaN. */
  data: NumericMatrix;
  alpha?: number;
  nodeLabels?: readonly string[];
  stable?: boolean;
  ucRule?: PcUcRule;
  ucPriority?: PcUcPriority;
  backgroundKnowledge?: BackgroundKnowledge;
  /**
   * "mvcrtn-fisher-z" (default) runs the permutation-based missingness
   * correction; "none" is plain test-wise-deletion PC.
   */
  correction?: MvpcCorrection;
  /**
   * Seed for the correction's predictor shuffle (default 1). Intentional
   * deviation from causal-learn, which uses the unseeded global NumPy RNG.
   */
  randomSeed?: number;
}

export interface MvpcResult extends PcResult {
  /** Missingness indicators (column indices) with at least one detected parent. */
  missingnessIndicators: number[];
  /** missingnessParents[i] lists the parents of missingnessIndicators[i]. */
  missingnessParents: number[][];
  correctionTestsRun: number;
}

export interface FciResult extends AlgorithmResult {
  maxDepth: number;
  sepsets: SeparationSetEntry[];
  testsRun: number;
}

export interface CdnodResult extends PcResult {
  contextNodeIndex: number;
  observedNodeCount: number;
}

export interface GesResult {
  cpdag: GraphShape;
  dag: GraphShape;
  forwardSteps: number;
  backwardSteps: number;
  /**
   * Always 0. This implementation mirrors causal-learn's GES, which has
   * forward (insert) and backward (delete) phases only; there is no
   * turning/reverse phase. Kept for result-shape stability.
   */
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
