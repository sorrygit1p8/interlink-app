import { NextRequest } from 'next/server';
import type { Session } from '@supabase/supabase-js';
import type { CommandMap, CommandName, QueryMap, QueryName } from '@interlink/shared';
import { authenticated, authorizedAdmin, dataFor, HttpError, readBody, safeError, sessionResponse } from '../../../lib/server-auth';

export const dynamic = 'force-dynamic';
const queries = new Set(['admin.overview', 'admin.reports', 'admin.report', 'admin.audit', 'admin.jobs', 'admin.communities']);
const commands = new Set(['admin.action', 'admin.community', 'admin.invite', 'admin.job.retry']);

export async function POST(request: NextRequest) {
  let renewedSession: Session | undefined;
  try {
    const body = await readBody(request);
    if (typeof body.name !== 'string' || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) throw new HttpError(400, 'VALIDATION', '요청 형식이 올바르지 않습니다.');
    const auth = await authenticated();
    renewedSession = auth.session;
    const { client, session } = await authorizedAdmin(auth);
    const data = dataFor(client);
    if (body.type === 'query' && queries.has(body.name)) {
      const result = await data.query(body.name as QueryName, body.input as QueryMap[QueryName]['input']);
      return sessionResponse({ result }, session);
    }
    if (body.type === 'command' && commands.has(body.name)) {
      if (typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) throw new HttpError(400, 'VALIDATION', '유효한 요청 식별자가 필요합니다.');
      const result = await data.command(body.name as CommandName, body.input as CommandMap[CommandName]['input'], body.idempotencyKey);
      return sessionResponse({ result }, session);
    }
    throw new HttpError(403, 'FORBIDDEN', '허용하지 않는 운영 작업입니다.');
  } catch (error) { return safeError(error, renewedSession); }
}
