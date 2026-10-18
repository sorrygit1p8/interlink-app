/** Structural boundary keeps the data package independent of the UI framework. */
interface QueryCache {
  cancelQueries(): Promise<void>;
  invalidateQueries(): Promise<void>;
}

/** Realtime carries invalidation metadata; every visible value comes from a DB query.
 * invalidateQueries alone can reuse an initial, still-running snapshot from before
 * SUBSCRIBED. Cancel that snapshot first, then fetch after the subscription barrier.
 */
export function createQueryReconciler(cache: QueryCache) {
  let disposed = false;
  let pending = false;
  let running = false;

  async function reconcile() {
    try {
      while (pending && !disposed) {
        pending = false;
        await cache.cancelQueries();
        if (disposed) return;
        // A burst during this fetch becomes one trailing reconciliation. Let the
        // fresh fetch finish instead of cancelling on every incoming event.
        await cache.invalidateQueries();
      }
    } finally {
      running = false;
      if (pending && !disposed) request();
    }
  }

  function request() {
    if (disposed) return;
    pending = true;
    if (running) return;
    running = true;
    // QueryClient stores transport failures on the queries for the existing
    // error/retry UI; a subscription callback must not reject asynchronously.
    void reconcile().catch(() => undefined);
  }

  return {
    request,
    dispose() { disposed = true; pending = false; },
  };
}
