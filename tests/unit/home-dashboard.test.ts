import { describe, expect, it } from 'vitest';
import { createDemoState, DEMO_ACTORS } from '../../packages/data/src/fixtures';
import { homeActivity, openRecruitments, recruitmentDeadline, urgentRecruitments } from '../../packages/shared/src/home-activity';

describe('home derives actionable state from existing records', () => {
  const now = Date.parse('2026-10-18T01:00:00Z');
  it('excludes expired invitations and other peoples applications while distinguishing owner review', () => {
    const state = createDemoState('A');
    const viewer = state.profiles[0]!;
    const base = { id: 'one', projectId: state.projects[0]!.id, role: '개발', introduction: '같이 만들고 싶어요.', status: 'pending' as const, createdAt: '2026-10-17T01:00:00Z' };
    const result = homeActivity(viewer, [state.projects[0]!], [{ ...base, userId: DEMO_ACTORS.B }, { ...base, id: 'two', projectId: state.projects[1]!.id, userId: viewer.id }], [
      { id: 'expired', projectId: state.projects[1]!.id, inviterId: DEMO_ACTORS.C, inviteeId: viewer.id, role: '기획', message: '', status: 'pending', createdAt: base.createdAt, expiresAt: '2026-10-17T02:00:00Z' },
      { id: 'other', projectId: state.projects[1]!.id, inviterId: DEMO_ACTORS.C, inviteeId: DEMO_ACTORS.B, role: '기획', message: '', status: 'pending', createdAt: base.createdAt, expiresAt: '2026-10-20T02:00:00Z' },
    ], now);
    expect(result.awaitingReview.map(x => x.userId)).toEqual([DEMO_ACTORS.B]);
    expect(result.pendingApplications.map(x => x.id)).toEqual(['two']);
    expect(result.pendingInvitations).toEqual([]);
  });

  it('does not advertise filled, expired, owned or joined projects as opportunities', () => {
    const [original] = createDemoState('B').projects;
    const make = (id: string, changes = {}) => ({ ...original!, id, deadline: '2026-10-19T01:00:00Z', ...changes });
    const visible = openRecruitments([
      make('open'), make('full', { capacity: 2, memberCount: 2 }), make('expired', { deadline: '2026-10-17T01:00:00Z' }),
      make('mine', { ownerId: DEMO_ACTORS.B }), make('joined'), make('closed', { status: 'completed' }),
    ], new Set(['joined']), DEMO_ACTORS.B, now);
    expect(visible.map(x => x.id)).toEqual(['open']);
  });

  it('shows urgency only for true near deadlines or one remaining place and labels time honestly', () => {
    const [project] = createDemoState().projects;
    const near = { ...project!, id: 'near', deadline: '2026-10-19T02:00:00Z' };
    const onePlace = { ...project!, id: 'place', capacity: 2, memberCount: 1, deadline: '2026-11-18T01:00:00Z' };
    const ordinary = { ...project!, id: 'ordinary', deadline: '2026-11-18T01:00:00Z' };
    expect(urgentRecruitments([ordinary, onePlace, near], now).map(x => x.id)).toEqual(['near', 'place']);
    expect(recruitmentDeadline({ deadline: '2026-10-18T23:00:00Z' }, now)).toBe('22시간 남음');
    expect(recruitmentDeadline({ deadline: '2026-10-17T23:00:00Z' }, now)).toBe('모집 마감');
  });
});
