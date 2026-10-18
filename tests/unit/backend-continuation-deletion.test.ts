import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoClient, createMemoryStorage, DEMO_ACTORS, DEMO_PROJECTS } from '@interlink/data';
import type { DemoState } from '../../packages/data/src/fixtures';

const clients: ReturnType<typeof createDemoClient>[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); });

describe('continued demo deletion and authorization regressions', () => {
  it('checks current account authorization before replaying a previously committed command', async () => {
    const client = createDemoClient({ actor: 'B' }); clients.push(client); await client.ready();
    const key = randomUUID();
    const input = { projectId: DEMO_PROJECTS.first, role: '개발', introduction: '함께 만들어 보고 싶은 신청입니다.' };
    await client.command('application.submit', input, key);
    await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    await expect(client.command('application.submit', input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('erases user text and evidence from persisted state while retaining shared tombstones', async () => {
    const storage = createMemoryStorage();
    const client = createDemoClient({ actor: 'A', storage }); clients.push(client); await client.ready();
    const marker = '삭제회귀_개인정보_기록';
    const project = await client.command('project.create', {
      title: `${marker} 제목`, goal: `${marker} 프로젝트 목표`, description: `${marker} 프로젝트 설명입니다.`,
      interests: ['환경'], roles: ['개발', '디자인'], capacity: 4, activityMode: 'online', availability: ['주말'],
      deadline: new Date(Date.now() + 86400000).toISOString(), beginnerFriendly: true,
    });
    await client.command('application.submit', { projectId: DEMO_PROJECTS.second, role: '개발', introduction: `${marker} 신청 소개입니다.` });
    await client.command('invitation.send', { projectId: project.id, inviteeId: DEMO_ACTORS.C, role: '디자인', message: `${marker} 초대 메시지` });
    const message = await client.command('message.send', { projectId: project.id, body: `${marker} 대화 내용`, clientId: randomUUID() });
    await client.command('report.create', { targetType: 'project', targetId: DEMO_PROJECTS.second, reason: '기타', detail: `${marker} 신고 내용` });
    await client.selectActor('B');
    const application = await client.command('application.submit', { projectId: project.id, role: '개발', introduction: '삭제 이후에도 참여 이력을 유지합니다.' });
    const report = await client.command('report.create', { targetType: 'project', targetId: project.id, reason: '기타', detail: `${marker} 관련 신고 내용` });
    await client.command('invitation.send', { projectId: DEMO_PROJECTS.third, inviteeId: DEMO_ACTORS.A, role: '디자인', message: `${marker} 받은 초대` });
    await client.selectActor('admin');
    await client.command('admin.action', { reportId: report.id, targetType: 'report', targetId: report.id, action: 'resolve', note: `${marker} 검토 메모` });
    await client.selectActor('A');
    await client.command('application.review', { id: application.id, decision: 'approved' });
    await client.command('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' });
    await client.processDeletion();
    expect(await client.query('account.status', {})).toMatchObject({ status: 'deleted', deletionStatus: 'completed' });

    const raw = await storage.getItem('interlink.demo.state.v1');
    expect(raw).not.toContain(marker);
    const state = JSON.parse(raw!) as DemoState;
    expect(state.profiles.find((profile) => profile.id === DEMO_ACTORS.A)?.communityId).toBeNull();
    expect(state.communityMemberships?.[DEMO_ACTORS.A]).toBeUndefined();
    expect(state.communities[0]?.memberCount).toBe(3);
    expect(state.messages.find((item) => item.id === message.id)).toMatchObject({ body: '', deleted: true });
    expect(state.applications.find((item) => item.userId === DEMO_ACTORS.A)).toMatchObject({ introduction: '', role: '탈퇴한 팀원' });
    expect(state.invitations.find((item) => item.inviterId === DEMO_ACTORS.A)).toMatchObject({ message: '', role: '탈퇴한 팀원' });
    expect(state.notifications.some((item) => item.userId === DEMO_ACTORS.A || item.actorId === DEMO_ACTORS.A)).toBe(false);
    expect(state.reports.some((item) => item.reporterId === DEMO_ACTORS.A)).toBe(false);
    expect(state.reports.find((item) => item.id === report.id)).toMatchObject({ detail: '', reason: '삭제된 계정 관련 신고' });
    expect(state.reports.find((item) => item.id === report.id)?.content).toBeUndefined();

    await client.selectActor('B');
    expect((await client.query('projects.detail', { id: project.id })).project).toMatchObject({ title: '종료된 프로젝트', status: 'archived', memberCount: 1 });
    expect((await client.query('messages.list', { projectId: project.id })).items.find((item) => item.id === message.id)).toMatchObject({ body: '', deleted: true });
  });
});
