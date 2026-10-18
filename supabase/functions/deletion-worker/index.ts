import {
  authorizeWorker,
  Backend,
  EdgeError,
  failure,
  json,
} from "../_shared/runtime.ts";
import { DatabaseQueue, runBatch } from "../_shared/queue.ts";
import {
  DatabaseDeletionRepository,
  processDeletion,
} from "../_shared/deletion.ts";

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      throw new EdgeError("METHOD_NOT_ALLOWED", 405);
    }
    await authorizeWorker(request);
    const backend = new Backend();
    const queue = new DatabaseQueue(backend);
    const repository = new DatabaseDeletionRepository(backend);
    return json(
      await runBatch(
        queue,
        "deletion",
        (job) => processDeletion(job, queue, repository),
      ),
    );
  } catch (error) {
    return failure(error);
  }
});
