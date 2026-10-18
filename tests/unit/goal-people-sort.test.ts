import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient } from '@interlink/data';
import { profileInputSchema } from '@interlink/shared';
import { createDemoState, DEMO_ACTORS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

const clients: ReturnType<typeof createDemoClient>[] = [];
const firstTime = '2026-10-18T00:00:00.000Z';
const laterTime = '2026-10-18T01:00:00.000Z';
type TimedState = DemoState & { profileUpdatedAt?: Record<string, string> };

function stored(state: TimedState) {
  const values = new Map([[DEMO_STORAGE_KEY, JSON.stringify(state)]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { storage, read: () => JSON.parse(values.get(DEMO_STORAGE_KEY)!) as TimedState };
}

async function open(storage?: ReturnType<typeof stored>['storage']) {
  const client = createDemoClient({ storage }); clients.push(client); await client.ready(); return client;
}

afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers(); });

describe('goal: demo people ordering matches score / profile update time / descending id', () => {
  it('puts a recently updated lower-score person first only in newest, preserving public profile shape', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const store = stored(createDemoState('A'));
    const client = await open(store.storage);
    await client.selectActor('C');
    const profile = (await client.query('bootstrap', {})).viewer!;
    vi.setSystemTime(laterTime);
    await client.command('profile.update', { ...profileInputSchema.strip().parse(profile), bio: '최근에 새롭게 정리한 가상 소개입니다.' });
    await client.selectActor('A');
    const newest = await client.query('people.search', { sort: 'newest' });
    expect(newest.items.map(person => person.id)).toEqual([DEMO_ACTORS.C, DEMO_ACTORS.B]);
    expect((await client.query('people.search', { sort: 'recommended' })).items.map(person => person.id)).toEqual([DEMO_ACTORS.B, DEMO_ACTORS.C]);
    expect(newest.items[0]).not.toHaveProperty('updatedAt');
    expect(newest.items[0]).not.toHaveProperty('profileUpdatedAt');
    expect(store.read().profileUpdatedAt?.[DEMO_ACTORS.C]).toBe(laterTime);
  });

  it('paginates stable time and id tie-breaks without replacing recommendation priority', async () => {
    const state: TimedState = createDemoState('A');
    const d = '10000000-0000-4000-8000-000000000010';
    const e = '10000000-0000-4000-8000-000000000011';
    state.profiles.push({ ...state.profiles[2]!, id: d, nickname: '가상 네 번째' }, { ...state.profiles[1]!, id: e, nickname: '가상 다섯 번째' });
    state.profileUpdatedAt = { [DEMO_ACTORS.B]: firstTime, [DEMO_ACTORS.C]: laterTime, [d]: laterTime, [e]: firstTime };
    const client = await open(stored(state).storage);
    const first = await client.query('people.search', { sort: 'newest', limit: 2 });
    const second = await client.query('people.search', { sort: 'newest', limit: 2, cursor: first.nextCursor! });
    expect(first.items.map(person => person.id)).toEqual([d, DEMO_ACTORS.C]);
    expect(second.items.map(person => person.id)).toEqual([e, DEMO_ACTORS.B]);
    expect(second.nextCursor).toBeNull();
    const recommended = await client.query('people.search', { sort: 'recommended', limit: 2 });
    const remaining = await client.query('people.search', { sort: 'recommended', limit: 2, cursor: recommended.nextCursor! });
    expect([...recommended.items, ...remaining.items].map(person => person.id)).toEqual([e, DEMO_ACTORS.B, d, DEMO_ACTORS.C]);
  });

  it('opens legacy v1 state and persists the first update across a later reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const state: TimedState = createDemoState('A'); delete state.profileUpdatedAt;
    const store = stored(state);
    const client = await open(store.storage);
    expect((await client.query('people.search', { sort: 'newest' })).items.map(person => person.id)).toEqual([DEMO_ACTORS.C, DEMO_ACTORS.B]);
    await client.selectActor('B');
    const profile = (await client.query('bootstrap', {})).viewer!;
    vi.setSystemTime(laterTime);
    await client.command('profile.update', profileInputSchema.strip().parse(profile));
    await client.selectActor('A');
    vi.setSystemTime('2026-10-19T00:00:00.000Z');
    const restored = await open(store.storage);
    expect((await restored.query('people.search', { sort: 'newest' })).items.map(person => person.id)).toEqual([DEMO_ACTORS.B, DEMO_ACTORS.C]);
    expect(store.read().version).toBe(1);
    expect(store.read().profileUpdatedAt?.[DEMO_ACTORS.B]).toBe(laterTime);
  });

  it('updates community profile changes and removes metadata when deletion completes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const state = createDemoState('A');
    const communityId = '30000000-0000-4000-8000-000000000002';
    state.communities.push({ id: communityId, name: '새 가상 커뮤니티', status: 'active', memberCount: 0 });
    state.inviteCodes.push({ id: 'test-invite-code', communityId, maxUses: 3, uses: [], expiresAt: '2026-10-20T00:00:00.000Z' });
    const store = stored(state);
    const client = await open(store.storage);
    vi.setSystemTime(laterTime);
    await client.command('community.join', { code: 'test-invite-code' });
    expect(store.read().profileUpdatedAt?.[DEMO_ACTORS.A]).toBe(laterTime);
    await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    await client.processDeletion();
    expect(store.read().profileUpdatedAt).not.toHaveProperty(DEMO_ACTORS.A);
    expect(store.read().profileUpdatedAt).toHaveProperty(DEMO_ACTORS.B);
  });
});
