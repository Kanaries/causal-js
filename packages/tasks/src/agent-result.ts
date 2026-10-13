import {
  ChiSquareTest,
  FisherZTest,
  GSquareTest,
  NODE_TYPE,
  type AgentDiagnostic,
  type AgentResult,
  type ConditionalIndependenceTest,
  type GraphShape,
  type ValidationConfiguration
} from "@causal-js/core";

import { getTaskValidationScope } from "./validation-evidence";
import type { DiscoverGraphInput, DiscoveryGraphPreference, TaskResultBase } from "./types";

/** Configuration records intentionally omit raw data and executable objects. */
export function graphConfiguration(graph: GraphShape): ValidationConfiguration {
  return {
    graphKind: graph.kind ?? "generic",
    nodeVisibility: graph.nodes.some((node) => node.nodeType === NODE_TYPE.selection || node.nodeType === NODE_TYPE.error)
      ? "has-selection-or-error"
      : graph.nodes.some((node) => node.nodeType === NODE_TYPE.latent)
        ? "has-latent"
        : "all-measured"
  };
}

export function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function assertCountLimit(value: number | undefined, label: string, allowUnlimited = false): void {
  if (value === undefined || (allowUnlimited && value === Number.POSITIVE_INFINITY)) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite integer${allowUnlimited ? " or positive Infinity" : ""}.`);
  }
}

/** An arbitrary object's name is not evidence of its implementation. */
export function ciImplementation(test: ConditionalIndependenceTest | undefined): string {
  if (!test) return "none";
  const constructor: unknown = test.constructor;
  const method = test.test;
  if (constructor === FisherZTest && method === FisherZTest.prototype.test) return "fisher-z";
  if (constructor === ChiSquareTest && method === ChiSquareTest.prototype.test) return "chi-square";
  if (constructor === GSquareTest && method === GSquareTest.prototype.test) return "g-square";
  return "custom";
}

export function defaultDiscoveryGraphField(input: DiscoverGraphInput): DiscoveryGraphPreference {
  return input.graphPreference ?? (["ges", "exact-search", "grasp"].includes(input.algorithm) ? "cpdag" : "graph");
}

export function discoverySeed(input: DiscoverGraphInput): number | null {
  if (input.algorithm === "mvpc") return finiteNumberOrNull(input.options.randomSeed ?? 1);
  if (input.algorithm === "grasp") return finiteNumberOrNull(input.options.randomSeed);
  return null;
}

export function discoveryConfiguration(
  input: DiscoverGraphInput,
  selectedGraphField: string
): ValidationConfiguration {
  const options = input.options as unknown as Record<string, unknown>;
  const config: ValidationConfiguration = {
    algorithm: input.algorithm,
    backend: "typescript",
    graphPreference: defaultDiscoveryGraphField(input),
    selectedGraphField,
    dataRows: input.options.data.rows,
    dataColumns: input.options.data.columns,
    customImplementation: false,
    seed: discoverySeed(input),
    "options.nodeLabels": JSON.stringify(input.options.nodeLabels ?? Array.from({ length: input.options.data.columns }, (_, index) => `X${index + 1}`))
  };
  const defaults: Record<string, Record<string, string | number | boolean | null>> = {
    pc: { alpha: 0.05, stable: true, ucRule: 0, ucPriority: 2, backgroundKnowledge: "none" },
    mvpc: { alpha: 0.05, stable: true, ucRule: 0, ucPriority: 2, correction: "mvcrtn-fisher-z", randomSeed: 1, backgroundKnowledge: "none" },
    fci: { alpha: 0.05, stable: true, depth: -1, maxPathLength: -1, backgroundKnowledge: "none" },
    ges: { maxParents: input.options.data.columns / 2 },
    cdnod: { alpha: 0.05, stable: true, ucRule: 0, ucPriority: 2, contextLabel: "C", backgroundKnowledge: "none" },
    "exact-search": { maxParents: input.options.data.columns, searchMethod: "astar", usePathExtension: true, useKCycleHeuristic: false, kCycleK: 3, superGraph: "complete", includeGraph: "empty" },
    grasp: { depth: 3, randomSeed: null, verbose: false },
    gin: { alpha: 0.05, indepTestMethod: "kci", latentLabelPrefix: "L" },
    "cam-uv": { alpha: 0.01, maxExplanatoryVars: 3, bwMethod: "mdbs", smoother: "spline", splineKnots: 6, gamMaxIterations: 25, gamTolerance: 1e-5, polynomialDegree: 3, ridgePenalty: 1e-6, nSplines: 20, psplineLambda: 0.6 },
    rcd: { maxExplanatoryNum: 2, corAlpha: 0.01, indAlpha: 0.01, shapiroAlpha: 0.01, mlhsicr: false, bwMethod: "mdbs", ridgePenalty: 0 }
  };
  for (const [key, value] of Object.entries(defaults[input.algorithm]!)) {
    config[`options.${key}`] = value;
  }
  // Implementations read declared properties directly, including inherited
  // and non-enumerable values. Provenance must observe the same options.
  const optionKeys = new Set([
    ...Object.keys(options),
    ...Object.keys(defaults[input.algorithm]!),
    "ciTest", "score", "nodeLabels", "backgroundKnowledge", "context", "contextLabel",
    "createCiTest", "superGraph", "includeGraph"
  ]);
  for (const key of optionKeys) {
    const value = options[key];
    if (key === "data" || value === undefined) continue;
    if (value === null && key !== "ucPriority" && key in defaults[input.algorithm]!) continue;
    if (typeof value === "string" || typeof value === "boolean" || value === null) {
      config[`options.${key}`] = value;
    } else if (typeof value === "number") {
      config[`options.${key}`] = finiteNumberOrNull(value);
      if (!Number.isFinite(value)) config.customImplementation = true;
    } else if (key === "ciTest") {
      const implementation = ciImplementation(value as ConditionalIndependenceTest);
      config["options.ciTest"] = implementation;
      if (implementation === "custom") config.customImplementation = true;
    } else if (key === "nodeLabels" && Array.isArray(value) && value.every((label) => typeof label === "string")) {
      config["options.nodeLabels"] = JSON.stringify(value);
    } else {
      // Opaque callbacks, scores, context matrices and background-knowledge
      // instances cannot be certified by a name or an object serialization.
      config[`options.${key}`] = "opaque";
      config.customImplementation = true;
    }
  }
  if (config["options.ucPriority"] === -1) {
    config["options.ucPriority"] = config["options.ucRule"] === 2 ? 4 : 3;
  }
  return config;
}

export function assumptionsNotChecked(): AgentDiagnostic {
  return {
    code: "causal_assumptions_not_checked",
    status: "not_run",
    severity: "warning",
    message: "Execution does not establish that the method's causal assumptions hold; review the stated assumptions against domain knowledge."
  };
}

export function createTaskAgent(
  method: TaskResultBase["task"],
  configuration: ValidationConfiguration,
  outputs: readonly string[],
  options: {
    backend: string;
    seed?: number | null;
    diagnostics: AgentDiagnostic[];
    degradations?: AgentResult["degradations"];
    nextActions?: AgentResult["nextActions"];
  }
): AgentResult {
  return {
    schemaVersion: 1,
    method,
    diagnostics: structuredClone([...options.diagnostics, assumptionsNotChecked()]),
    degradations: structuredClone(options.degradations ?? []),
    nextActions: structuredClone(options.nextActions ?? []),
    validation: getTaskValidationScope(method, configuration, outputs),
    provenance: {
      configuration: { ...configuration },
      backend: options.backend,
      seed: finiteNumberOrNull(options.seed)
    }
  };
}
