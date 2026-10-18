import { authenticated, authorizedAdmin, safeError, sessionResponse } from '../../../lib/server-auth';
import type { Session } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export async function GET() {
  let renewedSession: Session | undefined;
  try {
    const auth = await authenticated();
    renewedSession = auth.session;
    const assurance = await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();
    const factors = await auth.client.auth.mfa.listFactors();
    if (assurance.error || factors.error) throw assurance.error ?? factors.error;
    let admin = false;
    if (assurance.data.currentLevel === 'aal2') {
      try { await authorizedAdmin(auth); admin = true; }
      catch (error) {
        if ((error as { code?: string })?.code === 'FORBIDDEN') admin = false;
        else throw error;
      }
    }
    return sessionResponse({ authenticated: true, admin, mfa: assurance.data.currentLevel === 'aal2', factors: factors.data.totp.map((factor) => ({ id: factor.id, name: factor.friendly_name ?? '인증 앱', status: factor.status })) }, auth.session);
  } catch (error) { return safeError(error, renewedSession); }
}
