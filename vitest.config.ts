import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@causal-js/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@causal-js/discovery": path.resolve(__dirname, "packages/discovery/src/index.ts"),
      "@causal-js/tasks": path.resolve(__dirname, "packages/tasks/src/index.ts"),
      "@kanaries/causal": path.resolve(__dirname, "packages/causal/src/index.ts"),
      "@kanaries/causal/node": path.resolve(__dirname, "packages/causal/src/node/index.ts"),
      "@kanaries/causal/web": path.resolve(__dirname, "packages/causal/src/web/index.ts")
    }
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"]
  }
});
