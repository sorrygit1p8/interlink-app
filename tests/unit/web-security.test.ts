import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Isolated server-control-flow tests. These mocks do not verify Auth, JWT signatures or RLS.
const mock = vi.hoisted(() => {
  const session = { access_token: 'fictional-renewed-access', refresh_token: 'fictional-renewed-refresh', expires_in: 3600, token_type: 'bearer', user: { id: '10000000-0000-4000-8000-000000000004' } };
  const auth = {
    setSession: vi.fn(), refreshSession: vi.fn(), getUser: vi.fn(), getSession: vi.fn(),
    mfa: { getAuthenticatorAssuranceLevel: vi.fn(), listFactors: vi.fn(), enroll: vi.fn() },
  };
  return { session, auth, sdk: { auth }, cookieValues: new Map<string, string>(), createClient: vi.fn(), query: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => mock.cookieValues.has(name) ? { value: mock.cookieValues.get(name) } : undefined }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('@interlink/data/supabase', () => ({ createSupabaseClient: () => ({ query: mock.query }) }));

import { serverSupabaseConfig, webConfig } from '../../apps/web/lib/config';
import { accountStatusWithExistingToken, authenticated, authorizedAdmin, assertOrigin, HttpError, safeError } from '../../apps/web/lib/server-auth';
import { POST as authPost } from '../../apps/web/app/api/auth/route';
import { GET as sessionGet } from '../../apps/web/app/api/session/route';
import { GET as accountGet } from '../../apps/web/app/api/account/route';

beforeEach(() => {
  vi.resetAllMocks(); mock.cookieValues.clear();
  vi.stubEnv('INTERLINK_DATA_MODE', 'supabase'); vi.stubEnv('INTERLINK_APP_ENV', 'staging');
  vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid'); vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_unit_fixture');
  mock.cookieValues.set('interlink-access', 'fictional-existing-access'); mock.cookieValues.set('interlink-refresh', 'fictional-existing-refresh');
  mock.createClient.mockReturnValue(mock.sdk);
  mock.auth.setSession.mockResolvedValue({ data: { session: mock.session }, error: null });
  mock.auth.refreshSession.mockResolvedValue({ data: { session: mock.session }, error: null });
  mock.auth.getUser.mockResolvedValue({ data: { user: mock.session.user }, error: null });
  mock.auth.getSession.mockResolvedValue({ data: { session: mock.session }, error: null });
  mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null });
  mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  mock.query.mockResolvedValue({ userId: mock.session.user.id, role: 'admin', mfa: true });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('operations server configuration and authorization boundaries', () => {
  it('rejects production demo and does not turn real configuration failures into demo mode', () => {
    vi.stubEnv('INTERLINK_APP_ENV', 'production'); vi.stubEnv('INTERLINK_DATA_MODE', 'demo');
    expect(() => webConfig()).toThrow('운영 환경에서는 데모');
    vi.stubEnv('INTERLINK_DATA_MODE', 'supabase'); vi.stubEnv('SUPABASE_ANON_KEY', '');
    expect(() => serverSupabaseConfig()).toThrow('SUPABASE_URL / SUPABASE_ANON_KEY');
    expect(webConfig().mode).toBe('supabase');
  });
  it.each(['sb_secret_not_a_credential', ' sb_secret_not_a_credential', 'sb_publishable_unit_fixture '])('rejects a server secret or whitespace-bearing public key: %s', (key) => {
    vi.stubEnv('SUPABASE_ANON_KEY', key); expect(() => serverSupabaseConfig()).toThrow('CONFIGURATION');
  });
  it('rejects service-role JWT keys and loopback production endpoints', () => {
    vi.stubEnv('SUPABASE_ANON_KEY', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`);
    expect(() => serverSupabaseConfig()).toThrow('서비스 역할 키');
    vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_unit_fixture'); vi.stubEnv('INTERLINK_APP_ENV', 'production'); vi.stubEnv('SUPABASE_URL', 'https://localhost');
    expect(() => serverSupabaseConfig()).toThrow('외부에서 접근 가능한');
  });
  it('restores a session from the refresh cookie after the access cookie expires and validates getUser', async () => {
    mock.cookieValues.delete('interlink-access');
    await expect(authenticated()).resolves.toMatchObject({ user: { id: mock.session.user.id } });
    expect(mock.auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'fictional-existing-refresh' });
    expect(mock.auth.setSession).not.toHaveBeenCalled(); expect(mock.auth.getUser).toHaveBeenCalledOnce();
  });
  it('does not authorize a locally decoded session without authoritative user validation', async () => {
    mock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    await expect(authenticated()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('keeps Auth transport outages distinct from an expired login', async () => {
    mock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 0, name: 'AuthRetryableFetchError' } });
    await expect(authenticated()).rejects.toMatchObject({ status: 503, code: 'NETWORK' });
  });
  it('requires AAL2 before querying the administrator role grant', async () => {
    mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null });
    await expect(authorizedAdmin()).rejects.toMatchObject({ code: 'MFA_REQUIRED' }); expect(mock.query).not.toHaveBeenCalled();
  });
  it('rejects a role grant response belonging to a different account', async () => {
    mock.query.mockResolvedValue({ userId: 'other-account', role: 'admin', mfa: true });
    await expect(authorizedAdmin()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mock.query).toHaveBeenCalledWith('admin.session', {});
  });
  it('requires existing MFA before enrolling an additional factor', async () => {
    mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null });
    mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [{ id: 'verified-factor', status: 'verified' }], totp: [] }, error: null });
    const request = new NextRequest('https://app.fixture.invalid/api/auth', { method: 'POST', headers: { Origin: 'https://app.fixture.invalid', Host: 'app.fixture.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mfaEnroll' }) });
    const response = await authPost(request);
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe('MFA_REQUIRED'); expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
  });
  it('reports authorization service outages as retryable errors rather than no administrator role', async () => {
    mock.query.mockRejectedValue({ code: 'NETWORK' });
    const response = await sessionGet();
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('NETWORK');
    expect(response.headers.get('set-cookie')).toContain('fictional-renewed-refresh');
  });
  it('persists rotated session cookies even if the following domain command is forbidden', async () => {
    const response = safeError(new HttpError(403, 'FORBIDDEN', '권한 없음'), mock.session as Awaited<ReturnType<typeof authenticated>>['session']);
    expect(response.status).toBe(403); expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure'); expect(response.headers.get('set-cookie')).toContain('fictional-renewed-refresh');
  });
  it('rejects cross-origin JSON before any authenticated operation', () => {
    const request = new NextRequest('https://app.fixture.invalid/api/data', { method: 'POST', headers: { Origin: 'https://attacker.invalid', Host: 'app.fixture.invalid', 'Content-Type': 'application/json' } });
    expect(() => assertOrigin(request)).toThrow('동일한 사이트');
  });
});

describe('narrow deletion-status proof after external Auth erasure', () => {
  it('forwards only the existing token to the self-scoped status RPC without a client-supplied account id', async () => {
    mock.query.mockResolvedValue({ status: 'deleted', deletionStatus: 'completed' });
    await expect(accountStatusWithExistingToken()).resolves.toMatchObject({ status: 'deleted', deletionStatus: 'completed' });
    const options = mock.createClient.mock.calls[0]?.[2] as { accessToken: () => Promise<string> };
    expect(await options.accessToken()).toBe('fictional-existing-access');
    expect(mock.query).toHaveBeenCalledExactlyOnceWith('account.status', {}); expect(mock.auth.getUser).not.toHaveBeenCalled();
  });
  it('allows verified-by-PostgREST status polling after getUser reports the identity was removed', async () => {
    mock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    mock.query.mockResolvedValue({ status: 'deleted', deletionStatus: 'completed' });
    const response = await accountGet(); expect(response.status).toBe(200); expect((await response.json()).result.deletionStatus).toBe('completed');
    expect(mock.query).toHaveBeenCalledExactlyOnceWith('account.status', {});
  });
  it('never treats expired or absent proof as completed deletion', async () => {
    mock.cookieValues.clear();
    const response = await accountGet(); expect(response.status).toBe(401); expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mock.query).not.toHaveBeenCalled();
  });
});
