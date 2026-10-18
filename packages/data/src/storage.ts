/** AsyncStorage-compatible storage. Session and demo keys are deliberately separate. */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface SecureStoreDriver {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * SecureStore historically has per-entry limits. Store UTF-16-safe small chunks
 * and publish metadata last, keeping the previous session intact on write error.
 * Drivers should use WHEN_UNLOCKED_THIS_DEVICE_ONLY on iOS.
 */
export function createSecureStorageAdapter(driver: SecureStoreDriver): StorageAdapter {
  const name = (key: string) => `interlink.secure.${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const readMeta = async (base: string): Promise<{ revision: string; count: number } | null> => {
    const raw = await driver.getItemAsync(base);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { revision: string; count: number };
      if (!/^[a-z0-9]+$/.test(parsed.revision) || !Number.isInteger(parsed.count) || parsed.count < 0 || parsed.count > 256) return null;
      return parsed;
    } catch { return null; }
  };
  const removeChunks = async (base: string, meta: { revision: string; count: number } | null) => {
    if (meta) await Promise.all(Array.from({ length: meta.count }, (_, i) => driver.deleteItemAsync(`${base}.${meta.revision}.${i}`)));
  };
  // Auth may read while a refresh retires old chunks. Keep the metadata read and
  // all of its chunk reads in the same queue as writes and sign-out removal.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  };
  return {
    getItem: (key) => enqueue(async () => {
      const base = name(key);
      const meta = await readMeta(base);
      if (!meta) return null;
      const values = await Promise.all(Array.from({ length: meta.count }, (_, i) => driver.getItemAsync(`${base}.${meta.revision}.${i}`)));
      return values.some((value) => value === null) ? null : values.join('');
    }),
    setItem: (key, value) => enqueue(async () => {
      const base = name(key);
      const previous = await readMeta(base);
      const revision = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      const characters = Array.from(value);
      const chunks = Array.from({ length: Math.ceil(characters.length / 400) }, (_, index) => characters.slice(index * 400, (index + 1) * 400).join(''));
      if (chunks.length > 256) throw new Error('Session exceeds protected storage limit');
      try {
        for (let i = 0; i < chunks.length; i++) await driver.setItemAsync(`${base}.${revision}.${i}`, chunks[i]!);
        await driver.setItemAsync(base, JSON.stringify({ revision, count: chunks.length }));
      } catch (error) {
        await removeChunks(base, { revision, count: chunks.length }).catch(() => undefined);
        throw error;
      }
      // Old encrypted chunks contain expired sessions and must not linger.
      await removeChunks(base, previous);
    }),
    removeItem: (key) => enqueue(async () => {
      const base = name(key);
      const meta = await readMeta(base);
      await driver.deleteItemAsync(base);
      await removeChunks(base, meta);
    }),
  };
}

export function createMemoryStorage(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** Wrap browser localStorage for demo only; use server cookies for web auth. */
export function createBrowserDemoStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): StorageAdapter {
  return {
    getItem: (key) => storage.getItem(`interlink.demo.${key}`),
    setItem: (key, value) => storage.setItem(`interlink.demo.${key}`, value),
    removeItem: (key) => storage.removeItem(`interlink.demo.${key}`),
  };
}
