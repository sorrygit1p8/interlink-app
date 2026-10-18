import { Backend, EdgeError, fetchTimed, isUuid } from "./runtime.ts";
import { Job, Queue, retryDelay } from "./queue.ts";

export type PushTarget = {
  token: string;
  notificationId: string;
  deviceId: string;
  projectId?: string;
};
type ExpoError = { error?: string };
type ExpoResult = { status?: "ok" | "error"; id?: string; details?: ExpoError };
export interface PushProvider {
  send(target: PushTarget): Promise<ExpoResult>;
  receipt(ticketId: string): Promise<ExpoResult | null>;
}
export interface PushRepository {
  target(job: Job): Promise<PushTarget | null>;
  disableDevice(deviceId: string): Promise<void>;
}

export class DatabasePushRepository implements PushRepository {
  constructor(readonly backend: Backend) {}
  async target(job: Job): Promise<PushTarget | null> {
    const target = await this.backend.rpc<PushTarget | null>(
      "interlink_push_target",
      { job_id: job.id, lease_token: job.leaseToken },
    );
    if (
      target &&
      (!isUuid(target.deviceId) || !isUuid(target.notificationId) ||
        typeof target.token !== "string")
    ) throw new EdgeError("QUEUE_CONTRACT");
    return target;
  }
  async disableDevice(deviceId: string): Promise<void> {
    await this.backend.rpc("interlink_disable_device", { device_id: deviceId });
  }
}

export class ExpoPushProvider implements PushProvider {
  constructor(readonly accessToken?: string) {}
  async post(path: string, body: unknown): Promise<{ data?: unknown }> {
    const response = await fetchTimed(
      `https://exp.host/--/api/v2/push/${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          ...(this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw new EdgeError(`PUSH_HTTP_${response.status}`);
    return await response.json();
  }
  async send(target: PushTarget): Promise<ExpoResult> {
    const result = await this.post("send", [{
      to: target.token,
      title: "인터링크",
      body: "새 알림이 도착했어요. 앱에서 확인해 주세요.",
      sound: "default",
      channelId: "team-updates",
      data: {
        notificationId: target.notificationId,
        ...(target.projectId ? { projectId: target.projectId } : {}),
      },
    }]);
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new EdgeError("PUSH_RESPONSE");
    }
    return result.data[0] as ExpoResult;
  }
  async receipt(ticketId: string): Promise<ExpoResult | null> {
    const result = await this.post("getReceipts", { ids: [ticketId] });
    if (
      !result.data || typeof result.data !== "object" ||
      Array.isArray(result.data)
    ) throw new EdgeError("PUSH_RESPONSE");
    return (result.data as Record<string, ExpoResult>)[ticketId] ?? null;
  }
}

export async function processPush(
  job: Job,
  queue: Queue,
  repository: PushRepository,
  provider: PushProvider,
): Promise<void> {
  // Resolve again on EVERY phase: logout, blocks, settings and account deletion may revoke delivery.
  const target = await repository.target(job);
  if (!target) {
    await queue.ack(job, "done", { reason: "recipient_ineligible" });
    return;
  }
  if (
    !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(target.token)
  ) {
    await repository.disableDevice(target.deviceId);
    await queue.ack(job, "done", { reason: "invalid_token" });
    return;
  }
  if (job.phase !== "send" && job.phase !== "receipt") {
    throw new EdgeError("QUEUE_CONTRACT");
  }
  const ticketId = job.payload.ticketId;
  if (job.phase === "receipt" && !ticketId) {
    throw new EdgeError("QUEUE_CONTRACT");
  }
  const result = job.phase === "receipt"
    ? await provider.receipt(ticketId!)
    : await provider.send(target);
  if (!result) {
    await queue.ack(job, job.attempts >= 8 ? "failed" : "receipt", {
      ticketId,
      delaySeconds: 900,
      code: "RECEIPT_PENDING",
    });
    return;
  }
  if (result.status === "ok") {
    if (job.phase === "receipt") await queue.ack(job, "done");
    else {
      if (typeof result.id !== "string" || result.id.length > 200) {
        throw new EdgeError("PUSH_RESPONSE");
      }
      // Tickets are committed before the receipt phase is scheduled; sending is never considered delivery.
      await queue.ack(job, "receipt", {
        ticketId: result.id,
        delaySeconds: 900,
      });
    }
    return;
  }
  if (result.status !== "error") throw new EdgeError("PUSH_RESPONSE");
  const code = result.details?.error ?? "PUSH_PROVIDER_ERROR";
  if (code === "DeviceNotRegistered") {
    await repository.disableDevice(target.deviceId);
    await queue.ack(job, "done", { reason: "device_not_registered" });
  } else if (
    ["MessageTooBig", "InvalidCredentials", "MismatchSenderId"].includes(code)
  ) {
    await queue.ack(job, "failed", { code });
  } else {
    // Provider rejection means it was not delivered; a new send is appropriate.
    await queue.ack(job, job.attempts >= 8 ? "failed" : "retry", {
      code: code === "MessageRateExceeded" ? code : "PUSH_PROVIDER_ERROR",
      phase: "send",
      delaySeconds: retryDelay(job.attempts),
    });
  }
}
