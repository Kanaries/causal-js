import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustRoot = path.join(packageRoot, "rust");
const outputDir = path.join(packageRoot, "src", "artifacts");
const outputFile = path.join(outputDir, "causal_kernel_dag_dsep.wasm");
const compiledFile = path.join(
  rustRoot,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "causal_kernel_dag_dsep.wasm"
);

function ensureWasmTarget() {
  const installedTargets = execFileSync("rustup", ["target", "list", "--installed"], {
    encoding: "utf8"
  });

  if (!installedTargets.includes("wasm32-unknown-unknown")) {
    execFileSync("rustup", ["target", "add", "wasm32-unknown-unknown"], {
      stdio: "inherit"
    });
  }
}

ensureWasmTarget();
execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], {
  cwd: rustRoot,
  stdio: "inherit"
});

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(compiledFile, outputFile);
