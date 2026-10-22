import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface PythonTransportOptions {
  pythonExecutable?: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

/** Transport failures intentionally exclude requests, process output and paths. */
export class PythonAdapterError extends Error {
  readonly code: string;
  readonly recoveryHint?: string;

  constructor(code: string, message: string, recoveryHint?: string) {
    super(message);
    this.name = "PythonAdapterError";
    this.code = code;
    if (recoveryHint !== undefined) this.recoveryHint = recoveryHint;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_INPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TERMINATION_GRACE_MS = 100;
const MAX_TIMEOUT_MS = 2_147_483_647;

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new PythonAdapterError(
      "python_invalid_options",
      `${name} must be a positive safe integer.`,
      "Provide positive integer transport limits."
    );
  }
  return selected;
}

function processFailure(): PythonAdapterError {
  return new PythonAdapterError(
    "python_process_failed",
    "The Python process could not complete the request.",
    "Check the selected Python environment and its required dependencies."
  );
}

function aborted(): PythonAdapterError {
  return new PythonAdapterError("python_aborted", "The Python request was cancelled.");
}

function spawnFailure(error: unknown): PythonAdapterError {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return new PythonAdapterError(
      "python_interpreter_missing",
      "The Python executable was not found.",
      "Set pythonExecutable to an installed Python interpreter or virtual environment."
    );
  }
  return processFailure();
}

function serializeRequest(request: unknown): Buffer {
  try {
    const serialized = JSON.stringify(request, (_key, value: unknown) => {
      if (
        value === undefined ||
        typeof value === "bigint" ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        throw new TypeError("Invalid JSON value.");
      }
      return value;
    });
    if (serialized === undefined) throw new TypeError("Missing JSON value.");
    return Buffer.from(serialized, "utf8");
  } catch {
    throw new PythonAdapterError(
      "python_invalid_request",
      "The Python request must contain finite JSON-compatible values.",
      "Remove cyclic values, non-finite numbers and executable objects from the request."
    );
  }
}

/** Execute one JSON request without a shell; protocol validation belongs to the caller. */
export async function runPythonJson(
  source: string,
  request: unknown,
  options: PythonTransportOptions = {},
  signal?: AbortSignal
): Promise<unknown> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new PythonAdapterError("python_invalid_options", "Transport options must be an object.");
  }
  const pythonExecutable = options.pythonExecutable === undefined ? "python3" : options.pythonExecutable;
  if (typeof pythonExecutable !== "string" || pythonExecutable.trim() === "" || pythonExecutable.includes("\0")) {
    throw new PythonAdapterError("python_invalid_options", "pythonExecutable must be a nonempty executable path or name.");
  }
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new PythonAdapterError("python_invalid_options", `timeoutMs must not exceed ${MAX_TIMEOUT_MS}.`);
  }
  const maxInputBytes = positiveInteger(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES, "maxInputBytes");
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes");
  if (signal?.aborted) throw aborted();
  const input = serializeRequest(request);
  if (input.byteLength > maxInputBytes) {
    throw new PythonAdapterError(
      "python_input_limit",
      "The Python request exceeds the input byte limit.",
      "Reduce the request size or increase maxInputBytes."
    );
  }
  if (signal?.aborted) throw aborted();

  return new Promise<unknown>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(pythonExecutable, ["-I", "-u", "-c", source], {
        shell: false,
        stdio: "pipe",
        windowsHide: true
      });
    } catch (error) {
      reject(spawnFailure(error));
      return;
    }

    let pendingError: PythonAdapterError | undefined;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (error: PythonAdapterError) => {
      if (settled || pendingError) return;
      pendingError = error;
      clearTimeout(timeout);
      // Close our pipe ends so inherited descriptors cannot keep the request alive.
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.pid === undefined) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // A process that is already exiting can reject a termination signal.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The close handler remains responsible for settling the request.
        }
      }, TERMINATION_GRACE_MS);
    };

    const outputLimit = () => new PythonAdapterError(
      "python_output_limit",
      "The Python process exceeded the output byte limit.",
      "Reduce the result size or increase maxOutputBytes."
    );
    const onStdout = (chunk: Buffer) => {
      if (pendingError) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) stop(outputLimit());
      else stdout.push(chunk);
    };
    const onStderr = (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutputBytes) stop(outputLimit());
    };
    const onError = (error: unknown) => stop(spawnFailure(error));
    const onPipeError = () => stop(processFailure());
    const onAbort = () => stop(aborted());
    const timeout = setTimeout(() => stop(new PythonAdapterError(
      "python_timeout",
      "The Python request exceeded its execution timeout.",
      "Reduce the workload or increase timeoutMs."
    )), timeoutMs);

    const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => {
      settled = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.stdout.off("error", onPipeError);
      child.stderr.off("error", onPipeError);
      child.stdin.off("error", onPipeError);
      child.off("error", onError);
      child.off("close", onClose);
      if (pendingError) {
        reject(pendingError);
        return;
      }
      if (code !== 0 || exitSignal !== null) {
        reject(processFailure());
        return;
      }
      const response = Buffer.concat(stdout, stdoutBytes).toString("utf8").trim();
      if (response === "") {
        reject(new PythonAdapterError("python_no_response", "The Python process returned no JSON response."));
        return;
      }
      try {
        resolve(JSON.parse(response, (_key, value: unknown) => {
          if (typeof value === "number" && !Number.isFinite(value)) {
            throw new TypeError("Non-finite JSON number.");
          }
          return value;
        }));
      } catch {
        reject(new PythonAdapterError(
          "python_invalid_json",
          "The Python process returned an invalid JSON response.",
          "Check that the selected Python environment supports the adapter protocol."
        ));
      }
    };

    child.on("error", onError);
    child.on("close", onClose);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.stdout.on("error", onPipeError);
    child.stderr.on("error", onPipeError);
    child.stdin.on("error", onPipeError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      child.stdin.end(input);
    } catch {
      onPipeError();
    }
  });
}
