'use client';
import type { CommandMap, CommandName, MutationResult, QueryMap, QueryName } from '@interlink/shared';

export class BrowserApiError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) { super(message, options); }
}

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  }); } catch (error) {
    if (signal?.aborted) throw error;
    throw new BrowserApiError('NETWORK', '서버 응답이 지연되거나 연결이 끊겼습니다. 잠시 뒤 다시 시도해 주세요.', { cause: error });
  }
  let json: T & { error?: { code: string; message: string } };
  try { json = await response.json(); }
  catch (error) { throw new BrowserApiError('UNAVAILABLE', '서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', { cause: error }); }
  if (!response.ok || json.error) throw new BrowserApiError(json.error?.code ?? 'UNAVAILABLE', json.error?.message ?? '요청을 처리하지 못했습니다.');
  return json;
}

export function createOperationsClient() {
  const pendingMutations = new Map<string, { key: string; inFlight?: Promise<MutationResult> }>();
  return {
    mode: 'supabase' as const,
    async query<K extends QueryName>(name: K, input: QueryMap[K]['input'], options?: { signal?: AbortSignal }): Promise<QueryMap[K]['output']> {
      return (await api<{ result: QueryMap[K]['output'] }>('/api/data', { type: 'query', name, input }, options?.signal)).result;
    },
    async command<K extends CommandName>(name: K, input: CommandMap[K]['input'], idempotencyKey = crypto.randomUUID()): Promise<{ id: string; status?: string }> {
      const fingerprint = JSON.stringify([name, input]);
      const prior = pendingMutations.get(fingerprint);
      if (prior?.inFlight) return prior.inFlight;
      const pending: { key: string; inFlight?: Promise<MutationResult> } = { key: prior?.key ?? idempotencyKey };
      pending.inFlight = api<{ result: MutationResult }>('/api/data', { type: 'command', name, input, idempotencyKey: pending.key }).then(({ result }) => {
        pendingMutations.delete(fingerprint);
        return result;
      }).catch((error: unknown) => {
        // A lost response may follow a committed mutation. Keep its key for a
        // user retry, but allow that retry to start a fresh transport request.
        pending.inFlight = undefined;
        throw error;
      });
      pendingMutations.set(fingerprint, pending);
      return pending.inFlight;
    },
  };
}
