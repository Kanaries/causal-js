import type { AgentDiagnostic, AgentJsonValue, AgentResult } from "@causal-js/core";
import type { PythonTransportOptions } from "./transport";

/** Explicitly curated configurations, available only in the Node entry point. */
export type EstimationMethod = "dml-plr" | "cs-did" | "iv-2sls" | "rd-sharp";

/** Complete-case numeric data; column names are labels, never Python expressions. */
export interface EstimationData {
  columns: readonly string[];
  rows: readonly (readonly number[])[];
}

interface EstimationInputBase {
  data: EstimationData;
  outcome: string;
}

export interface DmlPlrInput extends EstimationInputBase {
  method: "dml-plr";
  treatment: string;
  covariates: readonly string[];
  /** Linear nuisance learners, one repetition, DML2 partialling-out score. */
  folds?: number;
  seed?: number;
  /** Optional zero-based test-fold assignment, in exactly the supplied row order. */
  foldIds?: readonly number[];
}

export interface CsDidInput extends EstimationInputBase {
  method: "cs-did";
  unit: string;
  time: string;
  /** First treatment period, constant per unit; 0 denotes never treated. */
  group: string;
}

export interface Iv2slsInput extends EstimationInputBase {
  method: "iv-2sls";
  treatment: string;
  instruments: readonly string[];
  covariates?: readonly string[];
}

export interface SharpRdInput extends EstimationInputBase {
  method: "rd-sharp";
  running: string;
  cutoff?: number;
  /** Fixed, positive, symmetric local-linear bandwidth. */
  bandwidth: number;
  /** Fixed, positive, symmetric quadratic bias bandwidth; defaults to bandwidth. */
  biasBandwidth?: number;
}

export type EstimateEffectInput = DmlPlrInput | CsDidInput | Iv2slsInput | SharpRdInput;
/** Resolved estimator specification; fold vectors are represented by their hash in details. */
export type EstimationDesign = {
  [Method in EstimationMethod]: Omit<Extract<EstimateEffectInput, { method: Method }>, "data" | "foldIds">
}[EstimationMethod];
export type StatsPaiAdapterOptions = PythonTransportOptions;
export interface EstimationExecutionOptions { signal?: AbortSignal }

export interface StatsPaiBackendInfo {
  name: "statspai";
  version: string;
  pythonVersion: string;
  dependencies: Record<string, string>;
}

export interface EstimationConfidenceInterval {
  lower: number;
  upper: number;
  level: 0.95;
}

export interface EstimateEffectResult {
  task: "estimateEffect";
  method: EstimationMethod;
  design: EstimationDesign;
  estimand: string;
  estimate: number;
  standardError: number;
  confidenceInterval: EstimationConfidenceInterval;
  pValue: number | null;
  sampleSize: number;
  backend: StatsPaiBackendInfo;
  /** Method-specific information; no estimator object or executable code crosses the bridge. */
  details: Record<string, AgentJsonValue>;
  dataProvenance: { rowCount: number; columnCount: number; sha256: string };
  assumptions: string[];
  limitations: string[];
  agent: AgentResult;
}

/** Internal wire shape; checked at runtime before it reaches the public result. */
export interface StatsPaiWireResult {
  estimand: string;
  estimate: number;
  standardError: number;
  confidenceInterval: EstimationConfidenceInterval;
  pValue: number | null;
  sampleSize: number;
  details: Record<string, AgentJsonValue>;
  diagnostics: AgentDiagnostic[];
}
