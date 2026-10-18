import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => {
  const session = { access_token: 'fictional-access', refresh_token: 'fictional-refresh', expires_in: 3600, user: { id: 'fixture-user' } };
  const auth = { setSession: vi.fn(), getUser: vi.fn(), signOut: vi.fn() };
  return { session, auth, createClient: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'fictional-token' }) }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('@interlink/data/supabase', () => ({ createSupabaseClient: vi.fn() }));

import { POST } from '../../apps/web/app/api/auth/route';
import { readBrowserSession } from '../../apps/web/lib/browser-session';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('INTERLINK_DATA_MODE', 'supabase'); vi.stubEnv('INTERLINK_APP_ENV', 'staging');
  vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid'); vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_fixture');
  mock.createClient.mockReturnValue({ auth: mock.auth });
  mock.auth.setSession.mockResolvedValue({ data: { session: mock.session }, error: null });
  mock.auth.getUser.mockResolvedValue({ data: { user: mock.session.user }, error: null });
  mock.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function signoutRequest(origin = 'https://app.fixture.invalid') {
  return new NextRequest('https://app.fixture.invalid/api/auth', { method: 'POST', headers: { Origin: origin, Host: 'app.fixture.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) });
}
function expectClearedCookies(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('interlink-access=;');
  expect(response.headers.get('set-cookie')).toContain('interlink-refresh=;');
  expect(response.headers.get('set-cookie')).not.toContain('fictional-refresh');
}

describe('logout always clears browser credentials after same-origin validation', () => {
  it('revokes a valid session and clears both cookies', async () => {
    expectClearedCookies(await POST(signoutRequest()));
    expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('clears expired credentials without requiring successful login', async () => {
    mock.auth.setSession.mockResolvedValue({ data: { session: null }, error: { status: 401 } });
    expectClearedCookies(await POST(signoutRequest()));
    expect(mock.auth.signOut).not.toHaveBeenCalled();
  });
  it.each(['authentication', 'revocation'])('clears local credentials and reports an upstream %s outage honestly', async (failure) => {
    if (failure === 'authentication') mock.auth.setSession.mockResolvedValue({ data: { session: null }, error: { status: 503 } });
    else mock.auth.signOut.mockResolvedValue({ error: { status: 503 } });
    const response = await POST(signoutRequest());
    expectClearedCookies(response);
    expect((await response.json()).message).toContain('인증 서버의 세션 종료는 확인하지 못했습니다');
  });
  it('still rejects cross-origin signout before touching cookies or the provider', async () => {
    const response = await POST(signoutRequest('https://untrusted.invalid'));
    expect(response.status).toBe(403); expect(response.headers.get('set-cookie')).toBeNull();
    expect(mock.createClient).not.toHaveBeenCalled();
  });
});

describe('session lookup distinguishes outages from a confirmed signed-out state', () => {
  it('does not use deletion proof or the login state when session transport fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetchMock);
    await expect(readBrowserSession(true)).rejects.toMatchObject({ code: 'NETWORK' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('accepts only an authenticated response as an active session', async () => {
    const session = { authenticated: true, admin: false, mfa: false, factors: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(session)));
    await expect(readBrowserSession()).resolves.toEqual({ kind: 'authenticated', session });
  });
  it('supports server-confirmed deletion after the Auth identity is removed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })).mockResolvedValueOnce(Response.json({ result: { status: 'deleted', deletionStatus: 'completed' } })));
    await expect(readBrowserSession(true)).resolves.toEqual({ kind: 'deletion-status' });
  });
  it('keeps deletion-status network failure retryable instead of showing login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })).mockRejectedValueOnce(new TypeError('offline')));
    await expect(readBrowserSession(true)).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('treats expired proof as unauthenticated, never as completed deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })));
    await expect(readBrowserSession(true)).resolves.toEqual({ kind: 'anonymous' });
  });
});
