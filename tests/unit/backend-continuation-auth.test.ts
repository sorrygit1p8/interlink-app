import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseClient, type SupabaseDataClient } from '@interlink/data';

const clients: SupabaseDataClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); vi.useRealTimers(); });
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const projectId = '20000000-0000-4000-8000-000000000001';
const input = { projectId, role: '개발', introduction: '계정 전환 중에는 재시도하지 않는 신청' };
type Response = { data: unknown; error: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(responses: Promise<Response>[]) {
  const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const rpc = vi.fn<(name: string, args: unknown) => { abortSignal: () => Promise<Response> }>(() => ({ abortSignal: () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected RPC request');
    return response;
  } }));
  const sdk = {
    auth: { onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      authListeners.add(listener);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } };
    } },
    rpc, removeChannel: vi.fn().mockResolvedValue('ok'),
  } as unknown as SupabaseClient;
  const client = createSupabaseClient({ url: 'https://interlink-test.invalid', anonKey: 'sb_publishable_contract_fixture', supabase: sdk });
  clients.push(client);
  client.onAuthStateChange(() => undefined);
  const auth = (userId: string, event: AuthChangeEvent = 'SIGNED_IN') => {
    for (const listener of authListeners) listener(event, { user: { id: userId } } as Session);
  };
  auth(userA);
  return { client, rpc, auth };
}

describe('continued auth identity and in-flight retry regressions (mock SDK)', () => {
  it('does not replay an old account mutation as the new account or clear its in-flight request', async () => {
    vi.useFakeTimers();
    const nextAccountResponse = deferred<Response>();
    const { client, rpc, auth } = fixture([
      Promise.resolve({ data: null, error: { status: 503 } }), nextAccountResponse.promise,
    ]);
    const oldRequest = client.command('application.submit', input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    auth(userB);
    const nextRequest = client.command('application.submit', input);
    await vi.advanceTimersByTimeAsync(150);
    expect(await oldRequest).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    const duplicateNextRequest = client.command('application.submit', input);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).not.toEqual(rpc.mock.calls[1]?.[1]);
    nextAccountResponse.resolve({ data: { id: projectId, status: 'pending' }, error: null });
    expect(await nextRequest).toEqual(await duplicateNextRequest);
  });

  it('rejects a late query response belonging to the previous account', async () => {
    vi.useFakeTimers();
    const response = deferred<Response>();
    const { client, rpc, auth } = fixture([response.promise]);
    const request = client.query('notifications.list', {}).catch((error: unknown) => error);
    auth(userB);
    response.resolve({ data: { items: [{ title: 'Previous account private notification' }], nextCursor: null }, error: null });
    expect(await request).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves the same-account mutation and key across a token refresh', async () => {
    vi.useFakeTimers();
    const { client, rpc, auth } = fixture([
      Promise.resolve({ data: null, error: { status: 503 } }),
      Promise.resolve({ data: { id: projectId, status: 'pending' }, error: null }),
    ]);
    const request = client.command('application.submit', input);
    await vi.advanceTimersByTimeAsync(0);
    auth(userA, 'TOKEN_REFRESHED');
    await vi.advanceTimersByTimeAsync(150);
    await expect(request).resolves.toMatchObject({ id: projectId });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
  });
});
