import { randomUUID } from 'node:crypto';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataClient, createSupabaseClient, normalizeError, type SupabaseDataClient } from '@interlink/data';

const endpoint = 'https://interlink-test.invalid';
const projectId = '20000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';
const clients: SupabaseDataClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });
function transport(responses: Array<{ status: number; body: unknown } | Error>) {
  const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const response = responses.shift(); if (!response) throw new Error('Unexpected extra HTTP call');
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  };
  // Real SDK serialization, isolated fetch, explicitly supplied fictional user token.
  // This is not actual authentication or a network/RLS test.
  const sdk = createClient(endpoint, 'sb_publishable_contract_fixture', { accessToken: async () => 'fictional-user-access-token', global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
  const client = createSupabaseClient({ url: endpoint, anonKey: 'sb_publishable_contract_fixture', supabase: sdk }); clients.push(client);
  return { client, requests };
}
function fakeAuth(overrides: Record<string, unknown> = {}) {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    stopAutoRefresh: vi.fn(), startAutoRefresh: vi.fn(), ...overrides,
  };
  const sdk = { auth, removeChannel: vi.fn().mockResolvedValue('ok') } as unknown as SupabaseClient;
  const client = createSupabaseClient({ url: endpoint, anonKey: 'sb_publishable_contract_fixture', supabase: sdk }); clients.push(client);
  return { client, auth, sdk };
}

describe('Supabase adapter + actual SDK / mocked HTTP contract', () => {
  it('serializes paginated server search and forwards the existing user token and public key', async () => {
    const { client, requests } = transport([{ status: 200, body: { items: [], nextCursor: null } }]);
    await expect(client.query('projects.search', { search: '환경', roles: ['개발'], limit: 12, sort: 'newest' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(requests).toHaveLength(1); expect(requests[0]?.url).toBe(`${endpoint}/rest/v1/rpc/interlink_query`);
    expect(requests[0]?.method).toBe('POST'); expect(requests[0]?.body).toEqual({ operation: 'projects.search', payload: { search: '환경', roles: ['개발'], limit: 12, sort: 'newest' } });
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fictional-user-access-token');
    expect(requests[0]?.headers.get('apikey')).toBe('sb_publishable_contract_fixture');
  });
  it('retries a transient mutation with exactly the same idempotency key and body', async () => {
    const { client, requests } = transport([{ status: 503, body: { message: 'upstream temporarily unavailable' } }, { status: 200, body: { id: projectId, status: 'pending' } }]);
    const key = randomUUID(); const input = { projectId, role: '개발', introduction: '배우면서 함께 만드는 가상 소개' };
    await expect(client.command('application.submit', input, key)).resolves.toMatchObject({ id: projectId, status: 'pending' });
    expect(requests).toHaveLength(2); expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.body).toEqual({ operation: 'application.submit', payload: input, idempotency_key: key });
  });
  it('sends setup in one retry-stable profile mutation and omits setup fields from an ordinary legacy update', async () => {
    const { client, requests } = transport([{ status: 503, body: {} }, { status: 200, body: { id: userId } }, { status: 200, body: { id: userId } }]);
    const profile = { nickname: '가상 학생', avatar: 'leaf', interests: ['환경'], roles: [], learningRoles: [], skills: [], availability: [], activityMode: 'online' as const, bio: '', discoverable: false, links: [] };
    const input = { ...profile, educationLevel: 'middle' as const, onboardingCompleted: true }; const key = randomUUID();
    await expect(client.command('profile.update', input, key)).resolves.toEqual({ id: userId });
    expect(requests[0]?.body).toEqual({ operation: 'profile.update', payload: input, idempotency_key: key });
    expect(requests[1]?.body).toEqual(requests[0]?.body);
    await client.command('profile.update', { ...profile, discoverable: true });
    expect(requests[2]?.body).toMatchObject({ operation: 'profile.update', payload: { ...profile, discoverable: true } });
    expect((requests[2]?.body as { payload: unknown }).payload).not.toHaveProperty('educationLevel');
    expect((requests[2]?.body as { payload: unknown }).payload).not.toHaveProperty('onboardingCompleted');
  });
  it('rejects invalid school/setup before HTTP and surfaces a server completion-reset rejection', async () => {
    const { client, requests } = transport([{ status: 400, body: { code: 'P0001', message: 'VALIDATION' } }]);
    const profile = { nickname: '가상 학생', avatar: 'leaf', interests: ['환경'], roles: [], learningRoles: [], skills: [], availability: [], activityMode: 'online' as const, bio: '', discoverable: false, links: [] };
    await expect(client.command('profile.update', { ...profile, educationLevel: 'unknown' as 'middle' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.command('profile.update', { ...profile, onboardingCompleted: true })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(requests).toHaveLength(0);
    await expect(client.command('profile.update', { ...profile, onboardingCompleted: false })).rejects.toMatchObject({ code: 'VALIDATION', retryable: false });
    expect(requests).toHaveLength(1);
  });
  it('does not retry forbidden requests and does not leak raw SQL errors', async () => {
    const secretMarker = 'private SQL detail should never escape';
    const { client, requests } = transport([{ status: 403, body: { code: '42501', message: secretMarker, details: 'table accounts' } }]);
    const error = await client.query('messages.list', { projectId }).catch(e => e);
    expect(error).toMatchObject({ code: 'FORBIDDEN', retryable: false }); expect(error.message).not.toContain(secretMarker); expect(requests).toHaveLength(1);
  });
  it('retries an ambiguous disband with the same actor-scoped intent and does not invent success', async () => {
    const { client, requests } = transport([
      { status: 503, body: {} }, { status: 503, body: {} },
      { status: 200, body: { id: projectId, status: 'archived' } },
    ]);
    await expect(client.command('project.disband', { id: projectId })).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    await expect(client.command('project.disband', { id: projectId })).resolves.toEqual({ id: projectId, status: 'archived' });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[1]?.body).toEqual(requests[2]?.body);
    expect(requests[0]?.body).toMatchObject({ operation: 'project.disband', payload: { id: projectId } });
  });
  it('rejects disband identity injection before HTTP and retains server owner rejection', async () => {
    const { client, requests } = transport([{ status: 400, body: { code: 'P0001', message: 'FORBIDDEN' } }]);
    await expect(client.command('project.disband', { id: projectId, ownerId: userId } as { id: string })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(requests).toHaveLength(0);
    await expect(client.command('project.disband', { id: projectId })).rejects.toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(requests).toHaveLength(1);
  });
  it('maps DB domain exceptions to stable errors without automatic demo fallback', async () => {
    const { client, requests } = transport([{ status: 400, body: { code: 'P0001', message: 'FULL' } }]);
    await expect(client.command('invitation.respond', { id: projectId, decision: 'accepted' }, randomUUID())).rejects.toMatchObject({ code: 'FULL' });
    expect(client.mode).toBe('supabase'); expect(requests).toHaveLength(1);
  });
  it('stops after the bounded transport retry count', async () => {
    const { client, requests } = transport([{ status: 503, body: {} }, { status: 503, body: {} }]);
    await expect(client.query('projects.search', {})).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true }); expect(requests).toHaveLength(2);
  });
  it('rejects an already cancelled query without making an HTTP request', async () => {
    const { client, requests } = transport([]); const abort = new AbortController(); abort.abort();
    await expect(client.query('projects.search', {}, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(requests).toHaveLength(0);
  });
  it('rejects invalid input before HTTP and rejects missing service settings rather than returning fixtures', async () => {
    const { client, requests } = transport([]);
    await expect(client.query('people.search', { limit: 51 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.command('message.send', { projectId, body: '   ', clientId: randomUUID() })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(() => createDataClient({ mode: 'supabase', environment: 'development' })).toThrow(); expect(requests).toHaveLength(0);
  });
});

describe('Auth and upload SDK boundary (mock SDK, no provider contact)', () => {
  it('recovers a failed initial session lookup and invalidates snapshots after reconnecting', async () => {
    vi.useFakeTimers();
    const session = { access_token: 'fictional-token', user: { id: userId } } as Session;
    const getSession = vi.fn().mockResolvedValueOnce({ data: { session: null }, error: new TypeError('Failed to fetch') }).mockResolvedValue({ data: { session }, error: null });
    const channel = { on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockImplementation((listener: (status: string) => void) => { listener('SUBSCRIBED'); return channel; });
    const removeChannel = vi.fn().mockResolvedValue('ok');
    const authUnsubscribe = vi.fn();
    const sdk = { auth: { getSession, onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: authUnsubscribe } } }) }, channel: vi.fn().mockReturnValue(channel), removeChannel } as unknown as SupabaseClient;
    const client = createSupabaseClient({ url: endpoint, anonKey: 'sb_publishable_contract_fixture', supabase: sdk }); clients.push(client);
    const listener = vi.fn(); const unsubscribe = client.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0); expect(client.connectionState).toBe('offline'); expect(getSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(client.connectionState).toBe('connected'); expect(getSession).toHaveBeenCalledTimes(2);
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', { event: 'INSERT', schema: 'public', table: 'change_events', filter: `user_id=eq.${userId}` }, expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ scope: '*' });
    unsubscribe(); expect(removeChannel).toHaveBeenCalledWith(channel);
    await vi.advanceTimersByTimeAsync(30000); expect(getSession).toHaveBeenCalledTimes(2);
    client.dispose(); expect(authUnsubscribe).toHaveBeenCalledOnce();
  });

  it('cannot establish a late session after the visible OTP operation timed out', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.ZmFrZQ`;
    let operationSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      operationSignal = init?.signal;
      // Deliberately ignore abort to model a transport that delivers too late.
      await new Promise(resolve => setTimeout(resolve, 220));
      return new Response(JSON.stringify({ access_token: jwt, token_type: 'bearer', refresh_token: 'fictional-refresh-token', expires_in: 3600, expires_at: now + 3600, user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'fictional@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const client = createSupabaseClient({ url: endpoint, anonKey: 'sb_publishable_contract_fixture', fetch: fetcher, timeoutMs: 100 }); clients.push(client);
    await expect(client.verifyOtp('fictional@example.invalid', '123456')).rejects.toMatchObject({ code: 'NETWORK' });
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(operationSignal).toBeInstanceOf(AbortSignal); expect(operationSignal?.aborted).toBe(true);
    await expect(client.getSession()).resolves.toBeNull();
  });

  it('requests a real OTP operation once and blocks immediate duplicate requests', async () => {
    const { client, auth } = fakeAuth();
    await client.requestOtp('  FICTIONAL@example.invalid  ');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'fictional@example.invalid', options: { shouldCreateUser: true } });
    await expect(client.requestOtp('fictional@example.invalid')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });
  it('does not fabricate a session when the provider returns no session or expired OTP', async () => {
    const { client } = fakeAuth(); await expect(client.verifyOtp('fictional@example.invalid', '123456')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(normalizeError({ code: 'otp_expired', message: 'sensitive detail' })).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('surfaces missing authentication and invalid content before upload', async () => {
    const { client } = fakeAuth();
    await expect(client.uploadAvatar(new ArrayBuffer(0), 'image/png')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.uploadAvatar(new ArrayBuffer(16), 'image/png')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('passes authenticated binary upload to the server validator and checks the returned owner path', async () => {
    const session = { access_token: 'fictional-token', user: { id: userId } } as Session;
    const sdk = { auth: { getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }) } } as unknown as SupabaseClient;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ path: `${userId}/${projectId}.png`, mimeType: 'image/png', width: 32, height: 32 }), { status: 200 }));
    const client = createSupabaseClient({ url: endpoint, anonKey: 'sb_publishable_contract_fixture', supabase: sdk, fetch: fetcher }); clients.push(client);
    await expect(client.uploadAvatar(new ArrayBuffer(32), 'image/png')).resolves.toMatchObject({ width: 32, height: 32 });
    expect(fetcher).toHaveBeenCalledWith(`${endpoint}/functions/v1/image-upload`, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer fictional-token', 'Content-Type': 'image/png' }) }));
  });
});
