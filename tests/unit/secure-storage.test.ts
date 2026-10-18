import { describe, expect, it } from 'vitest';
import { createSecureStorageAdapter, createBrowserDemoStorage } from '@interlink/data';

function driver() {
  const values = new Map<string, string>();
  return { values, getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); } };
}
describe('protected session storage adapter (mock native driver)', () => {
  it('round-trips large sessions, cleans replaced chunks, and removes every chunk on signout', async () => {
    const native = driver(); const storage = createSecureStorageAdapter(native);
    const session = JSON.stringify({ token: 'test-token-'.repeat(1000), metadata: '가상 사용자 🟢'.repeat(400) });
    await storage.setItem('supabase-session', session); expect(await storage.getItem('supabase-session')).toBe(session);
    expect(native.values.size).toBeGreaterThan(1);
    await storage.setItem('supabase-session', 'new-session'); expect(await storage.getItem('supabase-session')).toBe('new-session');
    expect([...native.values.values()].some(value => value.includes('test-token-'))).toBe(false);
    await storage.removeItem('supabase-session'); expect(await storage.getItem('supabase-session')).toBeNull(); expect(native.values.size).toBe(0);
  });
  it('preserves the last complete session if a new chunk cannot be written', async () => {
    const native = driver(); let fail = false;
    const storage = createSecureStorageAdapter({ ...native, setItemAsync: async (key, value) => { if (fail && value.includes('fail-marker')) throw new Error('native store unavailable'); await native.setItemAsync(key, value); } });
    await storage.setItem('auth', 'last-complete-session'); fail = true;
    await expect(storage.setItem('auth', 'fail-marker'.repeat(200))).rejects.toThrow('native store unavailable');
    expect(await storage.getItem('auth')).toBe('last-complete-session');
  });
  it('serializes concurrent refresh and logout so a late refresh does not survive ordered logout', async () => {
    const native = driver(); const storage = createSecureStorageAdapter(native);
    const refresh = storage.setItem('auth', 'refreshed-session'); const signout = storage.removeItem('auth');
    await Promise.all([refresh, signout]); expect(await storage.getItem('auth')).toBeNull();
  });
  it('finishes an in-progress session read before a concurrent refresh retires its chunks', async () => {
    const native = driver(); let pauseNextMetadataRead = false;
    let readStarted = () => {}; let releaseRead = () => {};
    const entered = new Promise<void>(resolve => { readStarted = resolve; });
    const barrier = new Promise<void>(resolve => { releaseRead = resolve; });
    const storage = createSecureStorageAdapter({ ...native, getItemAsync: async key => {
      const value = await native.getItemAsync(key);
      if (pauseNextMetadataRead && key === 'interlink.secure.auth') {
        pauseNextMetadataRead = false; readStarted(); await barrier;
      }
      return value;
    } });
    const previous = 'old-session-'.repeat(200); const renewed = 'renewed-session-'.repeat(200);
    await storage.setItem('auth', previous); pauseNextMetadataRead = true;
    const reading = storage.getItem('auth'); await entered;
    let replacementFinished = false;
    const replacing = Promise.resolve(storage.setItem('auth', renewed)).then(() => { replacementFinished = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(replacementFinished).toBe(false); } finally { releaseRead(); }
    expect(await reading).toBe(previous); await replacing;
    expect(await storage.getItem('auth')).toBe(renewed);
    expect([...native.values.values()].some(value => value.includes('old-session-'))).toBe(false);
  });
  it('does not return partially missing session chunks', async () => {
    const native = driver(); const storage = createSecureStorageAdapter(native);
    await storage.setItem('auth', 'chunk'.repeat(300)); const chunkKey = [...native.values.keys()].find(key => key.endsWith('.0'))!;
    native.values.delete(chunkKey); expect(await storage.getItem('auth')).toBeNull();
  });
  it('namespaces browser demo data separately from session data', async () => {
    const values = new Map<string, string>([['auth', 'protected-elsewhere']]);
    const storage = createBrowserDemoStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } });
    await storage.setItem('auth', 'fictional-state'); expect(values.get('auth')).toBe('protected-elsewhere');
    expect(values.get('interlink.demo.auth')).toBe('fictional-state'); await storage.removeItem('auth'); expect(values.get('auth')).toBe('protected-elsewhere');
  });
});
