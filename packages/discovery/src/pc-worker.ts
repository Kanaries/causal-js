import {
  BackgroundKnowledge,
  ChiSquareTest,
  DenseMatrix,
  FisherZTest,
  GSquareTest,
  type BackgroundKnowledgeShape,
  type ConditionalIndependenceTest
} from "@causal-js/core";

import type { PcOptions, PcResult, PcUcPriority, PcUcRule } from "./contracts";
import { pc } from "./pc";

export type PcWorkerCiTestKind = "fisher-z" | "chi-square" | "g-square";

export interface PcWorkerCiTestSpec {
  kind: PcWorkerCiTestKind;
}

export interface SerializablePcTaskOptions {
  data: readonly (readonly number[])[];
  ciTest: PcWorkerCiTestSpec;
  alpha?: number;
  stable?: boolean;
  ucRule?: PcUcRule;
  ucPriority?: PcUcPriority;
  nodeLabels?: readonly string[];
  backgroundKnowledge?: BackgroundKnowledgeShape;
}

function createCiTest(spec: PcWorkerCiTestSpec, data: DenseMatrix): ConditionalIndependenceTest {
  switch (spec.kind) {
    case "fisher-z":
      return new FisherZTest(data);
    case "chi-square":
      return new ChiSquareTest(data);
    case "g-square":
      return new GSquareTest(data);
    default:
      throw new Error(`Unsupported PC worker CI test kind: ${String((spec as { kind: string }).kind)}`);
  }
}

export function executeSerializablePcTask(options: SerializablePcTaskOptions): PcResult {
  const data = new DenseMatrix(options.data);
  const pcOptions: PcOptions = {
    data,
    ciTest: createCiTest(options.ciTest, data),
    ...(options.alpha !== undefined ? { alpha: options.alpha } : {}),
    ...(options.stable !== undefined ? { stable: options.stable } : {}),
    ...(options.ucRule !== undefined ? { ucRule: options.ucRule } : {}),
    ...(options.ucPriority !== undefined ? { ucPriority: options.ucPriority } : {}),
    ...(options.nodeLabels ? { nodeLabels: options.nodeLabels } : {}),
    ...(options.backgroundKnowledge
      ? { backgroundKnowledge: BackgroundKnowledge.fromShape(options.backgroundKnowledge) }
      : {})
  };

  return pc(pcOptions);
}
