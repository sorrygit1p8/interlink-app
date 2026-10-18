import type { CommandMap } from '@interlink/shared';

/** A confirmed write stays successful even when the following read fails. */
export async function applyAndRefresh<T>(apply: () => Promise<T>, refresh: () => Promise<void>, onApplied?: (result: T) => void) {
  const result = await apply();
  onApplied?.(result);
  try { await refresh(); return { result }; }
  catch (refreshError) { return { result, refreshError }; }
}

/** Relative expiry must be frozen while the outcome of this intent is unknown. */
export function createInviteIntent() {
  let pending: { fingerprint: string; input: CommandMap['admin.invite']['input']; key: string } | undefined;
  return {
    prepare(communityId: string, maxUses: number, days: number) {
      const fingerprint = JSON.stringify([communityId, maxUses, days]);
      if (!pending || pending.fingerprint !== fingerprint) pending = {
        fingerprint, key: crypto.randomUUID(),
        input: { communityId, maxUses, expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() },
      };
      return pending;
    },
    complete() { pending = undefined; },
  };
}
