import type { AlgorithmAvailability } from "@causal-js/core";

export interface AlgorithmDescriptor {
  id: string;
  summary: string;
  availability: AlgorithmAvailability[];
}

export const algorithmCatalog: AlgorithmDescriptor[] = [
  {
    id: "pc",
    summary: "Constraint-based CPDAG discovery: stable skeleton search, all uc-rule/uc-priority collider variants, Meek rules, background knowledge, and Fisher-Z / chi-square / G-square / KCI tests.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "mvpc",
    summary:
      "Missing-value PC: test-wise-deletion skeleton search plus permutation-based missingness correction (MV-Fisher-Z / MC-Fisher-Z).",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "fci",
    summary: "Constraint-based PAG discovery with latent-confounder orientation rules built on endpoint-aware graph semantics.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] },
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]
  },
  {
    id: "ges",
    summary: "Greedy equivalence search over CPDAGs with insert/delete operators and Gaussian BIC or BDeu local scores.",
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
    id: "exact-search",
    summary: "Exact score-based DAG search for small graphs using the shared local score interface.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "grasp",
    summary: "Permutation-based sparse DAG search built on the shared local score interface.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "gin",
    summary: "Hidden-causal cluster discovery for latent-variable models using kernel independence tests. Note: intentionally fixes an upstream causal-learn indexing bug, so outputs follow the GIN paper rather than the Python implementation.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "cam-uv",
    summary: "Nonlinear causal discovery with latent confounder hints using a portable additive-regression approximation.",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
    ]
  },
  {
    id: "rcd",
    summary: "Linear non-Gaussian discovery with latent confounder detection (OLS or approximate MLHSICR residualization plus HSIC independence tests).",
    availability: [
      { runtime: "node", supported: true, capabilities: ["cpu"] },
      { runtime: "browser", supported: true, capabilities: ["cpu"] }
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
