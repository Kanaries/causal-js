import type { AgentMethodMetadata, AlgorithmAvailability } from "@causal-js/core";

import { getDiscoveryMethodMetadata } from "./agent-metadata";

export interface AlgorithmDescriptor {
  id: string;
  summary: string;
  availability: AlgorithmAvailability[];
  agent: AgentMethodMetadata;
}

const descriptors: Omit<AlgorithmDescriptor, "agent" | "summary">[] = [
  {
    id: "pc",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "mvpc",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "fci",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "ges",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "cdnod",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "exact-search",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "grasp",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "gin",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "cam-uv",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "rcd",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "calm",
    availability: [
      { runtime: "node", supported: false },
      { runtime: "browser", supported: false }
    ]
  }
];

function describe(entry: Omit<AlgorithmDescriptor, "agent" | "summary">): AlgorithmDescriptor {
  const agent = getDiscoveryMethodMetadata(entry.id)!;
  return {
    ...entry,
    summary: agent.summary,
    availability: entry.availability.map((availability) => ({
      ...availability,
      ...(availability.capabilities ? { capabilities: [...availability.capabilities] } : {})
    })),
    agent
  };
}

/** Compatibility catalog. Mutating it does not change introspection results. */
export const algorithmCatalog: AlgorithmDescriptor[] = descriptors.map(describe);

/** Returns a detached descriptor, or undefined for an unknown/non-task algorithm. */
export function getAlgorithmDescriptor(id: string): AlgorithmDescriptor | undefined {
  const entry = descriptors.find((candidate) => candidate.id === id);
  return entry ? describe(entry) : undefined;
}

export const describeAlgorithm = getAlgorithmDescriptor;
