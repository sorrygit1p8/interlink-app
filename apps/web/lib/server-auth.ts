import 'server-only';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '@interlink/data/supabase';
import { serverSupabaseConfig } from './config';

const accessCookie = 'interlink-access';
const refreshCookie = 'interlink-refresh';
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function checkAuthServiceError(error: { status?: number; name?: string } | null) {
  if (!error) return;
  if (error.status === 429) throw new HttpError(429, 'RATE_LIMITED', '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.');
  if (error.status === 0 || (error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError') {
    throw new HttpError(503, 'NETWORK', '인증 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.');
  }
}

export function newAuthClient() {
  const { url, anonKey } = serverSupabaseConfig();
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) },
  });
}

export function dataFor(client: SupabaseClient) {
  const { url, anonKey } = serverSupabaseConfig();
  return createSupabaseClient({ url, anonKey, supabase: client });
}

/** A deleted Auth identity cannot pass getUser. This narrowly scoped read forwards
 * the existing signed token to PostgREST, which validates its signature/expiry.
 * The RPC derives auth.uid() and returns only that account's deletion state.
 * This client is never returned or used for writes or admin authorization.
 */
export async function accountStatusWithExistingToken() {
  const access = (await cookies()).get(accessCookie)?.value;
  if (!access) throw new HttpError(401, 'UNAUTHENTICATED', '인증 세션이 만료되어 삭제 상태를 확인할 수 없습니다. 만료를 삭제 완료로 판단하지 않습니다.');
  const { url, anonKey } = serverSupabaseConfig();
  const client = createClient(url, anonKey, {
    accessToken: async () => access,
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) },
  });
  return dataFor(client).query('account.status', {});
}

export async function authenticated() {
  const store = await cookies();
  const access = store.get(accessCookie)?.value;
  const refresh = store.get(refreshCookie)?.value;
  if (!refresh) throw new HttpError(401, 'UNAUTHENTICATED', '이메일로 본인 확인을 해 주세요.');
  const client = newAuthClient();
  const { data, error } = access
    ? await client.auth.setSession({ access_token: access, refresh_token: refresh })
    : await client.auth.refreshSession({ refresh_token: refresh });
  checkAuthServiceError(error);
  if (error || !data.session) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 만료되었습니다. 다시 본인 확인을 해 주세요.');
  const user = await client.auth.getUser();
  checkAuthServiceError(user.error);
  if (user.error || !user.data.user) throw new HttpError(401, 'UNAUTHENTICATED', '본인 확인에 실패했습니다. 다시 로그인해 주세요.');
  return { client, session: data.session, user: user.data.user };
}

export async function authorizedAdmin(existing?: Awaited<ReturnType<typeof authenticated>>) {
  const auth = existing ?? await authenticated();
  const assurance = await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || assurance.data?.currentLevel !== 'aal2') {
    throw new HttpError(403, 'MFA_REQUIRED', '운영 도구에 접근하려면 인증 앱으로 추가 인증해 주세요.');
  }
  // The database checks the authenticated role grant and AAL2 independently.
  // No email, client-supplied role or demo actor can grant this permission.
  const authorization = await dataFor(auth.client).query('admin.session', {});
  if (authorization.userId !== auth.user.id || authorization.role !== 'admin' || authorization.mfa !== true) {
    throw new HttpError(403, 'FORBIDDEN', '이 계정에는 운영 권한이 없습니다.');
  }
  return auth;
}

export function sessionResponse(body: unknown, session?: Session | null, status = 200) {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (session) {
    const secure = process.env.INTERLINK_APP_ENV === 'production' || process.env.INTERLINK_APP_ENV === 'staging';
    const options = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/' };
    response.cookies.set(accessCookie, session.access_token, { ...options, maxAge: session.expires_in });
    response.cookies.set(refreshCookie, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
  }
  return response;
}

export function signedOutResponse(message?: string) {
  const response = sessionResponse({ ok: true, ...(message ? { message } : {}) });
  response.cookies.delete(accessCookie);
  response.cookies.delete(refreshCookie);
  return response;
}

export function assertOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  let originHost: string | undefined;
  try { if (origin) originHost = new URL(origin).host; } catch { originHost = undefined; }
  if (!originHost || !host || originHost !== host || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'FORBIDDEN', '동일한 사이트에서 다시 요청해 주세요.');
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'VALIDATION', 'JSON 요청만 지원합니다.');
  }
}

export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  assertOrigin(request);
  const body = await request.text();
  if (body.length > 32_768) throw new HttpError(413, 'VALIDATION', '요청 내용이 너무 깁니다.');
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, 'VALIDATION', '요청 형식이 올바르지 않습니다.'); }
}

export function safeError(error: unknown, session?: Session) {
  if (error instanceof HttpError) return sessionResponse({ error: { code: error.code, message: error.message } }, session, error.status);
  const candidate = (error ?? {}) as { code?: string; message?: string };
  if (candidate.message?.startsWith('CONFIGURATION:')) return sessionResponse({ error: { code: 'CONFIGURATION', message: candidate.message.replace('CONFIGURATION: ', '') } }, session, 503);
  const codes: Record<string, [number, string]> = {
    UNAUTHENTICATED: [401, '다시 로그인해 주세요.'], FORBIDDEN: [403, '이 작업에 대한 권한이 없습니다.'],
    VALIDATION: [400, '입력값을 확인해 주세요.'], NOT_FOUND: [404, '항목을 찾을 수 없습니다.'],
    RATE_LIMITED: [429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'],
    CONFLICT: [409, '상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'],
    DUPLICATE: [409, '이미 처리한 요청입니다.'], NETWORK: [503, '서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'],
  };
  const [status, message] = codes[candidate.code ?? ''] ?? [503, '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'];
  return sessionResponse({ error: { code: candidate.code && codes[candidate.code] ? candidate.code : 'UNAVAILABLE', message } }, session, status);
}
