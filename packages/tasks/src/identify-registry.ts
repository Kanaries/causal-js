import { GRAPH_KIND } from "@causal-js/core";
import type { GraphKind } from "@causal-js/core";

import { runDagBackdoorOnlyIdentificationBackend, runDagFirstIdentificationBackend } from "./identify-backend";
import type {
  IdentificationBackendContext,
  IdentificationBackendDescriptor,
  IdentificationBackendId,
  IdentificationBackendPreference,
  IdentificationBackendRun
} from "./types";

interface IdentificationBackendRegistryEntry {
  descriptor: IdentificationBackendDescriptor;
  runner: (
    context: IdentificationBackendContext
  ) => Omit<IdentificationBackendRun, "backend">;
}

const IDENTIFICATION_BACKEND_REGISTRY: Record<IdentificationBackendId, IdentificationBackendRegistryEntry> = {
  "dag-first-mvp": {
    descriptor: {
      id: "dag-first-mvp",
      label: "DAG-First MVP",
      status: "available",
      graphKinds: [GRAPH_KIND.dag],
      supportedMethods: ["zero-effect", "backdoor", "frontdoor"],
      queryShape: "singleton-treatment-singleton-outcome",
      defaultForAuto: true,
      summary: "Searches DAG-first zero-effect, backdoor, and core frontdoor witnesses.",
      limitations: [
        "Only DAG graphs are supported in this step.",
        "Only singleton treatment and singleton outcome queries are supported.",
        "General ID, ADMG, PAG, and counterfactual identification are out of scope."
      ]
    },
    runner: runDagFirstIdentificationBackend
  },
  "dag-backdoor-only": {
    descriptor: {
      id: "dag-backdoor-only",
      label: "DAG Backdoor Only",
      status: "available",
      graphKinds: [GRAPH_KIND.dag],
      supportedMethods: ["zero-effect", "backdoor"],
      queryShape: "singleton-treatment-singleton-outcome",
      defaultForAuto: false,
      summary: "Searches DAG zero-effect and backdoor witnesses but intentionally skips frontdoor.",
      limitations: [
        "Only DAG graphs are supported in this step.",
        "Only singleton treatment and singleton outcome queries are supported.",
        "Core frontdoor search is intentionally disabled in this backend.",
        "General ID, ADMG, PAG, and counterfactual identification are out of scope."
      ]
    },
    runner: runDagBackdoorOnlyIdentificationBackend
  }
};

export const IDENTIFICATION_BACKENDS = Object.freeze(
  Object.keys(IDENTIFICATION_BACKEND_REGISTRY) as IdentificationBackendId[]
);

export function listIdentificationBackends(): IdentificationBackendId[] {
  return [...IDENTIFICATION_BACKENDS];
}

export function supportsIdentificationBackendGraphKind(
  backend: IdentificationBackendId,
  graphKind: GraphKind
): boolean {
  return IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor.graphKinds.includes(graphKind);
}

export function listIdentificationBackendsForGraphKind(graphKind: GraphKind): IdentificationBackendId[] {
  return IDENTIFICATION_BACKENDS.filter((backend) => supportsIdentificationBackendGraphKind(backend, graphKind));
}

export function getIdentificationBackendDescriptor(
  backend: IdentificationBackendId
): IdentificationBackendDescriptor {
  return {
    ...IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor,
    graphKinds: [...IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor.graphKinds],
    supportedMethods: [...IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor.supportedMethods],
    limitations: [...IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor.limitations]
  };
}

export function listIdentificationBackendDescriptors(): IdentificationBackendDescriptor[] {
  return IDENTIFICATION_BACKENDS.map((backend) => getIdentificationBackendDescriptor(backend));
}

export function resolveIdentificationBackend(
  preference: IdentificationBackendPreference = "auto",
  context?: Pick<IdentificationBackendContext, "graph">
): IdentificationBackendId {
  if (preference === "auto") {
    const graphKind = context?.graph.kind ?? GRAPH_KIND.dag;
    const defaultBackend = IDENTIFICATION_BACKENDS.find((backend) => {
      const descriptor = IDENTIFICATION_BACKEND_REGISTRY[backend].descriptor;
      return descriptor.defaultForAuto && supportsIdentificationBackendGraphKind(backend, graphKind);
    });
    if (defaultBackend !== undefined) {
      return defaultBackend;
    }
    throw new Error(`No identification backend is registered for graph kind "${graphKind}".`);
  }

  const explicitGraphKind = context?.graph.kind ?? GRAPH_KIND.dag;
  if (context !== undefined && !supportsIdentificationBackendGraphKind(preference, explicitGraphKind)) {
    throw new Error(
      `Identification backend "${preference}" does not support graph kind "${explicitGraphKind}".`
    );
  }
  return preference;
}

export function runIdentificationBackend(
  context: IdentificationBackendContext,
  preference: IdentificationBackendPreference = "auto"
): IdentificationBackendRun {
  const backend = resolveIdentificationBackend(preference, context);
  const runner = IDENTIFICATION_BACKEND_REGISTRY[backend].runner;
  const run = runner(context);

  return {
    backend,
    evaluation: run.evaluation,
    diagnostics: run.diagnostics
  };
}
