import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient, DEMO_ACTORS } from '@interlink/data';

const clients: ReturnType<typeof createDemoClient>[] = [];
const projectInput = (capacity = 3) => ({
  title: '가상 환경 센서 프로젝트', goal: '교실 환경을 알아보는 가상 시제품 만들기',
  description: '테스트용 가상 프로젝트입니다. 센서 기록과 화면을 함께 만들어요.',
  interests: ['환경'], roles: ['개발', '디자인'], capacity, activityMode: 'online' as const,
  availability: ['주말'], deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
  beginnerFriendly: true,
});
async function fresh() {
  const client = createDemoClient({ actor: 'A' }); clients.push(client); await client.ready(); return client;
}
async function create(client: ReturnType<typeof createDemoClient>, capacity = 3) {
  return (await client.command('project.create', projectInput(capacity), randomUUID())).id;
}
async function apply(client: ReturnType<typeof createDemoClient>, projectId: string) {
  await client.selectActor('B');
  return (await client.command('application.submit', { projectId, role: '개발', introduction: '배우면서 센서를 함께 만들고 싶어요.' }, randomUUID())).id;
}
async function join(client: ReturnType<typeof createDemoClient>, projectId: string) {
  const applicationId = await apply(client, projectId); await client.selectActor('A');
  await client.command('application.review', { id: applicationId, decision: 'approved' }, randomUUID());
  return applicationId;
}
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.restoreAllMocks(); });

describe('explicit demo A/B/C state machine (no real authentication or RLS claim)', () => {
  it('creates, applies, approves and exposes membership and chat consistently across roles', async () => {
    const client = await fresh(); const id = await create(client);
    const before = await client.query('projects.detail', { id });
    expect(before.project.memberCount).toBe(1); expect(before.members.map(x => x.userId)).toContain(DEMO_ACTORS.A);
    const applicationId = await apply(client, id);
    expect((await client.query('projects.detail', { id })).application?.status).toBe('pending');
    await expect(client.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.selectActor('A');
    expect((await client.query('applications.list', { projectId: id })).items.map(x => x.id)).toContain(applicationId);
    await client.command('application.review', { id: applicationId, decision: 'approved' });
    await client.selectActor('B');
    const joined = await client.query('projects.detail', { id });
    expect(joined.application?.status).toBe('approved'); expect(joined.project.memberCount).toBe(2);
    expect(joined.members.map(x => x.userId)).toContain(DEMO_ACTORS.B);
    expect((await client.query('teams.mine', {})).items.map(x => x.id)).toContain(id);
    await expect(client.query('messages.list', { projectId: id })).resolves.toMatchObject({ items: [] });
  });

  it('does not add or reserve a membership until an invitation is accepted', async () => {
    const client = await fresh(); const id = await create(client);
    const invitation = await client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.C, role: '디자인', message: '가상 팀에 함께해 주세요.' });
    expect((await client.query('projects.detail', { id })).project.memberCount).toBe(1);
    await client.selectActor('C');
    expect((await client.query('invitations.list', {})).items.find(x => x.id === invitation.id)?.status).toBe('pending');
    await client.command('invitation.respond', { id: invitation.id, decision: 'accepted' });
    expect((await client.query('projects.detail', { id })).project.memberCount).toBe(2);
    expect((await client.query('teams.mine', {})).items.map(x => x.id)).toContain(id);
  });

  it('counts the owner in capacity and rejects the next acceptance after the last seat is filled', async () => {
    const client = await fresh(); const id = await create(client, 2);
    const invitation = await client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.C, role: '디자인', message: '가상 초대입니다.' });
    await join(client, id); await client.selectActor('C');
    await expect(client.command('invitation.respond', { id: invitation.id, decision: 'accepted' })).rejects.toMatchObject({ code: 'FULL' });
    await client.selectActor('A'); expect((await client.query('projects.detail', { id })).project.memberCount).toBe(2);
  });

  it('rejects applicant self-approval and unrelated users reading applications', async () => {
    const client = await fresh(); const id = await create(client); const applicationId = await apply(client, id);
    await expect(client.command('application.review', { id: applicationId, decision: 'approved' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.selectActor('C');
    await expect(client.query('applications.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('withdraws an application without granting membership or chat access', async () => {
    const client = await fresh(); const id = await create(client); const applicationId = await apply(client, id);
    await client.command('application.withdraw', { id: applicationId });
    expect((await client.query('projects.detail', { id })).application?.status).toBe('withdrawn');
    await expect(client.command('message.send', { projectId: id, body: '허용되지 않는 메시지', clientId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps only one message on send retry and removes deleted message body', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id); await client.selectActor('B');
    const input = { projectId: id, body: '가상 센서 계획을 함께 정해요.', clientId: randomUUID() };
    const first = await client.command('message.send', input, randomUUID());
    const second = await client.command('message.send', input, randomUUID());
    expect(second.id).toBe(first.id);
    const history = await client.query('messages.list', { projectId: id });
    expect(history.items.filter(x => x.clientId === input.clientId)).toHaveLength(1);
    await client.selectActor('A'); await client.command('message.read', { projectId: id, messageId: first.id });
    await client.selectActor('B'); await client.command('message.delete', { id: first.id });
    const deleted = (await client.query('messages.list', { projectId: id })).items.find(x => x.id === first.id);
    expect(deleted?.deleted).toBe(true); expect(deleted?.body).not.toContain(input.body);
  });

  it('revokes demo chat access immediately after removal', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id);
    await client.command('membership.remove', { projectId: id, userId: DEMO_ACTORS.B }); await client.selectActor('B');
    await expect(client.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.command('message.send', { projectId: id, body: '더는 보낼 수 없어요.', clientId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts received messages and never moves the read position backwards', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id); await client.selectActor('B');
    await client.command('message.send', { projectId: id, body: '첫 번째 가상 메시지', clientId: randomUUID() });
    await client.command('message.send', { projectId: id, body: '두 번째 가상 메시지', clientId: randomUUID() });
    expect((await client.query('teams.mine', {})).items.find(x => x.id === id)?.unreadCount).toBe(0);
    await client.selectActor('A');
    expect((await client.query('teams.mine', {})).items.find(x => x.id === id)?.unreadCount).toBe(2);
    const unreadBefore = (await client.query('bootstrap', {})).messageUnreadCount;
    expect(unreadBefore).toBeGreaterThanOrEqual(2);
    const messages = (await client.query('messages.list', { projectId: id })).items;
    await client.command('message.read', { projectId: id, messageId: messages[0]!.id });
    expect((await client.query('teams.mine', {})).items.find(x => x.id === id)?.unreadCount).toBe(0);
    await client.command('message.read', { projectId: id, messageId: messages.at(-1)!.id });
    expect((await client.query('teams.mine', {})).items.find(x => x.id === id)?.unreadCount).toBe(0);
    expect((await client.query('bootstrap', {})).messageUnreadCount).toBe(unreadBefore! - 2);
  });

  it('retains a redacted participation record after leaving without restoring chat access', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id); await client.selectActor('B');
    await client.command('membership.leave', { projectId: id });
    expect((await client.query('teams.mine', {})).items.map(x => x.id)).not.toContain(id);
    const history = (await client.query('teams.history', {})).items.find(x => x.id === id);
    expect(history).toMatchObject({ id, title: projectInput().title, goal: '', description: '', roles: [], interests: [], availability: [], memberCount: 0 });
    await expect(client.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const saved = await client.command('experience.save', { projectId: id, title: '가상 센서 개발 경험', description: '탈퇴 후에도 내가 참여했던 경험을 기록합니다.', role: '개발', isPublic: false });
    expect((await client.query('experiences.list', {})).items.map(x => x.id)).toContain(saved.id);
  });

  it('can reach both failed jobs through distinct pages in the explicit admin demo', async () => {
    const client = createDemoClient({ actor: 'admin' }); clients.push(client); await client.ready();
    const first = await client.query('admin.jobs', { limit: 1 });
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = await client.query('admin.jobs', { limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1); expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect([first.items[0]!.status, second.items[0]!.status]).toEqual(['failed', 'failed']);
    expect(second.nextCursor).toBeNull();
  });

  it('reaches teams, saved projects and applications on later pages without duplicates', async () => {
    const client = await fresh(); const firstId = await create(client); const secondId = await create(client);
    const teams = await client.query('teams.mine', { limit: 1 });
    const nextTeams = await client.query('teams.mine', { limit: 1, cursor: teams.nextCursor! });
    expect(new Set([...teams.items, ...nextTeams.items].map(x => x.id)).size).toBe(2);
    await client.selectActor('B');
    for (const id of [firstId, secondId]) {
      await client.command('project.save', { id, saved: true });
      await client.command('application.submit', { projectId: id, role: '개발', introduction: '둘째 페이지에서도 지원 상태를 확인해요.' });
    }
    const saved = await client.query('saved.list', { limit: 1 });
    const nextSaved = await client.query('saved.list', { limit: 1, cursor: saved.nextCursor! });
    expect(new Set([...saved.items, ...nextSaved.items].map(x => x.id))).toEqual(new Set([firstId, secondId]));
    const applications = await client.query('applications.list', { limit: 1 });
    const nextApplications = await client.query('applications.list', { limit: 1, cursor: applications.nextCursor! });
    expect(new Set([...applications.items, ...nextApplications.items].map(x => x.projectId))).toEqual(new Set([firstId, secondId]));
  });

  it('does not let a team owner leave until ownership is transferred', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id);
    await expect(client.command('membership.leave', { projectId: id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await client.command('membership.transfer', { projectId: id, userId: DEMO_ACTORS.B });
    await client.command('membership.leave', { projectId: id }); await client.selectActor('B');
    expect((await client.query('projects.detail', { id })).project.ownerId).toBe(DEMO_ACTORS.B);
  });

  it('filters blocked people and rejects new invitations through blocked relationships', async () => {
    const client = await fresh(); const id = await create(client);
    await client.command('block.set', { userId: DEMO_ACTORS.C, blocked: true });
    expect((await client.query('people.search', {})).items.map(x => x.id)).not.toContain(DEMO_ACTORS.C);
    await expect(client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.C, role: '디자인', message: '차단 중 초대' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.command('block.set', { userId: DEMO_ACTORS.C, blocked: false });
    expect((await client.query('blocks.list', {})).items.map(x => x.blockedId)).not.toContain(DEMO_ACTORS.C);
  });

  it('persists report and moderation state while restricting ordinary-user admin access', async () => {
    const client = await fresh(); const id = await create(client); await client.selectActor('B');
    const report = await client.command('report.create', { targetType: 'project', targetId: id, reason: '개인정보', detail: '가상 신고 시나리오입니다.' });
    await expect(client.query('admin.reports', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.selectActor('admin'); expect((await client.query('admin.report', { id: report.id })).status).toBe('open');
    await client.command('admin.action', { reportId: report.id, targetType: 'report', targetId: report.id, action: 'resolve', note: '가상 신고 내용 검토 완료' });
    expect((await client.query('admin.report', { id: report.id })).status).toBe('resolved');
    expect((await client.query('admin.audit', {})).items.length).toBeGreaterThan(0);
  });

  it('treats account deletion as a request and a separate simulated worker completion', async () => {
    const client = await fresh(); await client.selectActor('B');
    await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    const requested = await client.query('account.status', {});
    expect(requested.status).toBe('deleting'); expect(requested.deletionStatus).not.toBe('completed');
    await expect(client.command('project.create', projectInput())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.processDeletion(); expect((await client.query('account.status', {})).deletionStatus).toBe('completed');
  });

  it('revokes closed-community team and chat access and excludes its unread messages', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id); await client.selectActor('B');
    await client.command('message.send', { projectId: id, body: '커뮤니티 종료 전에 작성한 메시지', clientId: randomUUID() });
    await client.selectActor('A'); const community = (await client.query('bootstrap', {})).community!;
    expect((await client.query('bootstrap', {})).messageUnreadCount).toBeGreaterThan(0);
    await client.selectActor('admin'); await client.command('admin.community', { id: community.id, name: community.name, status: 'closed' });
    await client.selectActor('A');
    expect((await client.query('bootstrap', {})).messageUnreadCount).toBe(0);
    expect((await client.query('teams.mine', {})).items).toHaveLength(0);
    await expect(client.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.command('message.send', { projectId: id, body: '종료 뒤에는 보낼 수 없어요.', clientId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('archives owned teams and revokes the requesting account before deletion processing completes', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id);
    const invitation = await client.command('invitation.send', { projectId: id, inviteeId: DEMO_ACTORS.C, role: '디자인', message: '삭제 요청 전에 발송한 초대' });
    const deletion = await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    const replay = await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    expect(replay.id).toBe(deletion.id); expect((await client.query('account.status', {})).deletionStatus).toBe('requested');
    await expect(client.query('messages.list', { projectId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await client.selectActor('B');
    const remaining = await client.query('projects.detail', { id });
    expect(remaining.project.status).toBe('archived'); expect(remaining.members.filter(x => x.active).map(x => x.userId)).toEqual([DEMO_ACTORS.B]);
    await client.selectActor('C');
    expect((await client.query('invitations.list', {})).items.find(x => x.id === invitation.id)?.status).toBe('cancelled');
    await expect(client.command('invitation.respond', { id: invitation.id, decision: 'accepted' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('filters prior and future blocked-actor notifications without faking team departure', async () => {
    const client = await fresh(); const id = await create(client); await join(client, id); await client.selectActor('B');
    expect((await client.query('notifications.list', {})).items.length).toBeGreaterThan(0);
    await client.command('block.set', { userId: DEMO_ACTORS.A, blocked: true });
    expect((await client.query('notifications.list', {})).items).toHaveLength(0);
    expect((await client.query('bootstrap', {})).unreadCount).toBe(0);
    await client.selectActor('A'); await client.command('message.send', { projectId: id, body: '공유 팀의 차단 대상 메시지', clientId: randomUUID() });
    await client.selectActor('B');
    expect((await client.query('bootstrap', {}))).toMatchObject({ unreadCount: 0, messageUnreadCount: 0 });
    expect((await client.query('notifications.list', {})).items).toHaveLength(0);
    expect((await client.query('teams.mine', {})).items.map(x => x.id)).toContain(id);
  });

  it('paginates search without duplicate items and returns an empty page for no matches', async () => {
    const client = await fresh(); await create(client); await create(client); await create(client);
    const first = await client.query('projects.search', { limit: 2 }); expect(first.items).toHaveLength(2); expect(first.nextCursor).toBeTruthy();
    const next = await client.query('projects.search', { limit: 2, cursor: first.nextCursor! });
    expect(next.items.some(x => first.items.some(y => y.id === x.id))).toBe(false);
    expect((await client.query('projects.search', { search: '아무것도일치하지않는고유검색어' })).items).toHaveLength(0);
  });

  it('keeps saved items private to the selected demo actor', async () => {
    const client = await fresh(); const id = await create(client); await client.selectActor('B');
    await client.command('project.save', { id, saved: true });
    expect((await client.query('saved.list', {})).items.map(x => x.id)).toContain(id); await client.selectActor('C');
    expect((await client.query('saved.list', {})).items.map(x => x.id)).not.toContain(id);
  });

  it('requires actual membership history for experience records', async () => {
    const client = await fresh(); const id = await create(client); await client.selectActor('C');
    await expect(client.command('experience.save', { projectId: id, title: '가상 경험', description: '참여하지 않은 프로젝트의 경험', role: '개발', isPublic: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('resets local mutations without calling an external service', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Demo must not use network'));
    const client = await fresh(); const id = await create(client); await join(client, id);
    await client.reset(); expect((await client.query('projects.search', {})).items.map(x => x.id)).not.toContain(id);
    expect(client.mode).toBe('demo'); expect(request).not.toHaveBeenCalled();
  });

  it('replays the same mutation key once and rejects key reuse for a different request', async () => {
    const client = await fresh(); const key = randomUUID(); const input = projectInput();
    const first = await client.command('project.create', input, key);
    const replay = await client.command('project.create', input, key);
    expect(replay.id).toBe(first.id);
    await expect(client.command('project.create', { ...projectInput(), title: '다른 가상 프로젝트' }, key)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await client.query('projects.search', {})).items.filter(x => x.id === first.id)).toHaveLength(1);
  });

  it('restores a persisted role and state without publishing unsuccessful writes', async () => {
    const values = new Map<string, string>(); let rejectWrite = false;
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (rejectWrite) throw new Error('disk full'); values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const client = createDemoClient({ storage, actor: 'A' }); clients.push(client); await client.ready();
    const id = await create(client); await client.selectActor('B');
    const restored = createDemoClient({ storage }); clients.push(restored); await restored.ready();
    expect(restored.actor).toBe('B'); expect((await restored.query('projects.detail', { id })).project.id).toBe(id);
    rejectWrite = true;
    await expect(restored.command('project.save', { id, saved: true })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await restored.query('saved.list', {})).items.map(x => x.id)).not.toContain(id);
  });

  it('surfaces corrupt local data and allows an explicit reset to recover', async () => {
    const values = new Map<string, string>([['interlink.demo.state.v1', '{corrupt-data']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const client = createDemoClient({ storage }); clients.push(client);
    await expect(client.ready()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await client.reset(); await expect(client.query('bootstrap', {})).resolves.toMatchObject({ viewer: { id: DEMO_ACTORS.A } });
  });
});
