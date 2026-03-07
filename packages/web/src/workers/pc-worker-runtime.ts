import { attachPcWebWorkerHandler } from "./pc-worker-entry";
import type { WebWorkerEntryScope } from "./pc-worker-entry";

const scope = globalThis as unknown as {
  postMessage?: (message: unknown) => void;
  addEventListener?: (type: "message", listener: (event: { data: unknown }) => void) => void;
};

if (typeof scope.postMessage === "function" && typeof scope.addEventListener === "function") {
  attachPcWebWorkerHandler(scope as WebWorkerEntryScope);
}
