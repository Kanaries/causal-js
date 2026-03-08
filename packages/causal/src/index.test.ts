import { describe, expect, it } from "vitest";

import { DenseMatrix } from "./index";
import { detectNodeRuntimeCapabilities, getDefaultPcNodeWorkerEntry } from "./node/index";
import { detectWebRuntimeCapabilities, getDefaultPcWebWorkerEntry } from "./web/index";

describe("@kanaries/causal facade", () => {
  it("re-exports the portable surface", () => {
    const matrix = new DenseMatrix([
      [1, 2],
      [3, 4]
    ]);

    expect(matrix.rows).toBe(2);
    expect(matrix.columns).toBe(2);
  });

  it("re-exports the node facade", () => {
    const runtime = detectNodeRuntimeCapabilities({
      process: {
        versions: {
          node: "22.0.0"
        }
      }
    });

    expect(runtime.isNodeLike).toBe(true);
    expect(getDefaultPcNodeWorkerEntry().pathname.includes("pc-worker-runtime")).toBe(true);
  });

  it("re-exports the web facade", () => {
    const runtime = detectWebRuntimeCapabilities({
      Worker: class Worker {},
      navigator: {
        userAgent: "test-agent"
      }
    });

    expect(runtime.isBrowserLike).toBe(true);
    expect(getDefaultPcWebWorkerEntry().pathname.includes("pc-worker-runtime")).toBe(true);
  });
});
