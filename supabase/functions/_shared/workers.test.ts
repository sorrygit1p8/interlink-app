import {
  processPush,
  PushProvider,
  PushRepository,
  PushTarget,
} from "./push.ts";
import { DeletionRepository, processDeletion } from "./deletion.ts";
import { Job, Outcome, Queue, retryDelay, runBatch } from "./queue.ts";
import { constantTimeEqual, EdgeError } from "./runtime.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
const id = "00000000-0000-4000-8000-000000000001";
function job(overrides: Partial<Job> = {}): Job {
  return {
    id,
    kind: "push",
    leaseToken: id,
    attempts: 1,
    phase: "send",
    payload: { userId: id, notificationId: id, deviceId: id },
    ...overrides,
  };
}
class TestQueue implements Queue {
  events: { outcome: Outcome; details: Record<string, unknown> }[] = [];
  constructor(readonly jobs: Job[] = []) {}
  claim(): Promise<Job[]> {
    return Promise.resolve(this.jobs);
  }
  ack(
    _job: Job,
    outcome: Outcome,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    this.events.push({ outcome, details });
    return Promise.resolve();
  }
}
const target: PushTarget = {
  token: "ExponentPushToken[test-token]",
  notificationId: id,
  deviceId: id,
};
function repository(): PushRepository & { disabled: string[] } {
  const disabled: string[] = [];
  return {
    disabled,
    target: () => Promise.resolve(target),
    disableDevice: (id) => {
      disabled.push(id);
      return Promise.resolve();
    },
  };
}
function provider(): PushProvider {
  return {
    send: () => Promise.resolve({ status: "ok", id: "ticket-1" }),
    receipt: () => Promise.resolve({ status: "ok" }),
  };
}

Deno.test("successful send durably schedules receipt rather than completing", async () => {
  const queue = new TestQueue();
  await processPush(job(), queue, repository(), provider());
  assert(queue.events[0]?.outcome === "receipt");
  assert(queue.events[0]?.details.ticketId === "ticket-1");
  assert(queue.events[0]?.details.delaySeconds === 900);
});
Deno.test("a ticket accepted on the final send attempt still enters receipt processing", async () => {
  const queue = new TestQueue();
  await processPush(job({ attempts: 8 }), queue, repository(), provider());
  assert(queue.events.length === 1);
  assert(queue.events[0]?.outcome === "receipt");
  assert(queue.events[0]?.details.ticketId === "ticket-1");
});
Deno.test("receipt success is the only delivered completion", async () => {
  const queue = new TestQueue();
  await processPush(
    job({ phase: "receipt", payload: { ticketId: "ticket-1" } }),
    queue,
    repository(),
    provider(),
  );
  assert(queue.events[0]?.outcome === "done");
});
Deno.test("revoked account/device is rechecked before receipt and not delivered", async () => {
  const queue = new TestQueue(), repo = repository();
  repo.target = () => Promise.resolve(null);
  await processPush(job({ phase: "receipt" }), queue, repo, {
    send: () => {
      throw new Error("must not call Expo");
    },
    receipt: () => {
      throw new Error("must not call Expo");
    },
  });
  assert(queue.events[0]?.details.reason === "recipient_ineligible");
});
Deno.test("invalid receipt token is disabled and job completed", async () => {
  const queue = new TestQueue(), repo = repository(), expo = provider();
  expo.receipt = () =>
    Promise.resolve({
      status: "error",
      details: { error: "DeviceNotRegistered" },
    });
  await processPush(
    job({ phase: "receipt", payload: { ticketId: "ticket-1" } }),
    queue,
    repo,
    expo,
  );
  assert(repo.disabled[0] === id);
  assert(queue.events[0]?.details.reason === "device_not_registered");
});
Deno.test("pending receipt never resends; bounded retry eventually fails", async () => {
  const queue = new TestQueue(), expo = provider();
  expo.receipt = () => Promise.resolve(null);
  await processPush(
    job({ phase: "receipt", payload: { ticketId: "ticket-1" } }),
    queue,
    repository(),
    expo,
  );
  assert(queue.events[0]?.outcome === "receipt");
  await processPush(
    job({ phase: "receipt", attempts: 8, payload: { ticketId: "ticket-1" } }),
    queue,
    repository(),
    expo,
  );
  assert(queue.events[1]?.outcome === "failed");
});
Deno.test("provider rate rejection retries send phase with backoff", async () => {
  const queue = new TestQueue(), expo = provider();
  expo.receipt = () =>
    Promise.resolve({
      status: "error",
      details: { error: "MessageRateExceeded" },
    });
  await processPush(
    job({ phase: "receipt", payload: { ticketId: "ticket-1" }, attempts: 3 }),
    queue,
    repository(),
    expo,
  );
  assert(queue.events[0]?.outcome === "retry");
  assert(queue.events[0]?.details.phase === "send");
  assert(Number(queue.events[0]?.details.delaySeconds) >= 240);
});
Deno.test("batch isolates transient failures and records bounded retry without payloads", async () => {
  const queue = new TestQueue([job(), job({ attempts: 8 })]);
  const result = await runBatch(queue, "push", () => {
    throw new EdgeError("UPSTREAM_UNAVAILABLE");
  });
  assert(result.retried === 2 && result.processed === 0);
  assert(queue.events.some((event) => event.outcome === "failed"));
  assert(queue.events.some((event) => event.outcome === "retry"));
});
Deno.test("retry exponential schedule stays bounded", () => {
  assert(retryDelay(1, () => 0) === 60);
  assert(retryDelay(4, () => 0) === 480);
  assert(retryDelay(99, () => 0) === 3600);
});
Deno.test("deletion checkpoints files before auth and resumes finalization safely", async () => {
  const queue = new TestQueue(), calls: string[] = [];
  const repo: DeletionRepository = {
    removeFiles: () => {
      calls.push("files");
      return Promise.resolve(true);
    },
    removeAuth: () => {
      calls.push("auth");
      return Promise.resolve();
    },
    finalize: () => {
      calls.push("finalize");
      return Promise.resolve();
    },
  };
  await processDeletion(job({ kind: "deletion", phase: "files" }), queue, repo);
  assert(calls.join() === "files" && queue.events[0]?.outcome === "auth");
  await processDeletion(job({ kind: "deletion", phase: "auth" }), queue, repo);
  await processDeletion(job({ kind: "deletion", phase: "auth" }), queue, repo);
  assert(calls.join() === "files,auth,finalize,auth,finalize");
});
Deno.test("remaining files do not remove auth", async () => {
  const queue = new TestQueue();
  await processDeletion(job({ kind: "deletion", phase: "files" }), queue, {
    removeFiles: () => Promise.resolve(false),
    removeAuth: () => {
      throw new Error("premature auth deletion");
    },
    finalize: () => {
      throw new Error("premature finalize");
    },
  });
  assert(queue.events[0]?.outcome === "retry");
});
Deno.test("failed auth deletion retains retryable job and cannot finalize", async () => {
  const deletion = job({ kind: "deletion", phase: "auth" }),
    queue = new TestQueue([deletion]);
  await runBatch(
    queue,
    "deletion",
    (current) =>
      processDeletion(current, queue, {
        removeFiles: () => Promise.resolve(true),
        removeAuth: () => {
          throw new EdgeError("AUTH_DELETE");
        },
        finalize: () => {
          throw new Error("must not finalize");
        },
      }),
  );
  assert(
    queue.events[0]?.outcome === "retry" &&
      queue.events[0]?.details.code === "AUTH_DELETE",
  );
});
Deno.test("worker secret digest comparison rejects wrong or empty secrets", async () => {
  assert(await constantTimeEqual("known-secret", "known-secret"));
  assert(!(await constantTimeEqual("known-secret", "known-secreu")));
  assert(!(await constantTimeEqual("known-secret", "")));
});
