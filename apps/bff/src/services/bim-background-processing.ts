import type { prepareBimIfcInput } from "./bim-revision-identity";
import type { indexPreparedBimProperties } from "./bim-property-indexer.service";
import { bimBackgroundRunner, bimWorkerEntry } from "./bim-background-runner";
import { failBimIndexGeneration } from "../db/bim-index-generations";
import { getDatabasePool } from "../db/client";

type IndexInput = Parameters<typeof indexPreparedBimProperties>[0];
type Prepared = ReturnType<typeof prepareBimIfcInput>;
type IndexSummary = Pick<Awaited<ReturnType<typeof indexPreparedBimProperties>>, "modelId" | "elementCount" | "propertyCount" | "context">;
export type BimWorkerTask =
  | { kind: "prepare-frag"; input: { projectCode: string; documentPath: string; ifcBuffer: Uint8Array } }
  | { kind: "index"; input: IndexInput; ifcBuffer?: Uint8Array; prepared?: Prepared };

export async function prepareFragInBackground(input: { projectCode: string; documentPath: string; ifcBuffer: Uint8Array }) {
  const result = await bimBackgroundRunner.run<{ prepared: Prepared; fragBytes: Uint8Array; fragContentSha256: string }>(bimWorkerEntry, { kind: "prepare-frag", input } satisfies BimWorkerTask);
  Object.freeze(result.prepared.context);
  return result;
}

export async function indexInBackground(input: IndexInput, bytes: { ifcBuffer: Uint8Array } | { prepared: Prepared }): Promise<IndexSummary> {
  let generationId: string | undefined;
  try {
    const result = await bimBackgroundRunner.run<IndexSummary>(bimWorkerEntry, { kind: "index", input, ...bytes } satisfies BimWorkerTask, (event) => {
      const message = event as { type?: string; generationId?: string };
      if (message.type === "generation") generationId = message.generationId;
    });
    Object.freeze(result.context);
    return result;
  } catch (error) {
    // Normal extraction failures already reconcile themselves. Also cover abrupt worker exits.
    // Restrict recovery to the worker's generation; never overwrite ready/cancelled/newer jobs.
    if (generationId) {
      const message = error instanceof Error ? error.message : String(error);
      await failBimIndexGeneration(generationId, message);
      await getDatabasePool().query(`update cde_bim_index_jobs set status='failed', error_message=$2,
        updated_at=now(), finished_at=now() where generation_id=$1 and status='processing'
        and exists(select 1 from cde_bim_index_generations where id=$1 and status='failed')`, [generationId, message]);
    }
    throw error;
  }
}
