import type { ValidationConfiguration, ValidationScope } from "./validation";

/** Values that can be transported to an agent without a custom serializer. */
export type AgentJsonValue =
  | string
  | number
  | boolean
  | null
  | AgentJsonValue[]
  | { [key: string]: AgentJsonValue };

/** Machine-readable method guidance. Assumptions are not assertions that they hold. */
export interface AgentMethodMetadata {
  schemaVersion: 1;
  id: string;
  kind: "discovery" | "task" | "identification-backend";
  apiStatus: "stable" | "experimental" | "planned";
  summary: string;
  inputSchema: Record<string, AgentJsonValue>;
  assumptions: string[];
  preconditions: string[];
  notRecommendedWhen: string[];
  failureModes: {
    code: string;
    message: string;
    recoveryHint: string;
    alternatives: string[];
  }[];
  alternatives: string[];
  costProfile: string;
  limitations: string[];
}

export type AgentDiagnosticStatus =
  | "passed"
  | "failed"
  | "inconclusive"
  | "not_run"
  | "not_applicable";

export interface AgentDiagnostic {
  code: string;
  status: AgentDiagnosticStatus;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, AgentJsonValue>;
}

export interface AgentDegradation {
  code: string;
  section: string;
  message: string;
}

export interface AgentNextAction {
  id: string;
  priority: "high" | "medium" | "low";
  action: string;
  reason: string;
  suggestedTask?: string;
}

export interface AgentResult {
  schemaVersion: 1;
  method: string;
  diagnostics: AgentDiagnostic[];
  degradations: AgentDegradation[];
  nextActions: AgentNextAction[];
  validation: ValidationScope;
  provenance: {
    configuration: ValidationConfiguration;
    backend: string;
    seed: number | null;
  };
}

export interface AgentDiagnosticSummary {
  counts: Record<AgentDiagnosticStatus, number>;
  applicableCount: number;
  /** True only when at least one check applies and every applicable check passed. */
  allPassed: boolean;
}

/** Unknown, skipped, and absent checks must never imply that assumptions passed. */
export function getDiagnosticSummary(
  diagnostics: readonly AgentDiagnostic[]
): AgentDiagnosticSummary {
  const counts: Record<AgentDiagnosticStatus, number> = {
    passed: 0,
    failed: 0,
    inconclusive: 0,
    not_run: 0,
    not_applicable: 0
  };
  for (const diagnostic of diagnostics) counts[diagnostic.status] += 1;
  const applicableCount = diagnostics.length - counts.not_applicable;
  return {
    counts,
    applicableCount,
    allPassed: applicableCount > 0 && counts.passed === applicableCount
  };
}
