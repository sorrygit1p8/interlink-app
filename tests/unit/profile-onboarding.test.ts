import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient, DEMO_ACTORS, type StorageAdapter } from '@interlink/data';
import { createDemoState, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';
import { profileInputSchema, type Profile, type ProfileInput } from '@interlink/shared';

const clients: ReturnType<typeof createDemoClient>[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.restoreAllMocks(); });

function stored(initial?: DemoState) {
  let value = initial ? JSON.stringify(initial) : null;
  let rejectWrites = false;
  const storage: StorageAdapter = {
    getItem: key => key === DEMO_STORAGE_KEY ? value : null,
    setItem: vi.fn((key, next) => {
      if (rejectWrites) throw new Error('Fictional storage is full');
      if (key === DEMO_STORAGE_KEY) value = next;
    }),
    removeItem: () => { value = null; },
  };
  return { storage, read: () => value ? JSON.parse(value) as DemoState : null, raw: () => value, fail: (next: boolean) => { rejectWrites = next; } };
}

async function open(storage?: StorageAdapter, actor?: 'A' | 'B' | 'C') {
  const client = createDemoClient({ storage, actor }); clients.push(client); await client.ready(); return client;
}

function ordinary(profile: Profile): ProfileInput {
  return { nickname: profile.nickname, avatar: profile.avatar, interests: [...profile.interests], roles: [...profile.roles], learningRoles: [...profile.learningRoles], skills: [...profile.skills], availability: [...profile.availability], activityMode: profile.activityMode, bio: profile.bio, discoverable: profile.discoverable, links: [...profile.links] };
}

function setup(profile: Profile): ProfileInput {
  return { ...ordinary(profile), nickname: '  새 닉네임  ', interests: ['환경', '창작'], educationLevel: 'high', onboardingCompleted: true };
}

describe('first-launch profile setup and persistent completion (fictional local data)', () => {
  it('requires setup only for an unseeded default launch and leaves explicit sample personas complete', async () => {
    const store = stored(); const client = await open(store.storage);
    expect((await client.query('bootstrap', {})).viewer).toMatchObject({ id: DEMO_ACTORS.A, nickname: '', interests: [], educationLevel: null, onboardingCompleted: false });
    expect(store.storage.setItem).not.toHaveBeenCalled();
    expect((await client.query('projects.search', {})).items).toHaveLength(3);
    expect(createDemoState().profiles.every(profile => profile.onboardingCompleted && profile.educationLevel)).toBe(true);
    const fixture = await open(undefined, 'A');
    expect((await fixture.query('bootstrap', {})).viewer).toMatchObject({ nickname: '가상 나래', educationLevel: 'university', onboardingCompleted: true });
  });

  it('commits the entire setup once, refreshes membership names and restores completion on a new client', async () => {
    const store = stored(); const client = await open(store.storage); const listener = vi.fn(); client.subscribe(listener);
    const before = (await client.query('bootstrap', {})).viewer!; const input = setup(before); const key = randomUUID();
    await client.command('profile.update', input, key);
    const persisted = store.read()!;
    expect(persisted.profiles.find(profile => profile.id === DEMO_ACTORS.A)).toMatchObject({ nickname: '새 닉네임', interests: input.interests, educationLevel: 'high', onboardingCompleted: true });
    expect(persisted.memberships.filter(member => member.userId === DEMO_ACTORS.A).every(member => member.nickname === '새 닉네임')).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ scope: 'profile.update' });
    const restored = await open(store.storage);
    expect((await restored.query('bootstrap', {})).viewer).toMatchObject({ nickname: '새 닉네임', educationLevel: 'high', onboardingCompleted: true });
    await restored.command('profile.update', input, key);
    expect(store.storage.setItem).toHaveBeenCalledTimes(1);
    expect(store.read()!.projects).toEqual(persisted.projects);
  });

  it('rolls back nickname, interests, completion and replay history on save failure, then retries the same intent', async () => {
    const store = stored(); const client = await open(store.storage); const before = await client.query('bootstrap', {});
    const input = setup(before.viewer!); const key = randomUUID(); const listener = vi.fn(); client.subscribe(listener);
    store.fail(true);
    await expect(client.command('profile.update', input, key)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await client.query('bootstrap', {})).toEqual(before);
    expect(store.raw()).toBeNull(); expect(listener).not.toHaveBeenCalled();
    store.fail(false); await client.command('profile.update', input, key);
    expect((await client.query('bootstrap', {})).viewer?.onboardingCompleted).toBe(true);
    expect(Object.keys(store.read()!.idempotency)).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy personal edits and team data, without inferring completion or rewriting storage on load', async () => {
    const legacy = createDemoState('B');
    legacy.profiles.forEach(profile => { delete profile.educationLevel; delete profile.onboardingCompleted; });
    const edited = legacy.profiles.find(profile => profile.id === DEMO_ACTORS.B)!;
    Object.assign(edited, { nickname: '내 기존 별명', interests: ['직접 만든 관심사'], bio: '저장해 둔 내 소개', discoverable: false });
    const store = stored(legacy); const original = store.raw(); const client = await open(store.storage);
    expect((await client.query('bootstrap', {})).viewer).toEqual({ ...edited, educationLevel: null, onboardingCompleted: false });
    expect(store.raw()).toBe(original); expect(store.storage.setItem).not.toHaveBeenCalled();
    await client.command('profile.update', { ...ordinary(edited), educationLevel: 'middle', onboardingCompleted: true });
    const updated = store.read()!;
    expect(updated.profiles.find(profile => profile.id === DEMO_ACTORS.B)).toMatchObject({ nickname: edited.nickname, interests: edited.interests, bio: edited.bio, discoverable: false, educationLevel: 'middle', onboardingCompleted: true });
    for (const field of ['projects', 'applications', 'invitations', 'messages', 'experiences', 'saved'] as const) expect(updated[field]).toEqual(legacy[field]);
  });

  it('preserves omitted setup fields for ordinary edits and visibility toggles, and never clears completion', async () => {
    const store = stored(createDemoState('A')); const client = await open(store.storage);
    const profile = (await client.query('bootstrap', {})).viewer!;
    await client.command('profile.update', { ...ordinary(profile), nickname: '바꾼 별명', discoverable: false });
    let updated = (await client.query('bootstrap', {})).viewer!;
    expect(updated).toMatchObject({ nickname: '바꾼 별명', discoverable: false, educationLevel: 'university', onboardingCompleted: true });
    await client.command('profile.update', { ...ordinary(updated), educationLevel: 'middle', onboardingCompleted: undefined });
    updated = (await client.query('bootstrap', {})).viewer!;
    expect(updated).toMatchObject({ educationLevel: 'middle', onboardingCompleted: true });
    const persisted = store.raw();
    for (const patch of [{ onboardingCompleted: false }, { educationLevel: null }, { interests: [] }]) {
      await expect(client.command('profile.update', { ...ordinary(updated), ...patch })).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(store.raw()).toBe(persisted);
    }
    const restored = await open(store.storage);
    expect((await restored.query('bootstrap', {})).viewer).toMatchObject({ nickname: '바꾼 별명', educationLevel: 'middle', onboardingCompleted: true });
  });

  it('makes an explicitly requested local reset return to fresh A setup and persists that choice', async () => {
    const store = stored(createDemoState('C')); const client = await open(store.storage);
    await client.reset();
    expect((await client.query('bootstrap', {})).viewer).toMatchObject({ id: DEMO_ACTORS.A, nickname: '', interests: [], educationLevel: null, onboardingCompleted: false });
    const restored = await open(store.storage);
    expect((await restored.query('bootstrap', {})).viewer?.onboardingCompleted).toBe(false);
    await restored.selectActor('B');
    expect((await restored.query('bootstrap', {})).viewer).toMatchObject({ id: DEMO_ACTORS.B, onboardingCompleted: true });
  });

  it('erases school and setup metadata only for the deleted fictional account', async () => {
    const store = stored(createDemoState('A')); const client = await open(store.storage);
    await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    await client.processDeletion();
    const profiles = store.read()!.profiles;
    expect(profiles.find(profile => profile.id === DEMO_ACTORS.A)).toMatchObject({ status: 'deleted', interests: [], educationLevel: null, onboardingCompleted: false });
    expect(profiles.find(profile => profile.id === DEMO_ACTORS.B)).toMatchObject({ status: 'active', educationLevel: 'university', onboardingCompleted: true });
  });

  it.each([
    { educationLevel: 'graduate' }, { educationLevel: 1 }, { educationLevel: null },
    { educationLevel: undefined }, { interests: [] }, { nickname: ' ' }, { onboardingCompleted: 'true' },
  ])('rejects invalid or incomplete submitted setup %j before persistence', async patch => {
    const store = stored(); const client = await open(store.storage); const before = (await client.query('bootstrap', {})).viewer!;
    const invalid = { ...setup(before), ...patch };
    expect(profileInputSchema.safeParse(invalid).success).toBe(false);
    await expect(client.command('profile.update', invalid as ProfileInput)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await client.query('bootstrap', {})).viewer).toEqual(before);
    expect(store.storage.setItem).not.toHaveBeenCalled();
  });
});
