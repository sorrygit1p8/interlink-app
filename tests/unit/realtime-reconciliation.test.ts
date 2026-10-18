import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryReconciler } from '@interlink/data';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); });

function fixture() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reconciler = createQueryReconciler(cache);
  const snapshots: Array<ReturnType<typeof deferred<string>>> = [];
  const signals: AbortSignal[] = [];
  const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signals.push(signal);
    const next = deferred<string>(); snapshots.push(next);
    // Intentionally ignores abort: an obsolete response must still not win.
    return next.promise;
  });
  const observer = new QueryObserver(cache, { queryKey: ['supabase', 'account-A', 'messages'], queryFn, staleTime: 15000 });
  const unsubscribe = observer.subscribe(() => undefined);
  cleanups.push(() => cache.clear(), () => reconciler.dispose(), unsubscribe);
  return { cache, reconciler, snapshots, signals, queryFn };
}

describe('Realtime snapshot reconciliation with the installed TanStack Query client', () => {
  it('replaces an initial pre-subscription request and ignores its late stale response', async () => {
    const { cache, reconciler, snapshots, signals, queryFn } = fixture();
    expect(queryFn).toHaveBeenCalledTimes(1);
    // SUBSCRIBED happens after a DB change missed by the original snapshot.
    reconciler.request();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);
    snapshots[1].resolve('current-after-subscription');
    await vi.waitFor(() => expect(cache.getQueryData(['supabase', 'account-A', 'messages'])).toBe('current-after-subscription'));
    snapshots[0].resolve('old-before-subscription');
    await Promise.resolve();
    expect(cache.getQueryData(['supabase', 'account-A', 'messages'])).toBe('current-after-subscription');
  });

  it('coalesces events while a fresh query runs and reconciles once more without starving that query', async () => {
    const { cache, reconciler, snapshots, signals, queryFn } = fixture();
    reconciler.request();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    for (let index = 0; index < 50; index++) reconciler.request();
    expect(signals[1].aborted).toBe(false);
    expect(queryFn).toHaveBeenCalledTimes(2);
    snapshots[1].resolve('first-fresh-snapshot');
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
    expect(cache.getQueryData(['supabase', 'account-A', 'messages'])).toBe('first-fresh-snapshot');
    snapshots[2].resolve('includes-burst');
    await vi.waitFor(() => expect(cache.getQueryData(['supabase', 'account-A', 'messages'])).toBe('includes-burst'));
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it('does not restart queries after disposal or restore a cleared previous-account cache', async () => {
    const { cache, reconciler, snapshots, queryFn } = fixture();
    reconciler.request();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    reconciler.request();
    reconciler.dispose();
    cache.clear();
    snapshots[0].resolve('old account before subscription');
    snapshots[1].resolve('old account after subscription');
    await Promise.resolve();
    reconciler.request();
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });

  it('stops before the replacement fetch when disposed during the cancellation barrier', async () => {
    const { reconciler, queryFn } = fixture();
    reconciler.request();
    reconciler.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
