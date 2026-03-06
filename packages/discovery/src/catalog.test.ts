import { describe, expect, it } from "vitest";

import { algorithmCatalog } from "./catalog";

describe("algorithmCatalog", () => {
  it("declares browser support policy explicitly", () => {
    const calm = algorithmCatalog.find((entry) => entry.id === "calm");
    expect(calm?.availability.some((entry) => entry.runtime === "browser" && entry.supported === false)).toBe(true);
  });
});
