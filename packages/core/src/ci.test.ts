import { describe, expect, it } from "vitest";

import { FisherZTest } from "./ci";
import { DenseMatrix } from "./stats";

function buildChainData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 8) + Math.cos(t / 13);
    const noiseX = Math.sin(t / 5) * 0.03;
    const noiseY = Math.cos(t / 7) * 0.03;
    const x = 0.9 * z + noiseX;
    const y = -0.8 * z + noiseY;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

describe("FisherZTest", () => {
  it("detects strong marginal dependence", () => {
    const ci = new FisherZTest(buildChainData(200));
    expect(ci.test(0, 1)).toBeLessThan(1e-6);
  });

  it("recovers conditional independence in a common-cause structure", () => {
    const ci = new FisherZTest(buildChainData(200));
    expect(ci.test(0, 1, [2])).toBeGreaterThan(0.05);
  });

  it("caches repeated requests", () => {
    const ci = new FisherZTest(buildChainData(120));
    const first = ci.test(0, 1, [2]);
    const second = ci.test(1, 0, [2]);

    expect(second).toBe(first);
  });
});
