import type { AccountStatus } from '@interlink/shared';
import { api, BrowserApiError } from './browser-client';

export type SessionInfo = { authenticated: boolean; admin: boolean; mfa: boolean; factors: { id: string; name: string; status: string }[] };
export type BrowserSession = { kind: 'authenticated'; session: SessionInfo } | { kind: 'anonymous' } | { kind: 'deletion-status' };

/** Only a confirmed authentication failure permits the login form. Transport
 * failures must remain retryable, including the narrow post-deletion proof. */
export async function readBrowserSession(allowDeletionStatus = false): Promise<BrowserSession> {
  try {
    const session = await api<SessionInfo>('/api/session');
    return session.authenticated ? { kind: 'authenticated', session } : { kind: 'anonymous' };
  } catch (error) {
    if (!(error instanceof BrowserApiError) || error.code !== 'UNAUTHENTICATED') throw error;
    if (!allowDeletionStatus) return { kind: 'anonymous' };
    try {
      const { result } = await api<{ result: AccountStatus }>('/api/account');
      return result.status === 'deleting' || result.status === 'deleted' ? { kind: 'deletion-status' } : { kind: 'anonymous' };
    } catch (statusError) {
      if (statusError instanceof BrowserApiError && statusError.code === 'UNAUTHENTICATED') return { kind: 'anonymous' };
      throw statusError;
    }
  }
}
