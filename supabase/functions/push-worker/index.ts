import {
  authorizeWorker,
  Backend,
  EdgeError,
  failure,
  json,
} from "../_shared/runtime.ts";
import { DatabaseQueue, runBatch } from "../_shared/queue.ts";
import {
  DatabasePushRepository,
  ExpoPushProvider,
  processPush,
} from "../_shared/push.ts";

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      throw new EdgeError("METHOD_NOT_ALLOWED", 405);
    }
    await authorizeWorker(request);
    const backend = new Backend();
    const queue = new DatabaseQueue(backend);
    const repository = new DatabasePushRepository(backend);
    const provider = new ExpoPushProvider(Deno.env.get("EXPO_ACCESS_TOKEN"));
    return json(
      await runBatch(
        queue,
        "push",
        (job) => processPush(job, queue, repository, provider),
      ),
    );
  } catch (error) {
    return failure(error);
  }
});
