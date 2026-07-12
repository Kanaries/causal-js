import { describe, expect, it } from "vitest";

import { algorithmCatalog } from "./catalog";

describe("algorithmCatalog", () => {
  it("declares browser support policy explicitly", () => {
    const calm = algorithmCatalog.find((entry) => entry.id === "calm");
    expect(calm?.availability.some((entry) => entry.runtime === "browser" && entry.supported === false)).toBe(true);
  });

  it("registers every implemented algorithm", () => {
    const ids = algorithmCatalog.map((entry) => entry.id);
    for (const id of [
      "pc",
      "mvpc",
      "fci",
      "ges",
      "cdnod",
      "exact-search",
      "grasp",
      "gin",
      "cam-uv",
      "rcd"
    ]) {
      expect(ids, `catalog is missing ${id}`).toContain(id);
    }
  });

  it("keeps implemented-algorithm summaries truthful (no 'planned' copy)", () => {
    for (const entry of algorithmCatalog) {
      if (entry.id === "calm") {
        continue; // calm is the only genuinely unimplemented placeholder.
      }
      expect(entry.summary.toLowerCase(), `${entry.id} summary still says planned`).not.toContain(
        "planned"
      );
    }
  });
});
