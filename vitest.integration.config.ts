import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@causal-js/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@causal-js/discovery": path.resolve(__dirname, "packages/discovery/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.integration.test.ts"]
  }
});
