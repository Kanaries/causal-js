import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { algorithmInputSchema, getDiscoveryMethodMetadata } from "./agent-metadata";
import { algorithmCatalog, describeAlgorithm, getAlgorithmDescriptor } from "./catalog";

function interfaceKeys(file: string, name: string, requiredOnly = false): string[] {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  if (!declaration) throw new Error(`Missing interface ${name} in ${file}`);
  return declaration.members
    .filter((member) => !requiredOnly || (ts.isPropertySignature(member) && !member.questionToken))
    .map((member) => member.name!.getText(source)).sort();
}

function properties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return schema.properties as Record<string, Record<string, unknown>>;
}

describe("discovery agent metadata", () => {
  it("covers every public option of the existing discovery APIs", () => {
    const interfaces: Record<string, string> = {
      pc: "PcOptions", mvpc: "MvpcOptions", fci: "FciOptions", ges: "GesOptions",
      cdnod: "CdnodOptions", "exact-search": "ExactSearchOptions", grasp: "GraspOptions",
      gin: "GinOptions", "cam-uv": "CamuvOptions", rcd: "RcdOptions"
    };
    for (const [id, name] of Object.entries(interfaces)) {
      const schema = algorithmInputSchema(id)!;
      expect(Object.keys(properties(schema)).sort(), id).toEqual(interfaceKeys("./contracts.ts", name));
      expect(schema.additionalProperties, id).toBe(false);
      expect([...(schema.required as string[])].sort(), `${id} required options`).toEqual(interfaceKeys("./contracts.ts", name, true));
    }
    const anmOptions = properties(algorithmInputSchema("anm")!).options!;
    expect(Object.keys(properties(anmOptions)).sort()).toEqual(interfaceKeys("./anm.ts", "AnmOptions"));
    const kciOptions = properties(anmOptions).kci!;
    expect(Object.keys(properties(kciOptions)).sort()).toEqual(interfaceKeys("../../core/src/kernel-independence.ts", "KciUnconditionalTestOptions"));
  });

  it("describes required collaborators as JavaScript runtime values", () => {
    const schema = algorithmInputSchema("pc")!;
    expect(schema.required).toEqual(["data", "ciTest"]);
    expect(schema["x-json-serializable"]).toBe(false);
    expect(properties(schema).data).toMatchObject({ "x-js-type": "NumericMatrix", "x-json-serializable": false });
    expect(properties(schema).ciTest).toMatchObject({ "x-js-type": "ConditionalIndependenceTest", "x-json-serializable": false });
    expect(properties(algorithmInputSchema("cdnod")!).createCiTest).toMatchObject({ "x-js-type": "function" });
    expect(properties(algorithmInputSchema("ges")!).score).toMatchObject({ "x-js-type": "LocalScoreFunction" });
    expect(properties(schema).backgroundKnowledge?.description).toContain("BackgroundKnowledge.fromShape");
  });

  it("distinguishes direct positional ANM from discoverGraph algorithms", () => {
    const schema = algorithmInputSchema("anm")!;
    expect(schema["x-js-call-style"]).toBe("positional");
    expect(schema["x-js-arguments"]).toEqual(["x", "y", "options"]);
    expect(getDiscoveryMethodMetadata("anm")?.limitations).toContain("Direct positional API only; anm is not a discoverGraph algorithm.");
    expect(getAlgorithmDescriptor("anm")).toBeUndefined();
    expect(getDiscoveryMethodMetadata("anm")?.failureModes.find((failure) => failure.code === "invalid_input")?.recoveryHint).toContain("anm(x, y, options?)");
  });

  it("keeps defaults and option-dependent limits explicit", () => {
    expect(properties(algorithmInputSchema("pc")!).ucPriority?.default).toBe(2);
    expect(properties(algorithmInputSchema("pc")!).ucPriority?.description).toContain("ucRule=2");
    expect(properties(algorithmInputSchema("fci")!).depth?.description).toContain("does not cap the Possible-D-SEP");
    expect(properties(algorithmInputSchema("ges")!).maxParents?.description).toContain("data.columns / 2");
    expect(properties(algorithmInputSchema("gin")!).indepTestMethod?.default).toBe("kci");
    expect(properties(algorithmInputSchema("cam-uv")!).smoother?.default).toBe("spline");
    expect(properties(algorithmInputSchema("mvpc")!).data?.description).toContain("NaN");
  });

  it("returns detached, JSON-safe metadata and handles unknown/prototype keys", () => {
    const card = getDiscoveryMethodMetadata("pc")!;
    expect(JSON.parse(JSON.stringify(card))).toEqual(card);
    card.assumptions.length = 0;
    card.failureModes[0]!.alternatives.push("corrupted");
    properties(card.inputSchema).ciTest!["x-js-type"] = "corrupted";
    const fresh = getDiscoveryMethodMetadata("pc")!;
    expect(fresh.assumptions.length).toBeGreaterThan(0);
    expect(fresh.failureModes[0]?.alternatives).not.toContain("corrupted");
    expect(properties(fresh.inputSchema).ciTest?.["x-js-type"]).toBe("ConditionalIndependenceTest");
    for (const id of ["unknown", "toString", "__proto__", "constructor"]) {
      expect(getDiscoveryMethodMetadata(id)).toBeUndefined();
      expect(algorithmInputSchema(id)).toBeUndefined();
      expect(getAlgorithmDescriptor(id)).toBeUndefined();
    }
  });

  it("keeps catalog introspection isolated from mutations of returned or legacy catalog objects", () => {
    const descriptor = describeAlgorithm("pc")!;
    descriptor.availability[0]!.supported = false;
    descriptor.availability[0]!.capabilities!.length = 0;
    descriptor.agent.assumptions.length = 0;
    const legacy = algorithmCatalog.find((entry) => entry.id === "pc")!;
    const original = legacy.agent;
    try {
      legacy.agent = descriptor.agent;
      const fresh = getAlgorithmDescriptor("pc")!;
      expect(fresh.availability[0]?.supported).toBe(true);
      expect(fresh.availability[0]?.capabilities).toContain("cpu");
      expect(fresh.agent.assumptions.length).toBeGreaterThan(0);
    } finally {
      legacy.agent = original;
    }
  });

  it("gives every catalog method actionable guidance without claiming assumptions were checked", () => {
    for (const entry of algorithmCatalog) {
      expect(entry.agent).toMatchObject({ schemaVersion: 1, id: entry.id, kind: "discovery", summary: entry.summary });
      expect(entry.agent).toEqual(getDiscoveryMethodMetadata(entry.id));
      expect(entry.agent.costProfile.length).toBeGreaterThan(0);
      expect(entry.agent.limitations.length).toBeGreaterThan(0);
      expect(entry.agent.failureModes.every((failure) => failure.code && failure.recoveryHint)).toBe(true);
      expect(entry.agent).not.toHaveProperty("validationStatus");
      for (const alternative of entry.agent.alternatives) {
        expect(getDiscoveryMethodMetadata(alternative), alternative).toBeDefined();
      }
      if (entry.id !== "calm") {
        expect(entry.agent.preconditions.length).toBeGreaterThan(0);
        expect(entry.agent.assumptions.length).toBeGreaterThan(0);
        expect(entry.agent.apiStatus).not.toBe("planned");
      }
    }
  });

  it("marks CALM unavailable and exposes no accepted execution input", () => {
    const descriptor = getAlgorithmDescriptor("calm")!;
    expect(descriptor.agent.apiStatus).toBe("planned");
    expect(descriptor.availability.every((entry) => !entry.supported)).toBe(true);
    expect(descriptor.agent.inputSchema.not).toEqual({});
    expect(descriptor.agent.failureModes[0]?.code).toBe("not_implemented");
  });
});
