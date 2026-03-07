import type { AlgorithmAvailability } from "@causal-js/core";

export interface AlgorithmDescriptor {
  id: string;
  summary: string;
  availability: AlgorithmAvailability[];
}

export const algorithmCatalog: AlgorithmDescriptor[] = [
  {
    id: "pc",
    summary: "Constraint-based discovery planned as the first portable algorithm.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "ges",
    summary: "Score-based search planned after the shared scoring interface lands.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "cdnod",
    summary: "Nonstationary discovery built on the portable PC substrate plus an augmented context index.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "calm",
    summary: "Expected to be Node-first because of heavier numerical dependencies.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: false }
    ]
  }
];
