import { Backend, EdgeError, isUuid } from "./runtime.ts";
import { Job, Queue } from "./queue.ts";

export interface DeletionRepository {
  removeFiles(userId: string): Promise<boolean>;
  removeAuth(userId: string): Promise<void>;
  finalize(job: Job): Promise<void>;
}

export class DatabaseDeletionRepository implements DeletionRepository {
  constructor(readonly backend: Backend) {}
  async removeFiles(userId: string): Promise<boolean> {
    // Objects are generated as userId/uuid.jpeg. Listing starts at zero after removal;
    // offset pagination would skip objects as the preceding page disappears.
    for (let page = 0; page < 4; page++) {
      const response = await this.backend.request(
        "/storage/v1/object/list/avatars",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: `${userId}/`,
            limit: 100,
            offset: 0,
            sortBy: { column: "name", order: "asc" },
          }),
        },
      );
      const objects: { id?: string; name: string }[] = await response.json();
      if (!Array.isArray(objects)) throw new EdgeError("STORAGE_RESPONSE");
      if (objects.length === 0) return true;
      // Nested/unowned paths are never followed. Such entries need explicit operator repair.
      if (
        objects.some((o) =>
          typeof o.name !== "string" || o.name.includes("/") ||
          o.name === "." || o.name === ".." || !o.id
        )
      ) throw new EdgeError("STORAGE_PATH");
      await this.backend.request("/storage/v1/object/avatars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefixes: objects.map((o) => `${userId}/${o.name}`),
        }),
      });
    }
    return false;
  }
  async removeAuth(userId: string): Promise<void> {
    const response = await this.backend.request(
      `/auth/v1/admin/users/${userId}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ should_soft_delete: false }),
      },
      [404],
    );
    // A previous invocation can have removed Auth just before a crash. Auth 404 is success.
    if (!response.ok && response.status !== 404) {
      throw new EdgeError("AUTH_DELETE");
    }
  }
  async finalize(job: Job): Promise<void> {
    await this.backend.rpc("interlink_deletion_finalize", {
      job_id: job.id,
      lease_token: job.leaseToken,
    });
  }
}

export async function processDeletion(
  job: Job,
  queue: Queue,
  repository: DeletionRepository,
): Promise<void> {
  const userId = job.payload.userId;
  if (!isUuid(userId) || (job.phase !== "files" && job.phase !== "auth")) {
    throw new EdgeError("QUEUE_CONTRACT");
  }
  if (job.phase === "files") {
    const empty = await repository.removeFiles(userId);
    if (!empty) {
      await queue.ack(job, "retry", { code: "FILES_REMAIN", delaySeconds: 5 });
      return;
    }
    // Persist the checkpoint and release the lease before Auth removal.
    await queue.ack(job, "auth", { delaySeconds: 0 });
    return;
  }
  await repository.removeAuth(userId);
  // Transactional finalization scrubs relational data and marks the job completed.
  // The job survives Auth deletion and remains retryable if this call fails.
  await repository.finalize(job);
}
