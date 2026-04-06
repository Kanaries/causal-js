import type {
  ConditionalIndependenceTest,
  EdgeDescriptor,
  GraphKind,
  GraphShape,
  GraphValidationIssue,
  NumericMatrix
} from "@causal-js/core";
import type {
  CamuvOptions,
  CdnodOptions,
  ExactSearchOptions,
  FciOptions,
  GesOptions,
  GinOptions,
  GraspOptions,
  PcOptions,
  RcdOptions
} from "@causal-js/discovery";

export type DiscoveryAlgorithmId =
  | "pc"
  | "fci"
  | "ges"
  | "cdnod"
  | "exact-search"
  | "grasp"
  | "gin"
  | "cam-uv"
  | "rcd";

export type DiscoveryOptionsByAlgorithm = {
  pc: PcOptions;
  fci: FciOptions;
  ges: GesOptions;
  cdnod: CdnodOptions;
  "exact-search": ExactSearchOptions;
  grasp: GraspOptions;
  gin: GinOptions;
  "cam-uv": CamuvOptions;
  rcd: RcdOptions;
};

export type DiscoveryOptions = DiscoveryOptionsByAlgorithm[keyof DiscoveryOptionsByAlgorithm];

export type DiscoverGraphInput =
  {
    [Algorithm in DiscoveryAlgorithmId]: {
      algorithm: Algorithm;
      options: DiscoveryOptionsByAlgorithm[Algorithm];
      graphPreference?: DiscoveryGraphPreference;
    };
  }[DiscoveryAlgorithmId];

export type DiscoveryGraphPreference = "graph" | "cpdag" | "dag";

export interface TaskResultBase {
  task:
    | "discoverGraph"
    | "findAdjustmentSets"
    | "isAdjustmentSet"
    | "identifyEffect"
    | "falsifyGraph"
    | "stabilityAnalysis";
  graphKind: GraphKind;
  assumptions: string[];
  limitations: string[];
  caveats: string[];
}

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
  directedEdgeCount: number;
  undirectedEdgeCount: number;
  bidirectedEdgeCount: number;
  partiallyOrientedEdgeCount: number;
  partiallyUndirectedEdgeCount: number;
  nondirectedEdgeCount: number;
}

export interface DiscoverGraphResult extends TaskResultBase {
  task: "discoverGraph";
  algorithm: DiscoveryAlgorithmId;
  graph: GraphShape;
  primaryGraphField: "graph" | "cpdag" | "dag";
  artifacts: Partial<Record<"graph" | "cpdag" | "dag", GraphShape>>;
  summary: GraphSummary;
}

export interface AdjustmentSetCandidate {
  variables: string[];
  valid: boolean;
  minimal: boolean;
  blocksBackdoorPaths: boolean;
  blockedInBackdoorGraph: boolean;
  forbiddenDescendants: string[];
  witness: {
    conditioningSet: string[];
    forbiddenNodeIds: string[];
  };
}

export interface FindAdjustmentSetsOptions {
  graph: GraphShape;
  treatment: string;
  outcome: string;
  maxResults?: number;
  maxSetSize?: number;
}

export interface FindAdjustmentSetsResult extends TaskResultBase {
  task: "findAdjustmentSets";
  graph: GraphShape;
  treatment: string;
  outcome: string;
  graphType: GraphKind;
  candidateSets: AdjustmentSetCandidate[];
  canonicalSet: string[] | null;
  validAdjustmentSetCount: number;
  minimalAdjustmentSetCount: number;
}

export interface IsAdjustmentSetOptions {
  graph: GraphShape;
  treatment: string;
  outcome: string;
  adjustmentSet: readonly string[];
}

export interface IsAdjustmentSetResult extends TaskResultBase {
  task: "isAdjustmentSet";
  graph: GraphShape;
  treatment: string;
  outcome: string;
  adjustmentSet: string[];
  valid: boolean;
  candidate: AdjustmentSetCandidate;
}

export type IdentificationMethod = "backdoor" | "frontdoor" | "zero-effect" | "non-identifiable";

export type IdentificationEstimandFactorKind =
  | "zero"
  | "outcome-regression"
  | "covariate-distribution"
  | "mediator-distribution"
  | "treatment-distribution";

export interface IdentificationEstimandFactor {
  kind: IdentificationEstimandFactorKind;
  expression: string;
  variables: string[];
  conditionedOn: string[];
}

export type IdentificationExpressionNode =
  | {
      type: "constant";
      value: string;
    }
  | {
      type: "probability";
      variables: string[];
      conditionedOn: string[];
    }
  | {
      type: "product";
      factors: IdentificationExpressionNode[];
    }
  | {
      type: "sum";
      variables: string[];
      expression: IdentificationExpressionNode;
    };

export interface IdentificationEstimandSpec {
  strategy: Exclude<IdentificationMethod, "non-identifiable">;
  query: string;
  summary: string;
  expression: string | null;
  expressionTree: IdentificationExpressionNode;
  summationVariables: string[];
  factors: IdentificationEstimandFactor[];
}

export type IdentificationBackendId = "dag-first-mvp" | "dag-backdoor-only";
export type IdentificationBackendPreference = "auto" | IdentificationBackendId;
export type IdentificationBackendStatus = "available";
export type IdentificationQueryShape = "singleton-treatment-singleton-outcome";

export interface IdentificationBackendDescriptor {
  id: IdentificationBackendId;
  label: string;
  status: IdentificationBackendStatus;
  graphKinds: GraphKind[];
  supportedMethods: Exclude<IdentificationMethod, "non-identifiable">[];
  queryShape: IdentificationQueryShape;
  defaultForAuto: boolean;
  summary: string;
  limitations: string[];
}

export type IdentificationDiagnosticStrategy =
  | "zero-effect"
  | "backdoor"
  | "frontdoor"
  | "scope";

export type IdentificationDiagnosticStatus =
  | "identified"
  | "not-identified"
  | "not-applicable";

export interface IdentificationDiagnostic {
  strategy: IdentificationDiagnosticStrategy;
  status: IdentificationDiagnosticStatus;
  summary: string;
  details: string[];
  witness: IdentificationWitness;
}

export interface IdentificationWitness {
  adjustmentSet?: string[];
  mediators?: string[];
}

export interface IdentificationBackendContext {
  graph: GraphShape;
  treatment: string;
  outcome: string;
  maxAdjustmentSets?: number;
}

export interface IdentificationBackendEvaluation {
  identified: boolean;
  method?: Exclude<IdentificationMethod, "non-identifiable">;
  estimandSpec?: IdentificationEstimandSpec;
  witness?: IdentificationWitness;
  diagnostic: IdentificationDiagnostic;
}

export interface IdentificationBackendRun {
  backend: IdentificationBackendId;
  evaluation: IdentificationBackendEvaluation;
  diagnostics: IdentificationDiagnostic[];
}

export interface IdentifyEffectOptions {
  graph: GraphShape;
  treatment: string;
  outcome: string;
  maxAdjustmentSets?: number;
  backend?: IdentificationBackendPreference;
}

export interface IdentifyEffectResult extends TaskResultBase {
  task: "identifyEffect";
  graph: GraphShape;
  treatment: string;
  outcome: string;
  backend: IdentificationBackendId;
  identifiable: boolean;
  method: IdentificationMethod;
  estimand: string | null;
  estimandSpec: IdentificationEstimandSpec | null;
  witness: IdentificationWitness;
  diagnostics: IdentificationDiagnostic[];
  nextAction: string;
}

export interface ImpliedConditionalIndependence {
  x: string;
  y: string;
  conditioningSet: string[];
}

export interface TestedImplication extends ImpliedConditionalIndependence {
  status: "passed" | "failed" | "inconclusive";
  pValue: number | null;
  alpha: number | null;
  reason?: string;
}

export interface FalsifyGraphOptions {
  graph: GraphShape;
  data?: NumericMatrix;
  ciTest?: ConditionalIndependenceTest;
  alpha?: number;
  observedNodeOrder?: readonly string[];
}

export interface FalsifyGraphResult extends TaskResultBase {
  task: "falsifyGraph";
  graph: GraphShape;
  graphValidity: {
    valid: boolean;
    dagSupported: boolean;
    issues: GraphValidationIssue[];
  };
  impliedConditionalIndependences: ImpliedConditionalIndependence[];
  testedImplications: TestedImplication[];
  failedImplications: TestedImplication[];
  inconclusiveImplications: TestedImplication[];
  overallSummary: {
    testedCount: number;
    passedCount: number;
    failedCount: number;
    inconclusiveCount: number;
    falsified: boolean | null;
  };
}

export interface StabilityAnalysisOptions {
  discovery: DiscoverGraphInput;
  bootstrapSamples?: number;
  sampleFraction?: number;
  replace?: boolean;
  seed?: number;
  consensusThreshold?: number;
  createDiscoveryOptions?: (
    data: NumericMatrix,
    context: {
      iteration: number;
      sampledRowIndices: number[];
    }
  ) => DiscoveryOptions;
}

export interface EdgeFrequencySummary {
  node1: string;
  node2: string;
  adjacencyFrequency: number;
  absenceFrequency: number;
}

export interface OrientationFrequency {
  endpoint1: EdgeDescriptor["endpoint1"];
  endpoint2: EdgeDescriptor["endpoint2"];
  frequency: number;
}

export interface OrientationStabilitySummary {
  node1: string;
  node2: string;
  presentFrequency: number;
  dominantOrientation:
    | {
        endpoint1: EdgeDescriptor["endpoint1"];
        endpoint2: EdgeDescriptor["endpoint2"];
      }
    | null;
  dominantOrientationFrequency: number;
  orientations: OrientationFrequency[];
}

export interface StabilityAnalysisResult extends TaskResultBase {
  task: "stabilityAnalysis";
  algorithm: DiscoveryAlgorithmId;
  primaryGraphField: "graph" | "cpdag" | "dag";
  graphKind: GraphKind;
  bootstrapConfig: {
    bootstrapSamples: number;
    sampleFraction: number;
    replace: boolean;
    seed: number;
    consensusThreshold: number;
  };
  runSummaries: Array<{
    iteration: number;
    sampleSize: number;
    edgeCount: number;
    graphKind: GraphKind;
  }>;
  edgeFrequency: EdgeFrequencySummary[];
  orientationStability: OrientationStabilitySummary[];
  consensusGraph: GraphShape | null;
}
