import { NextRequest } from 'next/server';
import type { Session } from '@supabase/supabase-js';
import { accountStatusWithExistingToken, authenticated, dataFor, HttpError, readBody, safeError, sessionResponse } from '../../../lib/server-auth';

export const dynamic = 'force-dynamic';
export async function GET() {
  let renewedSession: Session | undefined;
  try {
    const { client, session } = await authenticated();
    renewedSession = session;
    return sessionResponse({ result: await dataFor(client).query('account.status', {}) }, session);
  } catch (error) {
    if ((error as { code?: string })?.code === 'UNAUTHENTICATED') {
      try { return sessionResponse({ result: await accountStatusWithExistingToken() }); }
      catch (statusError) { return safeError(statusError); }
    }
    return safeError(error, renewedSession);
  }
}
export async function POST(request: NextRequest) {
  let renewedSession: Session | undefined;
  try {
    const body = await readBody(request);
    if (body.confirmation !== 'DELETE' || body.ownedTeams !== 'archive') throw new HttpError(400, 'VALIDATION', '안내를 확인하고 DELETE를 입력해 주세요.');
    if (typeof body.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)) throw new HttpError(400, 'VALIDATION', '요청 식별자가 필요합니다.');
    const { client, session } = await authenticated();
    renewedSession = session;
    // Identity is derived by the authenticated RPC. No account/user id is accepted.
    const result = await dataFor(client).command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' }, body.idempotencyKey);
    return sessionResponse({ result }, session);
  } catch (error) { return safeError(error, renewedSession); }
}
