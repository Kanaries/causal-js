import type { AgentJsonValue, AgentMethodMetadata } from "@causal-js/core";
import { getAlgorithmDescriptor } from "@causal-js/discovery";

import type { DiscoveryAlgorithmId, IdentificationBackendId, TaskResultBase } from "./types";

export type TaskId = TaskResultBase["task"];

export const TASK_IDS: readonly TaskId[] = Object.freeze([
  "discoverGraph", "findAdjustmentSets", "isAdjustmentSet", "identifyEffect", "falsifyGraph", "stabilityAnalysis"
]);

type Schema = Record<string, AgentJsonValue>;

const matrix: Schema = {
  type: "object",
  "x-js-type": "NumericMatrix",
  "x-json-serializable": false,
  description: "A NumericMatrix instance, such as DenseMatrix. JSON arrays must be converted by the caller; this schema does not provide a JSON execution adapter."
};
const nodeId: Schema = { type: "string", description: "An existing graph node ID." };
const nodeIds: Schema = { type: "array", items: { type: "string" }, uniqueItems: true };
const endpoint: Schema = { enum: ["arrow", "circle", "none", "star", "tail"] };
const graph: Schema = {
  type: "object",
  description: "A serialized GraphShape. Structural validity and task-specific graph restrictions are checked at runtime.",
  required: ["nodes", "edges"],
  properties: {
    version: { const: 1 },
    kind: { enum: ["dag", "cpdag", "pag", "admg", "generic"] },
    nodes: {
      type: "array",
      items: {
        type: "object", required: ["id"],
        properties: { id: nodeId, nodeType: { enum: ["measured", "latent", "selection", "error"] } },
        additionalProperties: true
      }
    },
    edges: {
      type: "array",
      items: {
        type: "object", required: ["node1", "node2", "endpoint1", "endpoint2"],
        properties: { node1: nodeId, node2: nodeId, endpoint1: endpoint, endpoint2: endpoint, metadata: { type: "object" } },
        additionalProperties: false
      }
    },
    metadata: { type: "object" }
  },
  additionalProperties: true
};
const graphQuery = { graph, treatment: nodeId, outcome: nodeId };
const queryRequired = ["graph", "treatment", "outcome"];
const alpha: Schema = { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1, default: 0.05 };
const graphAssumptions = [
  "The supplied DAG represents the causal model being queried; successful graph computation does not validate that model against reality.",
  "Measured and latent node roles are declared correctly."
];
const graphPreconditions = [
  "Use an acyclic graph with directed edges only.",
  "Treatment and outcome are distinct existing nodes; only singleton queries are supported."
];
const graphFailure = {
  code: "unsupported-graph-query",
  message: "The graph or query is outside the DAG-first task boundary.",
  recoveryHint: "Review graph kinds and node IDs. Resolve a discovery equivalence class with explicit assumptions before using a DAG-only task.",
  alternatives: ["falsifyGraph"]
};

function objectSchema(properties: Record<string, AgentJsonValue>, required: string[]): Schema {
  return { type: "object", properties, required, additionalProperties: false };
}

function discoverySchema(): Schema {
  const algorithms: DiscoveryAlgorithmId[] = ["pc", "mvpc", "fci", "ges", "cdnod", "exact-search", "grasp", "gin", "cam-uv", "rcd"];
  return {
    description: "Discriminated JavaScript task input. Runtime CI/score objects and callbacks require caller-side construction.",
    "x-js-call-style": "options-object",
    "x-json-serializable": false,
    oneOf: algorithms.map((algorithm) => objectSchema({
      algorithm: { const: algorithm },
      options: getAlgorithmDescriptor(algorithm)!.agent.inputSchema,
      graphPreference: { enum: ["graph", "cpdag", "dag"], description: "Preferred artifact; unavailable artifacts fall back to an available graph and are reported in result.agent.degradations." }
    }, ["algorithm", "options"]))
  };
}

function base(id: TaskId, summary: string, inputSchema: Schema): AgentMethodMetadata {
  return {
    schemaVersion: 1, id, kind: "task", apiStatus: "stable", summary, inputSchema,
    assumptions: [...graphAssumptions], preconditions: [...graphPreconditions],
    notRecommendedWhen: ["Do not use a structural result as proof of causal assumptions or as a numerical effect estimate."],
    failureModes: [{ ...graphFailure, alternatives: [...graphFailure.alternatives] }],
    alternatives: [], costProfile: "Depends on graph size and topology.", limitations: []
  };
}

function buildTaskMetadata(id: TaskId): AgentMethodMetadata {
  switch (id) {
    case "discoverGraph": {
      const metadata = base(id, "Run causal discovery and return a graph, algorithm assumptions, diagnostics and configuration-scoped evidence.", discoverySchema());
      return {
        ...metadata,
        assumptions: ["The chosen discovery algorithm and CI test or score impose their own statistical assumptions; inspect its algorithm descriptor."],
        preconditions: ["Supply the algorithm's required NumericMatrix, CI test or score and any context variables.", "Node labels must align with data columns."],
        notRecommendedWhen: ["Do not interpret a CPDAG or PAG as a uniquely identified causal DAG."],
        failureModes: [{ code: "discovery-input", message: "Discovery rejected data, options or a CI result.", recoveryHint: "Inspect effective sample sizes, finite data and the selected algorithm's descriptor before retrying.", alternatives: ["mvpc", "fci"] }],
        alternatives: ["stabilityAnalysis", "falsifyGraph"],
        costProfile: "Algorithm-dependent: CI searches can be exponential in graph degree; exact search is exponential in variable count; kernel tests can require quadratic memory in rows.",
        limitations: ["Produces hypotheses and equivalence-class information, not an effect estimate."]
      };
    }
    case "findAdjustmentSets": {
      const metadata = base(id, "Enumerate structural adjustment sets using the DAG proper-backdoor criterion.", objectSchema({
        ...graphQuery,
        maxResults: { type: "integer", minimum: 0, description: "Truncate returned candidates; counts still refer to the searched candidate space. JavaScript also accepts positive Infinity for an unbounded payload." },
        maxSetSize: { type: "integer", minimum: 0, description: "Limit candidate size; smaller limits can make the search incomplete. JavaScript also accepts positive Infinity to search all eligible covariate sizes." }
      }, queryRequired));
      return { ...metadata, alternatives: ["isAdjustmentSet", "identifyEffect"], costProfile: "Exponential in eligible measured covariates. maxResults limits payload size, not enumeration cost.", limitations: ["DAG-only, singleton treatment and outcome.", "Search limits do not prove no larger adjustment set exists.", "Does not check overlap, positivity or estimator quality."] };
    }
    case "isAdjustmentSet": {
      const metadata = base(id, "Check one proposed adjustment set under the DAG proper-backdoor criterion.", objectSchema({ ...graphQuery, adjustmentSet: nodeIds }, [...queryRequired, "adjustmentSet"]));
      return { ...metadata, alternatives: ["findAdjustmentSets"], costProfile: "Graph reachability and separation checks for one candidate; cheaper than enumerating all subsets.", limitations: ["Structural validity only; no statistical diagnostics or effect estimation."] };
    }
    case "identifyEffect": {
      const metadata = base(id, "Find a zero-effect, backdoor or core frontdoor formula within the selected DAG-first backend.", objectSchema({
        ...graphQuery,
        backend: { enum: ["auto", "dag-first-mvp", "dag-backdoor-only"], default: "auto" },
        maxAdjustmentSets: { type: "integer", minimum: 0, default: 8, description: "Maximum returned adjustment candidates passed to the backend. JavaScript also accepts positive Infinity for an unbounded payload." }
      }, queryRequired));
      return { ...metadata, alternatives: ["findAdjustmentSets"], costProfile: "Adjustment and mediator searches may enumerate subsets; exponential in eligible variables.", limitations: ["General ID, ADMG/PAG identification and counterfactual identification are outside this API.", "A negative result means not identified by the selected rules; it is not a global non-identifiability proof.", "The returned formula still requires an estimator and statistical diagnostics."] };
    }
    case "falsifyGraph": {
      const metadata = base(id, "Inspect graph validity and test observable local Markov implications when data are supplied.", objectSchema({
        graph, data: matrix,
        ciTest: { type: "object", "x-js-type": "ConditionalIndependenceTest", "x-json-serializable": false, description: "Optional executable CI test. By default integer-valued data use chi-square, otherwise Fisher-Z; choose explicitly when measurement semantics require it." },
        alpha,
        observedNodeOrder: { ...nodeIds, description: "Data-column order of measured graph nodes." },
        multipleTestingCorrection: { enum: ["none", "benjamini-hochberg"], default: "none" }
      }, ["graph"]));
      return {
        ...metadata,
        assumptions: ["The local Markov property and the chosen CI test's distribution and sampling assumptions apply."],
        preconditions: ["Statistical checks need a DAG and data aligned with measured nodes.", "A supplied CI test must return a finite p-value in [0,1]."],
        notRecommendedWhen: ["Do not interpret non-rejection, missing tests or inconclusive tests as confirmation of the causal graph."],
        failureModes: [{ code: "ci-inconclusive", message: "A CI test could not produce a valid p-value.", recoveryHint: "Inspect result.agent.degradations and effective sample sizes; fix or replace the CI test.", alternatives: [] }],
        alternatives: ["stabilityAnalysis"], costProfile: "Up to quadratic many local implications in measured variables, each paying the chosen CI test's cost.",
        limitations: ["Tests local Markov implications only, not every implied independence or a permutation graph test.", "Implications whose parents are unobserved are skipped.", "Without data or supported graph structure, statistical diagnostics do not run."]
      };
    }
    case "stabilityAnalysis": {
      const metadata = base(id, "Resample rows, repeat discovery and summarize adjacency and orientation frequencies.", objectSchema({
        discovery: discoverySchema(),
        bootstrapSamples: { type: "integer", minimum: 1, default: 20 },
        sampleFraction: { type: "number", exclusiveMinimum: 0, maximum: 1, default: 1 },
        replace: { type: "boolean", default: true }, seed: { type: "integer", default: 12345 },
        consensusThreshold: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        createDiscoveryOptions: { "x-js-type": "function", "x-json-serializable": false, description: "Callback rebuilding algorithm options for each resampled matrix. Never reuse CI tests or scores fitted to the original rows." }
      }, ["discovery"]));
      return { ...metadata,
        assumptions: ["Rows are exchangeable for the selected row-resampling procedure.", "Each discovery run still relies on its algorithm and test assumptions."],
        preconditions: ["Provide a nonempty discovery matrix and valid resampling settings.", "Custom CI tests or scores may require createDiscoveryOptions to rebuild them on each sample."],
        notRecommendedWhen: ["Do not apply independent row bootstrap to dependent panel/time-series data without a suitable resampling design.", "Do not treat bootstrap edge frequency as a posterior probability or a causal truth certificate."],
        failureModes: [{ code: "discovery-rebuild", message: "A test or score could not be rebuilt for resampled data.", recoveryHint: "Supply createDiscoveryOptions that constructs fresh tests and scores on the provided matrix.", alternatives: ["discoverGraph"] }],
        alternatives: ["discoverGraph", "falsifyGraph"], costProfile: "Approximately bootstrapSamples times discovery cost, plus quadratic node-pair summaries.",
        limitations: ["The seed controls row resampling; arbitrary callbacks and custom learners may have separate random state.", "Frequencies and consensus cover original data-column nodes only; extra CD-NOD context or GIN latent nodes are excluded.", "The consensus is a generic graph and need not be a DAG, CPDAG or PAG."]
      };
    }
  }
}

/** Describes the JavaScript API; it does not execute JSON tools or certify assumptions. */
export function describeTask(id: TaskId): AgentMethodMetadata {
  if (!TASK_IDS.includes(id)) throw new Error(`Unknown task: ${id}`);
  return JSON.parse(JSON.stringify(buildTaskMetadata(id))) as AgentMethodMetadata;
}

export function listTaskMetadata(): AgentMethodMetadata[] {
  return TASK_IDS.map(describeTask);
}

export function taskInputSchema(id: TaskId): Schema {
  return describeTask(id).inputSchema;
}

export function getIdentificationBackendMetadata(id: IdentificationBackendId): AgentMethodMetadata {
  if (id !== "dag-first-mvp" && id !== "dag-backdoor-only") throw new Error(`Unknown identification backend: ${id}`);
  const metadata = describeTask("identifyEffect");
  return {
    ...metadata, id, kind: "identification-backend",
    summary: id === "dag-first-mvp" ? "DAG zero-effect, backdoor and core frontdoor identification." : "DAG zero-effect and backdoor identification only.",
    inputSchema: objectSchema({ ...graphQuery, maxAdjustmentSets: { type: "integer", minimum: 0, default: 8, description: "JavaScript also accepts positive Infinity for an unbounded payload." } }, queryRequired),
    notRecommendedWhen: [...metadata.notRecommendedWhen, ...(id === "dag-backdoor-only" ? ["Use dag-first-mvp when a frontdoor strategy should also be searched."] : [])],
    alternatives: id === "dag-backdoor-only" ? ["dag-first-mvp"] : ["dag-backdoor-only"],
    limitations: [...metadata.limitations, ...(id === "dag-backdoor-only" ? ["Frontdoor search is disabled."] : [])]
  };
}
