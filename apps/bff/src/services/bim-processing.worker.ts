import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import type { BimWorkerTask } from "./bim-background-processing";
import { prepareBimIfcInput } from "./bim-revision-identity";
import { generateFragFromBuffer } from "./fragments.service";
import { indexPreparedBimProperties } from "./bim-property-indexer.service";

async function run(task: BimWorkerTask) {
  if (task.kind === "prepare-frag") {
    const prepared = prepareBimIfcInput(task.input);
    const fragBytes = await generateFragFromBuffer(prepared.ifcBytes);
    const fragContentSha256 = createHash("sha256").update(fragBytes).digest("hex");
    // prepareBimIfcInput owns this standalone ArrayBuffer; transfer it back instead
    // of cloning a second full IFC snapshot onto the HTTP heap.
    parentPort!.postMessage({ type: "result", value: { prepared, fragBytes, fragContentSha256 } },
      [prepared.ifcBytes.buffer as ArrayBuffer]);
    return;
  }
  const prepared = task.prepared ?? prepareBimIfcInput({ ...task.input, ifcBuffer: task.ifcBuffer! });
  const result = await indexPreparedBimProperties(task.input, prepared, (generationId) => {
    parentPort!.postMessage({ type: "generation", generationId });
  });
  // Observations stay in PostgreSQL/worker, not cloned back into the HTTP heap.
  const { modelId, elementCount, propertyCount, context } = result;
  parentPort!.postMessage({ type: "result", value: { modelId, elementCount, propertyCount, context } });
}

if (!parentPort) throw new Error("BIM processing entry must run in a worker");
void run(workerData as BimWorkerTask).catch((error) => {
  parentPort!.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
});
