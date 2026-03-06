import { describe, expect, it } from "vitest";

import { EDGE_ENDPOINT } from "./graph";

describe("EDGE_ENDPOINT", () => {
  it("exposes stable endpoint labels", () => {
    expect(EDGE_ENDPOINT.arrow).toBe("arrow");
    expect(EDGE_ENDPOINT.tail).toBe("tail");
  });
});
