import { afterEach, describe, expect, it } from 'vitest';
import { createSupabaseClient, type StorageAdapter, type SupabaseDataClient } from '@interlink/data';
import type { AppEnvironment } from '@interlink/shared';

const clients: SupabaseDataClient[] = [];
afterEach(() => clients.splice(0).forEach(client => client.dispose()));
const endpoint = 'https://original-project.invalid';
const publicKey = 'sb_publishable_scope_fixture';
const userId = '10000000-0000-4000-8000-000000000001';
function session() {
  const now = Math.floor(Date.now() / 1000);
  const access_token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, iss: `${endpoint}/auth/v1`, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.ZmFrZQ`;
  return { access_token, refresh_token: 'fictional-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}
function fixture() {
  const values = new Map<string, string>();
  const storage: StorageAdapter = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const authSession = session();
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    requests.push({ url: address, authorization: new Headers(init?.headers).get('Authorization') });
    return new Response(JSON.stringify(address.includes('/auth/v1/verify') ? authSession : { items: [], nextCursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = (url = endpoint, environment?: AppEnvironment) => {
    const result = createSupabaseClient({ url, anonKey: publicKey, environment, storage, fetch: fetcher });
    clients.push(result); return result;
  };
  return { values, client, requests, authSession };
}

describe('persistent session scope using the installed Supabase SDK and isolated fetch', () => {
  it('discards unscoped legacy credentials before any backend request and leaves demo data alone', async () => {
    const { values, client, requests, authSession } = fixture();
    values.set('interlink.supabase.session.v1', JSON.stringify(authSession));
    values.set('interlink.supabase.session.v1-code-verifier', 'fictional-old-verifier');
    values.set('interlink.supabase.session.v1-user', JSON.stringify({ user: authSession.user }));
    values.set('interlink.demo.state.v1', 'fictional-demo-preserved');
    const current = client('https://new-project.invalid', 'staging');
    await expect(current.getSession()).resolves.toBeNull();
    await current.query('notifications.list', {});
    expect(requests).toEqual([{ url: 'https://new-project.invalid/rest/v1/rpc/interlink_query', authorization: `Bearer ${publicKey}` }]);
    expect([...values.keys()]).toEqual(['interlink.demo.state.v1']);
  });

  it('restores the same endpoint/environment after restart without requiring another login', async () => {
    const { values, client, requests, authSession } = fixture();
    const first = client(endpoint, 'staging');
    await first.verifyOtp('fictional@example.invalid', '123456');
    first.dispose();
    expect([...values.keys()]).toHaveLength(1);
    expect([...values.keys()][0]).toMatch(/^interlink\.supabase\.staging\.session\.v2\.[0-9a-f]+$/);
    const restored = client(`${endpoint}/`, 'staging');
    await expect(restored.getSession()).resolves.toMatchObject({ access_token: authSession.access_token });
    await restored.query('notifications.list', {});
    expect(requests.filter(request => request.url.includes('/auth/v1/verify'))).toHaveLength(1);
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${authSession.access_token}`);
  });

  it.each([
    ['different host', 'https://new-project.invalid', 'staging'],
    ['different base path', `${endpoint}/another-backend`, 'staging'],
    ['different environment', endpoint, 'production'],
  ] as const)('never restores or forwards a previous token after changing %s', async (_name, url, environment) => {
    const { client, requests, authSession } = fixture();
    const first = client(endpoint, 'staging');
    await first.verifyOtp('fictional@example.invalid', '123456');
    first.dispose();
    requests.length = 0;
    const changed = client(url, environment);
    await expect(changed.getSession()).resolves.toBeNull();
    await changed.query('notifications.list', {});
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${publicKey}`);
    expect(requests[0].authorization).not.toContain(authSession.access_token);
    expect(requests[0].url).toBe(`${url}/rest/v1/rpc/interlink_query`);
  });

  it('uses the same scope for omitted and explicit development environment', async () => {
    const { client, authSession } = fixture();
    const first = client();
    await first.verifyOtp('fictional@example.invalid', '123456');
    first.dispose();
    await expect(client(endpoint, 'development').getSession()).resolves.toMatchObject({ access_token: authSession.access_token });
  });
});
