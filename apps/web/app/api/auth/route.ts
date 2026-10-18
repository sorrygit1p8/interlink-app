import { NextRequest } from 'next/server';
import type { Session } from '@supabase/supabase-js';
import { authenticated, HttpError, newAuthClient, readBody, safeError, sessionResponse, signedOutResponse } from '../../../lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let renewedSession: Session | undefined;
  try {
    const body = await readBody(request);
    if (body.action === 'signout') {
      // Local logout must remain possible after expiry or an Auth outage.
      // Keep same-origin validation above, and attempt upstream revocation.
      try {
        const { client } = await authenticated();
        const result = await client.auth.signOut({ scope: 'local' });
        if (!result.error) return signedOutResponse();
      } catch (error) {
        if (error instanceof HttpError && error.code === 'UNAUTHENTICATED') return signedOutResponse();
      }
      return signedOutResponse('이 브라우저에서 로그아웃했습니다. 인증 서버의 세션 종료는 확인하지 못했습니다.');
    }
    if (body.action === 'send') {
      if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new HttpError(400, 'VALIDATION', '올바른 이메일 주소를 입력해 주세요.');
      const result = await newAuthClient().auth.signInWithOtp({ email: body.email.trim(), options: { shouldCreateUser: false } });
      if (result.error) throw new HttpError(result.error.status === 429 ? 429 : 400, 'AUTH_FAILED', '인증 메일을 요청하지 못했습니다. 계정과 메일 설정을 확인해 주세요.');
      return sessionResponse({ ok: true, message: '등록된 계정에 인증 메일을 요청했습니다. 받은 인증 코드를 입력해 주세요.' });
    }
    if (body.action === 'verify') {
      if (typeof body.email !== 'string' || typeof body.token !== 'string' || !/^\d{6,10}$/.test(body.token)) throw new HttpError(400, 'VALIDATION', '이메일과 6~10자리 인증 코드를 확인해 주세요.');
      const result = await newAuthClient().auth.verifyOtp({ email: body.email, token: body.token, type: 'email' });
      if (result.error || !result.data.session) throw new HttpError(401, 'UNAUTHENTICATED', '인증 코드가 올바르지 않거나 만료되었습니다.');
      return sessionResponse({ ok: true }, result.data.session);
    }
    const { client, session } = await authenticated();
    renewedSession = session;
    if (body.action === 'mfaEnroll') {
      const factors = await client.auth.mfa.listFactors();
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (factors.error || assurance.error) throw new HttpError(503, 'UNAVAILABLE', '추가 인증 설정을 확인하지 못했습니다.');
      if (factors.data.all.some((item) => item.status === 'verified') && assurance.data.currentLevel !== 'aal2') {
        throw new HttpError(403, 'MFA_REQUIRED', '이미 등록한 인증 수단으로 추가 인증한 뒤 새 인증 앱을 등록할 수 있습니다.');
      }
      const enrollment = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Inter-Link operations', issuer: 'Inter-Link' });
      if (enrollment.error) throw new HttpError(400, 'MFA_FAILED', '인증 앱 등록을 시작하지 못했습니다. 기존 인증 수단을 확인해 주세요.');
      return sessionResponse({ factorId: enrollment.data.id, qrCode: enrollment.data.totp.qr_code, secret: enrollment.data.totp.secret }, session);
    }
    if (body.action === 'mfaChallenge') {
      if (typeof body.factorId !== 'string') throw new HttpError(400, 'VALIDATION', '인증 수단을 선택해 주세요.');
      const challenge = await client.auth.mfa.challenge({ factorId: body.factorId });
      if (challenge.error) throw new HttpError(400, 'MFA_FAILED', '추가 인증을 시작하지 못했습니다.');
      return sessionResponse({ challengeId: challenge.data.id, factorId: body.factorId }, session);
    }
    if (body.action === 'mfaVerify') {
      if (typeof body.factorId !== 'string' || typeof body.challengeId !== 'string' || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new HttpError(400, 'VALIDATION', '인증 앱의 6자리 코드를 입력해 주세요.');
      const result = await client.auth.mfa.verify({ factorId: body.factorId, challengeId: body.challengeId, code: body.code });
      if (result.error) throw new HttpError(401, 'MFA_FAILED', '추가 인증 코드가 올바르지 않거나 만료되었습니다.');
      const refreshed = await client.auth.getSession();
      if (!refreshed.data.session) throw new HttpError(401, 'UNAUTHENTICATED', '인증 세션을 복원하지 못했습니다.');
      return sessionResponse({ ok: true }, refreshed.data.session);
    }
    throw new HttpError(400, 'VALIDATION', '지원하지 않는 인증 요청입니다.');
  } catch (error) { return safeError(error, renewedSession); }
}
