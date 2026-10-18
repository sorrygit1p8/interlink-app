import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient, createMemoryStorage, DEMO_ACTORS, DEMO_PROJECTS, type StorageAdapter } from '@interlink/data';
import { DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

const clients: ReturnType<typeof createDemoClient>[] = [];
const input = { title: '해체와 탈퇴를 확인하는 가상 팀', goal: '팀원의 접근과 활동 기록을 확인해요', description: '외부 요청 없이 기기 내 팀 활동과 저장을 검증하는 프로젝트입니다.', interests: ['기술', '스터디'], roles: ['개발'], capacity: 4, activityMode: 'online' as const, availability: ['주말'], deadline: '2099-01-01T00:00:00.000Z', beginnerFriendly: true };

async function open(storage: StorageAdapter) {
  const client = createDemoClient({ storage }); clients.push(client); await client.ready(); return client;
}

async function joinedTeam() {
  const memory = createMemoryStorage();
  let rejectWrite = false;
  const storage: StorageAdapter = { ...memory, setItem(key, value) { if (rejectWrite) throw new Error('test storage full'); return memory.setItem(key, value); } };
  const client = await open(storage);
  const { id } = await client.command('project.create', input);
  const invitation = await client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.B, role: '개발', message: '가상 팀 참여' });
  await client.selectActor('B');
  await client.command('invitation.respond', { id: invitation.id, decision: 'accepted' });
  const message = await client.command('message.send', { projectId: id, body: '참여 이력과 함께 보존할 대화입니다.', clientId: randomUUID() });
  const experience = await client.command('experience.save', { projectId: id, title: '가상 개발 경험', description: '팀 종료 후에도 보존할 내 경험입니다.', role: '개발', isPublic: false });
  await client.selectActor('A');
  return { client, id, storage, message, experience, failWrites: (value: boolean) => { rejectWrite = value; }, read: async () => JSON.parse((await storage.getItem(DEMO_STORAGE_KEY))!) as DemoState };
}

afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.restoreAllMocks(); });

describe('owner disband and member leave preserve records while revoking team access', () => {
  it('atomically disbands for every member, closes pending requests, and persists history without deleting content', async () => {
    const { client, id, storage, message, experience, read } = await joinedTeam();
    const invitation = await client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.C, role: '개발', message: '응답 전 초대' });
    await client.selectActor('admin');
    const application = await client.command('application.submit', { projectId: id, role: '개발', introduction: '검토 중인 가상 지원입니다.' });
    await client.selectActor('A');
    const before = await read();
    const events = vi.fn(); client.subscribe(events);
    const key = randomUUID();
    await expect(client.command('project.disband', { id }, key)).resolves.toEqual({ id, status: 'archived' });
    expect(events).toHaveBeenCalledWith({ scope: 'project.disband', projectId: id });
    const after = await read();
    expect(after.projects.find(project => project.id === id)).toMatchObject({ ...input, id, status: 'archived', memberCount: 0 });
    expect(after.memberships.filter(member => member.projectId === id)).toHaveLength(2);
    expect(after.memberships.filter(member => member.projectId === id).every(member => !member.active)).toBe(true);
    expect(after.applications.find(item => item.id === application.id)?.status).toBe('rejected');
    expect(after.invitations.find(item => item.id === invitation.id)?.status).toBe('cancelled');
    expect(after.messages.find(item => item.id === message.id)).toEqual(before.messages.find(item => item.id === message.id));
    expect(after.experiences.find(item => item.id === experience.id)).toEqual(before.experiences.find(item => item.id === experience.id));
    expect(after.projects.filter(project => project.id !== id)).toEqual(before.projects.filter(project => project.id !== id));
    const notificationCount = after.notifications.length;
    await expect(client.command('project.disband', { id }, key)).resolves.toEqual({ id, status: 'archived' });
    await expect(client.command('project.disband', { id })).resolves.toEqual({ id, status: 'archived' });
    expect((await read()).notifications).toHaveLength(notificationCount);
    await expect(client.command('project.transition', { id, status: 'recruiting' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const restored = await open(storage);
    for (const actor of ['A', 'B'] as const) {
      await restored.selectActor(actor);
      expect((await restored.query('teams.mine', {})).items.map(project => project.id)).not.toContain(id);
      expect((await restored.query('teams.history', {})).items.find(project => project.id === id)).toMatchObject({ id, title: input.title, description: '', memberCount: 0 });
      await expect(restored.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(restored.command('message.send', { projectId: id, body: '종료 뒤 전송 금지', clientId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await restored.query('bootstrap', {})).messageUnreadCount).toBe(0);
    }
    expect((await restored.query('experiences.list', {})).items.map(item => item.id)).toContain(experience.id);
    await restored.command('experience.save', { projectId: id, title: '종료 후 정리한 경험', description: '실제 참여 이력을 바탕으로 추가한 가상 경험입니다.', role: '개발', isPublic: false });
    await restored.selectActor('C');
    await expect(restored.command('invitation.respond', { id: invitation.id, decision: 'accepted' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects member, unrelated actor, forged identity, and active-owner leave without changing membership', async () => {
    const { client, id, read } = await joinedTeam();
    await expect(client.command('membership.leave', { projectId: id })).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const actor of ['B', 'C'] as const) {
      await client.selectActor(actor);
      await expect(client.command('project.disband', { id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await client.selectActor('A');
    const forged = { id, ownerId: DEMO_ACTORS.B };
    await expect(client.command('project.disband', forged)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await read()).memberships.filter(member => member.projectId === id && member.active)).toHaveLength(2);
    expect((await read()).projects.find(project => project.id === id)?.status).toBe('recruiting');
  });

  it('requires the current owner after transfer and preserves ordinary archive semantics', async () => {
    const { client, id } = await joinedTeam();
    await client.command('membership.transfer', { projectId: id, userId: DEMO_ACTORS.B });
    await expect(client.command('project.disband', { id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.selectActor('B');
    await client.command('project.transition', { id, status: 'archived' });
    expect((await client.query('teams.mine', {})).items.map(project => project.id)).toContain(id);
    await expect(client.query('messages.list', { projectId: id })).resolves.toHaveProperty('items');
    await client.command('project.disband', { id });
    expect((await client.query('teams.mine', {})).items.map(project => project.id)).not.toContain(id);
  });

  it('leaves only the current member, updates counts and preserves history after reload', async () => {
    const { client, id, storage, message, experience, read } = await joinedTeam();
    await client.selectActor('B');
    await client.command('membership.leave', { projectId: id });
    const restored = await open(storage);
    expect((await restored.query('teams.mine', {})).items.map(project => project.id)).not.toContain(id);
    expect((await restored.query('teams.history', {})).items.map(project => project.id)).toContain(id);
    expect((await restored.query('experiences.list', {})).items.map(item => item.id)).toContain(experience.id);
    await expect(restored.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(restored.command('message.send', { projectId: id, body: '탈퇴 뒤 전송 금지', clientId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await restored.selectActor('A');
    expect((await restored.query('projects.detail', { id })).project).toMatchObject({ status: 'recruiting', memberCount: 1 });
    expect((await restored.query('teams.mine', {})).items.map(project => project.id)).toEqual(expect.arrayContaining([id, DEMO_PROJECTS.first]));
    expect((await read()).messages.map(item => item.id)).toContain(message.id);
  });

  it.each(['disband', 'leave'] as const)('rolls back all %s changes and publishes no event when storage rejects the write', async action => {
    const { client, id, storage, failWrites } = await joinedTeam();
    if (action === 'leave') await client.selectActor('B');
    const original = await storage.getItem(DEMO_STORAGE_KEY);
    const events = vi.fn(); client.subscribe(events);
    failWrites(true);
    const run = () => action === 'disband' ? client.command('project.disband', { id }) : client.command('membership.leave', { projectId: id });
    await expect(run()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await storage.getItem(DEMO_STORAGE_KEY)).toBe(original);
    expect(events).not.toHaveBeenCalled();
    expect((await client.query('projects.detail', { id })).project).toMatchObject({ status: 'recruiting', memberCount: 2 });
    failWrites(false);
    await run();
    expect((await client.query('teams.mine', {})).items.map(project => project.id)).not.toContain(id);
  });
});
