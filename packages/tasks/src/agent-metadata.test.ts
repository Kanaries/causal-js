import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { algorithmInputSchema } from "@causal-js/discovery";

import { describeTask, listTaskMetadata, taskInputSchema, TASK_IDS } from "./agent-metadata";
import { getIdentificationBackendDescriptor, listIdentificationBackendDescriptors } from "./identify-registry";

function interfaceProperties(name: string, required: boolean): string[] {
  const source = ts.createSourceFile("types.ts", readFileSync(new URL("./types.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  if (!declaration) throw new Error(`Missing interface ${name}`);
  return declaration.members.filter((member) => ts.isPropertySignature(member) && (!required || !member.questionToken))
    .map((member) => member.name!.getText(source)).sort();
}

describe("task agent metadata", () => {
  it("keeps task input schemas aligned with public option interfaces", () => {
    const interfaces = {
      findAdjustmentSets: "FindAdjustmentSetsOptions", isAdjustmentSet: "IsAdjustmentSetOptions",
      identifyEffect: "IdentifyEffectOptions", falsifyGraph: "FalsifyGraphOptions", stabilityAnalysis: "StabilityAnalysisOptions"
    } as const;
    for (const [task, name] of Object.entries(interfaces)) {
      const schema = taskInputSchema(task as keyof typeof interfaces);
      expect(Object.keys(schema.properties as object).sort()).toEqual(interfaceProperties(name, false));
      expect([...(schema.required as string[])].sort()).toEqual(interfaceProperties(name, true));
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("uses the algorithm option schemas in the discovery task discriminator", () => {
    const variants = taskInputSchema("discoverGraph").oneOf as Array<{ properties: { algorithm: { const: string }; options: object } }>;
    expect(variants).toHaveLength(10);
    for (const variant of variants) {
      expect(variant.properties.options).toEqual(algorithmInputSchema(variant.properties.algorithm.const));
    }
    expect(variants.some((variant) => variant.properties.algorithm.const === "calm")).toBe(false);
  });

  it("keeps guidance serializable, detached and distinct from verification", () => {
    const metadata = listTaskMetadata();
    expect(metadata.map((entry) => entry.id)).toEqual(TASK_IDS);
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
    for (const entry of metadata) {
      expect(entry.assumptions.length).toBeGreaterThan(0);
      expect(entry.preconditions.length).toBeGreaterThan(0);
      expect(entry.costProfile.length).toBeGreaterThan(0);
      expect(entry.limitations.length).toBeGreaterThan(0);
      expect(entry).not.toHaveProperty("validation");
    }
    const changed = describeTask("identifyEffect");
    changed.assumptions.length = 0;
    (changed.inputSchema.required as string[]).length = 0;
    changed.failureModes[0]!.alternatives.push("changed");
    expect(describeTask("identifyEffect").assumptions.length).toBeGreaterThan(0);
    expect(describeTask("identifyEffect").inputSchema.required).toHaveLength(3);
    expect(describeTask("identifyEffect").failureModes[0]!.alternatives).not.toContain("changed");
  });

  it("exposes detached backend guidance with the actual default search limit", () => {
    for (const descriptor of listIdentificationBackendDescriptors()) {
      expect(descriptor.agent.id).toBe(descriptor.id);
      const properties = descriptor.agent.inputSchema.properties as Record<string, { default?: number }>;
      expect(properties.maxAdjustmentSets!.default).toBe(descriptor.id === "id" ? undefined : 8);
      descriptor.agent.limitations.length = 0;
      expect(getIdentificationBackendDescriptor(descriptor.id).agent.limitations.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown task IDs instead of returning prototype properties", () => {
    for (const name of ["unknown", "__proto__", "constructor"]) {
      expect(() => describeTask(name as "identifyEffect")).toThrow("Unknown task");
    }
  });
});
