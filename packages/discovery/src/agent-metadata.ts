import type { AgentMethodMetadata, KciUnconditionalTestOptions } from "@causal-js/core";

import type { AnmOptions } from "./anm";
import type {
  CamuvOptions, CdnodOptions, ExactSearchOptions, FciOptions, GesOptions,
  GinOptions, GraspOptions, MvpcOptions, PcOptions, RcdOptions
} from "./contracts";

type Schema = AgentMethodMetadata["inputSchema"];
type OptionProperties<T> = { [K in keyof T]-?: Schema };

function runtimeValue(jsType: string, description: string): Schema {
  return { "x-js-type": jsType, "x-json-serializable": false, description };
}

const data = runtimeValue("NumericMatrix", "JavaScript NumericMatrix instance (for example new DenseMatrix(rows)), exposing rows, columns, at, row, column, and toArray; a JSON array alone is not accepted.");
const ciTest = runtimeValue("ConditionalIndependenceTest", "JavaScript object with name and test(x, y, conditioningSet) methods, bound to the same data and column order as data. The selected test determines statistical assumptions.");
const score = runtimeValue("LocalScoreFunction", "JavaScript object with name and score(node, parents) methods, bound to the same data and column order as data. Lower scores are preferred; use a compatible decomposable score.");
const backgroundKnowledge = runtimeValue("BackgroundKnowledge", "BackgroundKnowledge instance with query methods; a serialized BackgroundKnowledgeShape must first be hydrated using BackgroundKnowledge.fromShape.");
const nodeLabels: Schema = { type: "array", items: { type: "string" }, uniqueItems: true, description: "One unique label per data column; omitted labels are generated." };
const alpha: Schema = { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1, default: 0.05 };
const stable: Schema = { type: "boolean", default: true };
const ucRule: Schema = { type: "integer", enum: [0, 1, 2], default: 0, description: "Collider rule: 0 sepset, 1 max-p, 2 definite-max-p." };
const ucPriority: Schema = { type: "integer", enum: [-1, 0, 1, 2, 3, 4], default: 2, description: "Collider conflict policy. -1 selects the rule-specific default; ucRule=2 only permits resolved priorities 2, 3, or 4." };
const bwMethod: Schema = { type: "string", enum: ["mdbs", "scott", "silverman"], default: "mdbs" };
const numericVector: Schema = { type: "array", items: { type: "number" } };
const adjacency: Schema = {
  anyOf: [data, { type: "array", items: { type: "array", items: { type: "number" } } }],
  description: "Square adjacency matrix with one row/column per variable; entry [parent][child] marks an allowed/required edge. NumericMatrix or number[][] is accepted."
};

// Mapped types make additions/removals in the actual option interfaces a compile-time error here.
const pcProperties = { data, ciTest, nodeLabels, alpha, stable, ucRule, ucPriority, backgroundKnowledge } satisfies OptionProperties<PcOptions>;
const mvpcProperties = {
  data: { ...data, description: `${data.description} Missing values must be JavaScript NaN.` },
  nodeLabels, alpha, stable, ucRule, ucPriority, backgroundKnowledge,
  correction: { type: "string", enum: ["mvcrtn-fisher-z", "none"], default: "mvcrtn-fisher-z" },
  randomSeed: { type: "number", default: 1, description: "Seed for the missingness-correction predictor shuffle." }
} satisfies OptionProperties<MvpcOptions>;
const fciProperties = {
  data, ciTest, nodeLabels, alpha, stable, backgroundKnowledge,
  depth: { type: "integer", minimum: -1, default: -1, description: "Skeleton conditioning depth; -1 means unlimited. This does not cap the Possible-D-SEP search." },
  maxPathLength: { type: "integer", minimum: -1, default: -1, description: "Discriminating-path length limit; -1 means unlimited." }
} satisfies OptionProperties<FciOptions>;
const gesProperties = {
  data, score, nodeLabels,
  maxParents: { type: "integer", minimum: 0, description: "Parent-count search bound; implementation default is data.columns / 2." }
} satisfies OptionProperties<GesOptions>;
const exactProperties = {
  data, score, nodeLabels,
  maxParents: { type: "integer", minimum: 0, description: "Parent-count search bound; defaults to data.columns." },
  searchMethod: { type: "string", enum: ["dp", "astar"], default: "astar" },
  usePathExtension: { type: "boolean", default: true, description: "A* only: greedily absorb variables with already available optimal parents." },
  useKCycleHeuristic: { type: "boolean", default: false, description: "A* only: use a k-cycle conflict heuristic." },
  kCycleK: { type: "integer", minimum: 1, default: 3, description: "Pattern-database depth for the A* k-cycle heuristic." },
  superGraph: adjacency, includeGraph: adjacency
} satisfies OptionProperties<ExactSearchOptions>;
const cdnodProperties = {
  data, nodeLabels, alpha, stable, ucRule, ucPriority, backgroundKnowledge,
  context: { anyOf: [data, numericVector], description: "Context vector or single-column NumericMatrix, with exactly data.rows samples." },
  createCiTest: runtimeValue("function", "(augmentedData: NumericMatrix) => ConditionalIndependenceTest; must bind the returned test to the supplied context-augmented matrix."),
  contextLabel: { type: "string", default: "C", description: "Unique context label, distinct from observed node labels." }
} satisfies OptionProperties<CdnodOptions>;
const graspProperties = {
  data, score, nodeLabels,
  depth: { type: "integer", minimum: 1, default: 3 },
  verbose: { type: "boolean", default: false, description: "Print search progress to console." },
  randomSeed: { type: "number", description: "Seed for ordering/search randomness; omitted uses Math.random." }
} satisfies OptionProperties<GraspOptions>;
const ginProperties = {
  data, nodeLabels, alpha,
  indepTestMethod: { type: "string", enum: ["hsic", "kci"], default: "kci" },
  latentLabelPrefix: { type: "string", default: "L" }
} satisfies OptionProperties<GinOptions>;
const camuvProperties = {
  data, nodeLabels, alpha: { ...alpha, default: 0.01 }, bwMethod,
  maxExplanatoryVars: { type: "integer", minimum: 1, default: 3 },
  smoother: { type: "string", enum: ["spline", "polynomial", "pspline"], default: "spline" },
  nSplines: { type: "integer", minimum: 4, default: 20, description: "pspline only: B-spline basis size." },
  psplineLambda: { type: "number", minimum: 0, default: 0.6, description: "pspline only: second-order difference penalty." },
  splineKnots: { type: "integer", minimum: 0, default: 6 },
  gamMaxIterations: { type: "integer", minimum: 1, default: 25 },
  gamTolerance: { type: "number", exclusiveMinimum: 0, default: 0.00001 },
  polynomialDegree: { type: "integer", minimum: 1, default: 3 },
  ridgePenalty: { type: "number", minimum: 0, default: 0.000001 }
} satisfies OptionProperties<CamuvOptions>;
const rcdProperties = {
  data, nodeLabels, bwMethod,
  maxExplanatoryNum: { type: "integer", minimum: 1, default: 2 },
  corAlpha: { ...alpha, default: 0.01 }, indAlpha: { ...alpha, default: 0.01 }, shapiroAlpha: { ...alpha, default: 0.01 },
  mlhsicr: { type: "boolean", default: false, description: "Enable approximate MLHSICR residualization." },
  ridgePenalty: { type: "number", minimum: 0, default: 0 }
} satisfies OptionProperties<RcdOptions>;
const kciProperties = {
  kernelX: { type: "string", enum: ["Gaussian", "Linear", "Polynomial"], default: "Gaussian" },
  kernelY: { type: "string", enum: ["Gaussian", "Linear", "Polynomial"], default: "Gaussian" },
  nullSampleSize: { type: "integer", minimum: 1, default: 1000 },
  approx: { type: "boolean", default: true },
  estWidth: { type: "string", enum: ["empirical", "median", "manual"], default: "empirical" },
  polynomialDegree: { type: "integer", minimum: 1, default: 2 },
  kernelWidthX: { type: "number", exclusiveMinimum: 0 },
  kernelWidthY: { type: "number", exclusiveMinimum: 0 }
} satisfies OptionProperties<KciUnconditionalTestOptions>;
const anmOptionsProperties = {
  regressor: runtimeValue("AnmRegressor", "Object exposing fitPredict(predictor, response); defaults to DeterministicRbfRegressor. Must return finite fitted values with the input sample count."),
  kci: { type: "object", properties: kciProperties, additionalProperties: false }
} satisfies OptionProperties<AnmOptions>;

function optionsSchema(properties: Record<string, Schema>, required: string[]): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object", properties, required, additionalProperties: false,
    "x-js-call-style": "options-object",
    "x-json-serializable": false,
    description: "Describes the direct JavaScript API options, including non-JSON runtime values annotated with x-js-type. This is introspection metadata, not a JSON execution endpoint or runtime validator."
  };
}

const schemas: Record<string, Schema> = {
  pc: optionsSchema(pcProperties, ["data", "ciTest"]),
  mvpc: optionsSchema(mvpcProperties, ["data"]),
  fci: optionsSchema(fciProperties, ["data", "ciTest"]),
  ges: optionsSchema(gesProperties, ["data", "score"]),
  cdnod: optionsSchema(cdnodProperties, ["data", "context", "createCiTest"]),
  "exact-search": optionsSchema(exactProperties, ["data", "score"]),
  grasp: optionsSchema(graspProperties, ["data", "score"]),
  gin: optionsSchema(ginProperties, ["data"]),
  "cam-uv": optionsSchema(camuvProperties, ["data"]),
  rcd: optionsSchema(rcdProperties, ["data"]),
  anm: {
    ...optionsSchema({ x: { ...numericVector, minItems: 8 }, y: { ...numericVector, minItems: 8 }, options: { type: "object", properties: anmOptionsProperties, additionalProperties: false } }, ["x", "y"]),
    "x-js-call-style": "positional",
    "x-js-arguments": ["x", "y", "options"],
    description: "Describes positional arguments to anm(x, y, options?), not an object accepted by anm or discoverGraph. Custom regressor is a JavaScript runtime object."
  },
  calm: { $schema: "https://json-schema.org/draft/2020-12/schema", not: {}, description: "No callable implementation or accepted input is available." }
};

const shapePreconditions = [
  "Provide a NumericMatrix with nonempty rectangular numeric data and one unique node label per column when labels are supplied.",
  "Check finite values, sample size, and nondegenerate columns against the selected statistical test or score; metadata does not perform these checks."
];
const ciAssumptions = [
  "Causal Markov and faithfulness assumptions hold for an acyclic causal system.",
  "The supplied conditional-independence test is valid for the data: for example Fisher-Z uses Gaussian partial-correlation assumptions, discrete tests need appropriate counts, and kernel tests need suitable kernels/calibration."
];
const scoreAssumptions = [
  "The causal system is acyclic, causally sufficient, and satisfies the assumptions needed to infer its Markov equivalence class.",
  "The supplied local score is decomposable and appropriate for the sampling model; CPDAG interpretation additionally requires score equivalence and consistency. Gaussian BIC and BDeu impose different data-model assumptions."
];
const inputFailure = {
  code: "invalid_input", message: "Data, labels, or runtime collaborators do not satisfy the method's input contract.",
  recoveryHint: "Construct DenseMatrix and the required test/score objects, align their data and column order, and inspect this method's input schema.", alternatives: []
};
const statisticalFailure = {
  code: "statistical_test_or_score_failure", message: "A statistical test, score, or residual fit is undefined or numerically unstable.",
  recoveryHint: "Inspect constant/collinear columns, missing values, effective sample size, and the selected test/score model before retrying; changing alpha does not repair invalid data.", alternatives: []
};

type MethodDetails = Pick<AgentMethodMetadata, "summary" | "assumptions" | "preconditions" | "notRecommendedWhen" | "alternatives" | "costProfile" | "limitations"> & { failureModes?: AgentMethodMetadata["failureModes"] };
const details: Record<string, MethodDetails> = {
  pc: {
    summary: "Constraint-based CPDAG discovery: stable skeleton search, all uc-rule/uc-priority collider variants, Meek rules, background knowledge, and Fisher-Z / chi-square / G-square / KCI tests.",
    preconditions: [...shapePreconditions, "Bind ciTest to data; alpha must lie strictly between 0 and 1, and ucRule/ucPriority must be compatible."],
    assumptions: [...ciAssumptions, "No unmeasured common causes or selection bias among the modeled variables."],
    notRecommendedWhen: ["Latent common causes are plausible; consider FCI.", "Dense high-dimensional graphs make conditioning-set enumeration expensive."],
    alternatives: ["fci", "ges"],
    costProfile: "Conditioning-set enumeration is exponential in neighborhood size; each CI test adds its own sample-size cost. Kernel tests can require quadratic sample memory.",
    limitations: ["Returns an equivalence-class graph, not a uniquely identified causal DAG or an effect estimate.", "Finite-sample CI errors and collider conflict policies can change orientations."]
  },
  mvpc: {
    summary: "Missing-value PC: test-wise-deletion skeleton search plus permutation-based missingness correction (MV-Fisher-Z / MC-Fisher-Z).",
    preconditions: ["Provide NumericMatrix data with missing entries encoded as NaN, not null, and sufficient observed rows for each tested subset.", "Use unique column-aligned nodeLabels and compatible ucRule/ucPriority values."],
    assumptions: ["PC's acyclic, Markov, faithfulness, and causal-sufficiency assumptions hold for the substantive variables.", "Fisher-Z partial-correlation assumptions and the missingness-graph assumptions of test-wise deletion/correction hold; arbitrary self-masking or MNAR mechanisms are not generally resolved by this method."],
    notRecommendedWhen: ["Too few complete observations remain in tested subsets.", "A plausible missingness mechanism violates the correction model."],
    alternatives: ["pc", "fci"],
    costProfile: "PC skeleton search plus missingness-parent searches and permutation correction; cost grows with neighborhood density and number of missingness indicators.",
    limitations: ["correction='none' performs test-wise deletion without the missingness correction.", "The correction uses a seeded predictor shuffle, unlike upstream global unseeded randomness.", "Missingness correction does not establish that the missingness assumptions hold."]
  },
  fci: {
    summary: "Constraint-based PAG discovery with latent-confounder orientation rules built on endpoint-aware graph semantics.",
    preconditions: [...shapePreconditions, "Bind ciTest to data; use depth/maxPathLength=-1 for unlimited searches or nonnegative limits."],
    assumptions: [...ciAssumptions, "Observed independences are representable by a maximal ancestral graph arising from an acyclic system; correctness depends on valid CI decisions."],
    notRecommendedWhen: ["Large dense graphs make Possible-D-SEP searches expensive.", "A fully oriented causal DAG is required without additional assumptions."],
    alternatives: ["pc", "gin"],
    costProfile: "Potentially exponential skeleton and Possible-D-SEP conditioning searches plus repeated path/orientation searches; kernel CI adds quadratic sample memory.",
    limitations: ["Returns a PAG: circle endpoints retain causal ambiguity and cannot be treated as arbitrary directed edges.", "Finite depth/path limits can omit separating sets or orientations; depth only limits the initial skeleton stage."]
  },
  ges: {
    summary: "Greedy equivalence search over CPDAGs with insert/delete operators and Gaussian BIC or BDeu local scores.",
    preconditions: [...shapePreconditions, "Bind a lower-is-better LocalScoreFunction to data and choose a nonnegative maxParents bound."],
    assumptions: scoreAssumptions,
    notRecommendedWhen: ["Latent confounding is expected.", "A global score optimum is required for a small graph; consider exact-search."],
    alternatives: ["exact-search", "grasp", "fci"],
    costProfile: "Repeated insert/delete operator and parent-subset evaluation; cost is combinatorial in graph density and depends on local score caching and evaluation cost.",
    limitations: ["Greedy search may stop short of the global score optimum.", "Only forward and backward phases are implemented; reverseSteps is always 0.", "The returned DAG is a representative of the CPDAG, not a uniquely established causal direction for every edge."]
  },
  cdnod: {
    summary: "Nonstationary discovery built on the portable PC substrate plus an augmented context index.",
    preconditions: [...shapePreconditions, "Provide one context value per sample and a createCiTest factory that binds the augmented matrix.", "contextLabel must not duplicate an observed node label."],
    assumptions: [...ciAssumptions, "The supplied context captures relevant distribution shifts, and conditional-independence testing remains valid for the context-augmented data."],
    notRecommendedWhen: ["Temporal dependence invalidates an iid test merely because a time index was appended.", "A full independent-change orientation method is needed beyond context-augmented PC."],
    alternatives: ["pc", "fci"],
    costProfile: "PC-style combinatorial CI search on one additional context variable; creates an augmented copy of the data matrix.",
    limitations: ["Implements context-augmented PC and context-edge orientation; does not implement the full CD-NOD independent-change orientation procedure.", "Context association alone does not identify an intervention effect."]
  },
  "exact-search": {
    summary: "Exact score-based DAG search for small graphs using the shared local score interface.",
    preconditions: [...shapePreconditions, "Use at most 18 variables with dp or 24 with astar; these hard limits remain even with graph constraints.", "Bind a decomposable lower-is-better score; includeGraph must be acyclic, respect superGraph, and fit maxParents."],
    assumptions: scoreAssumptions,
    notRecommendedWhen: ["Many variables or permissive parent bounds make exponential search impractical.", "Latent confounding undermines the observed-DAG model."],
    alternatives: ["ges", "grasp", "fci"],
    costProfile: "Exponential parent-set enumeration and order-state search; DP uses O(p * 2^p) order-state storage and parent-set tables, while A* may reduce visited states but has exponential worst-case cost.",
    limitations: ["Exactness is relative to the supplied score and admissible graph constraints, not a guarantee of the true causal graph.", "Equal-score DAG tie-breaking may differ between dp and astar."],
    failureModes: [{ code: "search_space_limit", message: "The selected backend's variable limit is exceeded or graph constraints are inconsistent.", recoveryHint: "Use ges/grasp above the hard variable limit; otherwise repair includeGraph/superGraph/maxParents constraints.", alternatives: ["ges", "grasp"] }]
  },
  grasp: {
    summary: "Permutation-based sparse DAG search built on the shared local score interface.",
    preconditions: [...shapePreconditions, "Bind a compatible LocalScoreFunction and use a positive search depth; set randomSeed for repeatable search randomness."],
    assumptions: scoreAssumptions,
    notRecommendedWhen: ["A global score optimum is required.", "Latent confounders are expected among the observed variables."],
    alternatives: ["exact-search", "ges", "fci"],
    costProfile: "Repeated permutation exploration and parent-score evaluation; increasing depth and graph density increases combinatorial search work.",
    limitations: ["Search is heuristic and depends on ordering/randomness; omitted randomSeed uses Math.random.", "A returned DAG represents the associated CPDAG and is not necessarily uniquely identified."]
  },
  gin: {
    summary: "Hidden-causal cluster discovery for latent-variable models using kernel independence tests. Note: intentionally fixes an upstream causal-learn indexing bug, so outputs follow the GIN paper rather than the Python implementation.",
    preconditions: [...shapePreconditions, "Use continuous observations suitable for covariance estimation and HSIC/KCI independence testing."],
    assumptions: ["The GIN linear non-Gaussian latent-variable measurement model and its clustering/rank conditions hold.", "Noise independence and faithfulness conditions required for GIN identification hold."],
    notRecommendedWhen: ["General nonlinear latent-variable systems do not satisfy the GIN measurement model.", "Too few informative indicators exist to resolve latent clusters."],
    alternatives: ["fci", "rcd", "cam-uv"],
    costProfile: "Combinatorial cluster-subset searches with covariance/eigen calculations and kernel independence tests; dense sample kernels require O(n^2) memory.",
    limitations: ["Uses the actual remaining variable indices, intentionally diverging from an upstream causal-learn indexing bug.", "Unresolved clusters remain explicit; latent clusters/order are model-dependent rather than general latent-confounder identification."]
  },
  "cam-uv": {
    summary: "Nonlinear causal discovery with latent confounder hints using a portable additive-regression approximation.",
    preconditions: [...shapePreconditions, "Use continuous data and valid smoother, bandwidth, penalty, and convergence settings."],
    assumptions: ["The data follow the additive nonlinear causal model with unobserved variables assumed by CAM-UV.", "Residual independence tests and the chosen additive regression approximation adequately represent the mechanisms."],
    notRecommendedWhen: ["Strong nonadditive interactions are central to the causal mechanism.", "Very large sample kernels or parent-subset searches exceed the compute budget."],
    alternatives: ["fci", "rcd", "gin"],
    costProfile: "Enumerates candidate explanatory subsets and repeatedly fits additive regressions; kernel dependence tests require O(n^2) sample memory.",
    limitations: ["Portable spline/pspline/polynomial regression approximates the upstream GAM behavior; smoothers are not numerically interchangeable.", "Confounded-pair hints do not uniquely identify a latent graph or causal effect."]
  },
  rcd: {
    summary: "Linear non-Gaussian discovery with latent confounder detection (OLS or approximate MLHSICR residualization plus HSIC independence tests).",
    preconditions: [...shapePreconditions, "Use continuous data suitable for correlation, non-Gaussianity, regression, and HSIC tests."],
    assumptions: ["A linear acyclic non-Gaussian causal model with independent disturbances and the latent-variable conditions of RCD holds.", "Regression residualization and independence-test calibration are adequate for the selected configuration."],
    notRecommendedWhen: ["Mechanisms are strongly nonlinear or disturbances are Gaussian.", "Numerical coefficients will be interpreted as identified interventional effects without checking the latent-variable model."],
    alternatives: ["cam-uv", "fci", "gin"],
    costProfile: "Enumerates explanatory subsets and residual regressions with dense HSIC kernels (O(n^2) sample memory); mlhsicr adds iterative optimization.",
    limitations: ["mlhsicr=true uses an approximate optimizer, not an exact upstream optimization path.", "Confounded entries in adjacencyMatrix may be NaN; JSON serialization needs an explicit missing/nonfinite-value policy.", "The graph representation cannot retain simultaneous directed and bidirected edges for the same pair."]
  },
  anm: {
    summary: "Pairwise additive-noise direction scores using regression residuals and unconditional KCI.",
    preconditions: ["Call anm(x, y, options?) with paired finite numeric vectors of equal length, at least 8 samples, and variation in both vectors.", "An injected regressor must return one finite fitted value per sample."],
    assumptions: ["The pair is causally sufficient and admits an identifiable additive-noise model in the causal direction.", "Independent sampling, adequate regression fit, and valid residual-independence testing are needed to interpret direction scores."],
    notRecommendedWhen: ["Latent confounding, feedback, or linear Gaussian symmetry makes pairwise direction ambiguous.", "A multivariate graph or calibrated effect estimate is required."],
    alternatives: ["pc", "fci", "cam-uv"],
    costProfile: "Default RBF candidate regressions use dense sample kernels and factorizations (O(n^2) memory, cubic-time solves per candidate); KCI adds kernel/eigen work.",
    limitations: ["Direct positional API only; anm is not a discoverGraph algorithm.", "Returns direction-wise independence p-values, not posterior direction probabilities or a selected causal graph.", "Default deterministic RBF regression differs from upstream sklearn GPR optimization."],
    failureModes: [{ code: "invalid_input", message: "ANM requires paired finite vectors of equal length with at least 8 samples and variation in both vectors.", recoveryHint: "Call anm(x, y, options?) with aligned numeric vectors; inspect any injected regressor for finite fitted values of matching length.", alternatives: [] }]
  },
  calm: {
    summary: "Planned CALM discovery placeholder; no executable backend is implemented.",
    preconditions: [], assumptions: [],
    notRecommendedWhen: ["Any executable discovery task is required; CALM has no current implementation."],
    alternatives: ["ges", "grasp", "pc"], costProfile: "Unknown: no implementation is available.",
    limitations: ["Unavailable in both Node and browser runtimes."],
    failureModes: [{ code: "not_implemented", message: "CALM is only a catalog placeholder.", recoveryHint: "Select an implemented discovery algorithm.", alternatives: ["ges", "grasp", "pc"] }]
  }
};

const metadata: Record<string, AgentMethodMetadata> = Object.fromEntries(
  Object.entries(details).map(([id, entry]) => [id, {
    schemaVersion: 1, id, kind: "discovery", apiStatus: id === "calm" ? "planned" : "experimental",
    ...entry,
    inputSchema: schemas[id]!,
    failureModes: id === "calm" ? entry.failureModes! : [...(id === "anm" ? [] : [inputFailure]), statisticalFailure, ...(entry.failureModes ?? [])]
  }])
);

/** A detached agent card for a discovery method, including direct-only ANM and planned CALM. */
export function getDiscoveryMethodMetadata(id: string): AgentMethodMetadata | undefined {
  const entry = Object.hasOwn(metadata, id) ? metadata[id] : undefined;
  return entry ? JSON.parse(JSON.stringify(entry)) as AgentMethodMetadata : undefined;
}

/** Introspection of JavaScript inputs, not a JSON-to-JavaScript adapter or a runtime validator. */
export function algorithmInputSchema(id: string): Schema | undefined {
  return getDiscoveryMethodMetadata(id)?.inputSchema;
}
