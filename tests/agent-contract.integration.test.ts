import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("published agent contracts", () => {
  for (const entry of ["index", "node/index", "web/index"]) {
    for (const format of ["esm", "cjs"]) {
      it(`exports metadata, diagnostics and evidence through ${entry} (${format})`, async () => {
        const filename = resolve(process.cwd(), "packages/causal/dist", `${entry}.${format === "esm" ? "js" : "cjs"}`);
        const api = format === "esm" ? await import(pathToFileURL(filename).href) : require(filename);
        expect(api.describeAlgorithm("pc").agent.id).toBe("pc");
        expect(api.describeTask("identifyEffect").inputSchema.required).toContain("graph");
        const graph = api.CausalGraph.fromNodeIds(["Z", "X", "Y"], { kind: "dag" });
        graph.addDirectedEdge("Z", "X");
        graph.addDirectedEdge("Z", "Y");
        graph.addDirectedEdge("X", "Y");
        const result = api.identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
        expect(result.method).toBe("backdoor");
        expect(result.agent.validation.status).toBe("covered");
        expect(result.agent.validation.outputs[0].status).toBe("analytical");
        expect(api.getDiagnosticSummary(result.agent.diagnostics).allPassed).toBe(false);
        expect(JSON.parse(JSON.stringify(result.agent))).toEqual(result.agent);
        expect(api.listTaskValidationEvidence().length).toBeGreaterThan(0);
      });
    }
  }
});
