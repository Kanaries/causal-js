import { describe, expect, it } from "vitest";

import { runStep3TaskWorkflowExample } from "../examples/step3-task-workflow";

describe("step3 task workflow example", () => {
  it("stays aligned with the public DAG-first workflow", () => {
    const result = runStep3TaskWorkflowExample();

    expect(result.discovered.task).toBe("discoverGraph");
    expect(result.adjustment.task).toBe("findAdjustmentSets");
    expect(result.identified.task).toBe("identifyEffect");
    expect(result.falsified.task).toBe("falsifyGraph");
    expect(result.stability.task).toBe("stabilityAnalysis");

    expect(result.adjustment.candidateSets).toContainEqual(
      expect.objectContaining({
        variables: ["Z"],
        valid: true,
        minimal: true
      })
    );
    expect(result.identificationBackends).toMatchObject([
      {
        id: "dag-first-mvp",
        defaultForAuto: true
      },
      {
        id: "dag-backdoor-only",
        defaultForAuto: false
      }
    ]);
    expect(result.identified.method).toBe("backdoor");
    expect(result.identified.backend).toBe("dag-first-mvp");
    expect(result.identified.estimandSpec?.strategy).toBe("backdoor");
    expect(result.identified.diagnostics.some((entry) => entry.strategy === "backdoor")).toBe(true);
    expect(result.falsified.graphValidity.dagSupported).toBe(true);
    expect(result.stability.runSummaries).toHaveLength(10);
  });

  it("keeps backend guidance visible through the example surface", () => {
    const result = runStep3TaskWorkflowExample();

    expect(result.identificationBackends.filter((entry) => entry.defaultForAuto)).toEqual([
      expect.objectContaining({
        id: "dag-first-mvp",
        supportedMethods: expect.arrayContaining(["backdoor", "frontdoor", "zero-effect"])
      })
    ]);
    expect(result.identificationBackends).toContainEqual(
      expect.objectContaining({
        id: "dag-backdoor-only",
        supportedMethods: expect.arrayContaining(["backdoor", "zero-effect"])
      })
    );
    expect(
      result.identificationBackends.find((entry) => entry.id === "dag-backdoor-only")?.supportedMethods
    ).not.toContain("frontdoor");
  });
});
