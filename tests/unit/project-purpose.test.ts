import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient, createMemoryStorage, type StorageAdapter } from '@interlink/data';
import { PROJECT_PURPOSES, getProjectPurpose, projectInputSchema } from '@interlink/shared';
import { createDemoState, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

const clients: ReturnType<typeof createDemoClient>[] = [];
const originalInterests = [['환경', '기술'], ['창작', '디자인'], ['기술', '탐구']];
const purposes = ['캡스톤', '공모전', '스터디'];
const firstTime = '2026-10-18T00:00:00.000Z';

function legacyState() {
  const state = createDemoState();
  state.projects.forEach((project, index) => { project.interests = [...originalInterests[index]!]; });
  return state;
}

async function open(storage?: StorageAdapter) {
  const client = createDemoClient({ storage });
  clients.push(client);
  await client.ready();
  return client;
}

async function storeState(state: DemoState) {
  const storage = createMemoryStorage();
  await storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  return storage;
}

afterEach(() => {
  clients.splice(0).forEach(client => client.dispose());
  vi.useRealTimers();
});

describe('project purpose tags and preserved demo data', () => {
  it('recognizes only exact purpose tags with stable priority and leaves old projects uncategorized', () => {
    expect(PROJECT_PURPOSES).toEqual(['조별과제', '캡스톤', '공모전', '스터디']);
    expect(getProjectPurpose({ interests: ['기술', '스터디'] })).toBe('스터디');
    expect(getProjectPurpose({ interests: ['스터디', '캡스톤'] })).toBe('캡스톤');
    expect(getProjectPurpose({ interests: ['환경', '캡스톤 디자인', ' 공모전 '] })).toBeUndefined();
    expect(getProjectPurpose({ interests: [] })).toBeUndefined();
  });

  it('filters the original three fixtures by purpose without filling the empty classwork category', async () => {
    const client = await open();
    const expected = { 조별과제: [], 캡스톤: [DEMO_PROJECTS.first], 공모전: [DEMO_PROJECTS.second], 스터디: [DEMO_PROJECTS.third] };
    for (const purpose of PROJECT_PURPOSES) {
      const result = await client.query('projects.search', { interests: [purpose] });
      expect(result.items.map(project => project.id)).toEqual(expected[purpose]);
    }
    expect((await client.query('projects.search', {})).items).toHaveLength(3);
  });

  it('loads legacy saves without writing, then persists each appended purpose once through normal commands', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const state = legacyState();
    state.saved.push({ userId: state.profiles[0]!.id, projectId: DEMO_PROJECTS.second });
    state.preferences[state.profiles[0]!.id] = { push: false, team: true, applications: true };
    const storage = await storeState(state);
    const originalBytes = await storage.getItem(DEMO_STORAGE_KEY);
    const client = await open(storage);
    for (const [index, project] of state.projects.entries()) {
      expect((await client.query('projects.detail', { id: project.id })).project).toMatchObject({
        ...project, interests: [...originalInterests[index]!, purposes[index]!],
      });
    }
    expect(await storage.getItem(DEMO_STORAGE_KEY)).toBe(originalBytes);
    await client.selectActor('A');
    const expected = structuredClone(state);
    expected.projects.forEach((project, index) => { project.interests.push(purposes[index]!); });
    expect(JSON.parse((await storage.getItem(DEMO_STORAGE_KEY))!)).toEqual(expected);
    const reloaded = await open(storage);
    for (const project of expected.projects) {
      expect((await reloaded.query('projects.detail', { id: project.id })).project.interests).toEqual(project.interests);
    }
    expect((await reloaded.query('saved.list', {})).items.map(project => project.id)).toEqual([DEMO_PROJECTS.second]);
  });

  it('preserves edited tags, reordered tags, changed fixture content, and unrelated project ids', async () => {
    const state = legacyState();
    state.projects[0]!.interests.push('내 관심 분야');
    state.projects[1]!.title = '사용자가 바꾼 전시 제목';
    state.projects[2]!.interests.reverse();
    state.projects.push({ ...structuredClone(state.projects[0]!), id: '20000000-0000-4000-8000-000000000099', interests: ['환경', '기술'] });
    const storage = await storeState(state);
    const client = await open(storage);
    for (const project of state.projects) {
      expect((await client.query('projects.detail', { id: project.id })).project).toMatchObject(project);
    }
    await client.selectActor('A');
    expect(JSON.parse((await storage.getItem(DEMO_STORAGE_KEY))!)).toEqual(state);
  });

  it('preserves a previously edited fixture even when its tags still match the original', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const state = legacyState();
    state.projects[0]!.updatedAt = '2026-10-18T00:01:00.000Z';
    const storage = await storeState(state);
    const client = await open(storage);
    expect((await client.query('projects.detail', { id: DEMO_PROJECTS.first })).project.interests).toEqual(originalInterests[0]);
    await client.selectActor('A');
    const reloaded = await open(storage);
    expect((await reloaded.query('projects.detail', { id: DEMO_PROJECTS.first })).project.interests).toEqual(originalInterests[0]);
  });

  it('retains chosen purposes, custom tags, and explicit purpose removal across real edits and reloads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstTime);
    const storage = await storeState(legacyState());
    const client = await open(storage);
    const project = (await client.query('projects.detail', { id: DEMO_PROJECTS.first })).project;
    const input = projectInputSchema.strip().parse(project);
    vi.setSystemTime('2026-10-18T00:01:00.000Z');
    await client.command('project.update', { ...input, id: project.id, interests: ['환경', '개인 연구', '공모전'] });
    const updated = await open(storage);
    expect((await updated.query('projects.detail', { id: project.id })).project.interests).toEqual(['환경', '개인 연구', '공모전']);
    vi.setSystemTime('2026-10-18T00:02:00.000Z');
    await updated.command('project.update', { ...input, id: project.id, interests: ['환경', '기술'] });
    const removed = await open(storage);
    expect(getProjectPurpose((await removed.query('projects.detail', { id: project.id })).project)).toBeUndefined();
    const created = await removed.command('project.create', { ...input, title: '직접 만든 조별과제', interests: ['환경', '수업 이름', '조별과제'] });
    const restored = await open(storage);
    expect((await restored.query('projects.detail', { id: created.id })).project.interests).toEqual(['환경', '수업 이름', '조별과제']);
    expect((await restored.query('projects.search', { interests: ['조별과제'] })).items.map(item => item.id)).toEqual([created.id]);
  });
});
