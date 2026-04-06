import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageRoot, "dist");
const sourceArtifactsDir = path.join(packageRoot, "src", "artifacts");
const distArtifactsDir = path.join(distDir, "artifacts");

execFileSync("pnpm", ["exec", "tsup", "--config", "tsup.config.ts"], {
  cwd: packageRoot,
  stdio: "inherit"
});

if (!fs.existsSync(sourceArtifactsDir)) {
  throw new Error(
    "Missing bundled Rust/WASM artifact. Run `pnpm --filter @causal-js/kernel build:wasm` first."
  );
}

fs.mkdirSync(distArtifactsDir, { recursive: true });
for (const fileName of fs.readdirSync(sourceArtifactsDir)) {
  fs.copyFileSync(path.join(sourceArtifactsDir, fileName), path.join(distArtifactsDir, fileName));
}
