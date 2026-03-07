import { parentPort } from "node:worker_threads";

import { attachPcNodeWorkerHandler } from "./pc-worker-entry";

if (parentPort) {
  attachPcNodeWorkerHandler(parentPort);
}
