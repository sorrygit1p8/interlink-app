import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAndRefresh, createInviteIntent } from '../../apps/web/lib/operations-actions';

afterEach(() => { vi.useRealTimers(); });
describe('operations mutation outcome and invitation retry intent', () => {
  it('preserves confirmed success and clears the form even when the next read fails', async () => {
    const onApplied = vi.fn(); const failure = new Error('offline');
    const outcome = await applyAndRefresh(async () => ({ id: 'created-community' }), async () => { throw failure; }, onApplied);
    expect(outcome).toEqual({ result: { id: 'created-community' }, refreshError: failure });
    expect(onApplied).toHaveBeenCalledWith({ id: 'created-community' });
  });
  it('does not clear a form or refresh when the mutation outcome is unknown', async () => {
    const refresh = vi.fn(); const onApplied = vi.fn();
    await expect(applyAndRefresh(async () => { throw new Error('lost response'); }, refresh, onApplied)).rejects.toThrow('lost response');
    expect(refresh).not.toHaveBeenCalled(); expect(onApplied).not.toHaveBeenCalled();
  });
  it('reuses the exact expiry and key across a delayed retry', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const intent = createInviteIntent(); const first = intent.prepare('community-id', 2, 1);
    vi.advanceTimersByTime(60_000);
    expect(intent.prepare('community-id', 2, 1)).toBe(first);
    expect(first.input.expiresAt).toBe('2026-10-19T00:00:00.000Z');
  });
  it('starts a new intent after an edited form or confirmed success', () => {
    const intent = createInviteIntent(); const first = intent.prepare('community-id', 2, 1);
    const changed = intent.prepare('community-id', 3, 1);
    expect(changed.key).not.toBe(first.key); expect(changed.input.maxUses).toBe(3);
    intent.complete(); expect(intent.prepare('community-id', 3, 1).key).not.toBe(changed.key);
  });
});
