import { Backend, EdgeError, isUuid } from "./runtime.ts";

export type Job = {
  id: string;
  kind: "push" | "deletion";
  leaseToken: string;
  attempts: number;
  phase: "send" | "receipt" | "files" | "auth";
  payload: {
    notificationId?: string;
    deviceId?: string;
    userId?: string;
    ticketId?: string;
  };
};
export type Outcome = "done" | "retry" | "failed" | "receipt" | "auth";
export interface Queue {
  claim(kind: Job["kind"], size: number): Promise<Job[]>;
  ack(
    job: Job,
    outcome: Outcome,
    details?: Record<string, unknown>,
  ): Promise<void>;
}

export class DatabaseQueue implements Queue {
  constructor(readonly backend: Backend) {}
  async claim(kind: Job["kind"], size: number): Promise<Job[]> {
    const jobs = await this.backend.rpc<Job[]>("interlink_worker_claim", {
      kind,
      batch_size: size,
    });
    if (
      !Array.isArray(jobs) ||
      jobs.some((j) =>
        !isUuid(j.id) || !isUuid(j.leaseToken) || j.kind !== kind || !j.payload
      )
    ) {
      throw new EdgeError("QUEUE_CONTRACT", 503);
    }
    return jobs;
  }
  async ack(
    job: Job,
    outcome: Outcome,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.backend.rpc("interlink_worker_ack", {
      job_id: job.id,
      lease_token: job.leaseToken,
      outcome,
      details,
    });
  }
}

export function retryDelay(attempts: number, random = Math.random): number {
  return Math.min(3600, 60 * 2 ** Math.max(0, Math.min(attempts - 1, 6))) +
    Math.floor(random() * 30);
}

/** A failure to acknowledge leaves the leased job durable for the next invocation. */
export async function runBatch(
  queue: Queue,
  kind: Job["kind"],
  process: (job: Job) => Promise<void>,
): Promise<{ claimed: number; processed: number; retried: number }> {
  // Limit queued work behind each processor so all jobs finish within the 120s lease.
  // File batches can require eight sequential Storage calls; claim just one per lane.
  const jobs = await queue.claim(kind, kind === "deletion" ? 4 : 8);
  const stats = { claimed: jobs.length, processed: 0, retried: 0 };
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++]!;
        try {
          await process(job);
          stats.processed++;
        } catch (error) {
          const code = error instanceof EdgeError
            ? error.code
            : "PROCESSING_ERROR";
          try {
            await queue.ack(job, job.attempts >= 8 ? "failed" : "retry", {
              code,
              delaySeconds: retryDelay(job.attempts),
            });
          } catch {
            // The lease expires in SQL; a subsequent invocation reclaims this job.
          }
          stats.retried++;
        }
      }
    }),
  );
  return stats;
}
