import type { Profile, Project, Membership, Application, Invitation, Message, Notification, Experience, Report, AuditEntry, Job, Community } from '@interlink/shared';

export type DemoActor = 'A' | 'B' | 'C' | 'admin';
export const DEMO_ACTORS: Record<DemoActor, string> = {
  A: '10000000-0000-4000-8000-000000000001',
  B: '10000000-0000-4000-8000-000000000002',
  C: '10000000-0000-4000-8000-000000000003',
  admin: '10000000-0000-4000-8000-000000000004',
};
export const DEMO_PROJECTS = {
  first: '20000000-0000-4000-8000-000000000001',
  second: '20000000-0000-4000-8000-000000000002',
  third: '20000000-0000-4000-8000-000000000003',
};
export const DEMO_COMMUNITY_ID = '30000000-0000-4000-8000-000000000001';
export const DEMO_STORAGE_KEY = 'interlink.demo.state.v1';

export interface DemoState {
  version: 1;
  actor: DemoActor;
  profiles: Profile[];
  /** Local sort metadata, optional so existing v1 demo saves remain readable. */
  profileUpdatedAt?: Record<string, string>;
  projects: Project[];
  memberships: Membership[];
  applications: Application[];
  invitations: Invitation[];
  messages: Message[];
  notifications: (Notification & { actorId?: string })[];
  experiences: Experience[];
  reports: Report[];
  audit: AuditEntry[];
  jobs: Job[];
  communities: Community[];
  /** Local approval history; the displayed profile community is not an access grant. */
  communityMemberships?: Record<string, string[]>;
  blocks: { id: string; userId: string; blockedId: string; createdAt: string }[];
  saved: { userId: string; projectId: string }[];
  preferences: Record<string, { push: boolean; team: boolean; applications: boolean }>;
  readPositions: Record<string, string>;
  devices: { userId: string; token: string; platform: 'ios' | 'android' }[];
  deletion: Record<string, { id: string; status: 'requested' | 'processing' | 'completed' | 'failed' }>;
  inviteCodes: { id: string; communityId: string; maxUses: number; uses: string[]; expiresAt: string }[];
  hidden: string[];
  idempotency: Record<string, { fingerprint: string; result: { id: string; status?: string } }>;
}

export function createDemoState(actor: DemoActor = 'A'): DemoState {
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + 21 * 86400000).toISOString();
  const base = { avatar: 'orbit', learningRoles: [] as string[], activityMode: 'hybrid' as const, discoverable: true, communityId: DEMO_COMMUNITY_ID, status: 'active' as const, links: [] as string[], educationLevel: 'university' as const, onboardingCompleted: true };
  const profiles: Profile[] = [
    { ...base, id: DEMO_ACTORS.A, nickname: '가상 나래', interests: ['환경', '기술'], roles: ['기획'], skills: ['아이디어 정리', '발표'], availability: ['주말'], bio: '작은 아이디어를 함께 완성해 보고 싶어요. 데모 속 가상 인물입니다.' },
    { ...base, id: DEMO_ACTORS.B, nickname: '가상 두리', avatar: 'spark', interests: ['환경', '기술'], roles: ['개발'], learningRoles: ['디자인'], skills: ['Python'], availability: ['주말', '평일 저녁'], bio: '배우면서 만드는 개발자 역할을 체험해요. 데모 속 가상 인물입니다.' },
    { ...base, id: DEMO_ACTORS.C, nickname: '가상 하린', avatar: 'leaf', interests: ['창작', '환경'], roles: ['디자인'], skills: ['드로잉', 'Figma'], availability: ['주말'], bio: '보이는 이야기를 만드는 것을 좋아해요. 데모 속 가상 인물입니다.' },
    { ...base, id: DEMO_ACTORS.admin, nickname: '가상 운영자', avatar: 'star', interests: ['커뮤니티'], roles: ['운영'], skills: [], availability: [], discoverable: false, bio: '기기 안에서만 작동하는 가상 운영자입니다.' },
  ];
  const projectBase = { communityId: DEMO_COMMUNITY_ID, activityMode: 'hybrid' as const, availability: ['주말'], deadline, beginnerFriendly: true, status: 'recruiting' as const, createdAt: now, updatedAt: now, memberCount: 1 };
  const projects: Project[] = [
    { ...projectBase, id: DEMO_PROJECTS.first, ownerId: DEMO_ACTORS.A, title: '우리 동네, 초록 지도', goal: '우리 주변의 친환경 장소를 한 장의 지도로 만들어요.', description: '가상 프로젝트입니다. 주변 환경에 관심 있는 친구들과 기획부터 화면 제작까지 함께 경험해요. 처음이어도 괜찮아요.', interests: ['환경', '기술', '캡스톤'], roles: ['개발', '디자인'], capacity: 3 },
    { ...projectBase, id: DEMO_PROJECTS.second, ownerId: DEMO_ACTORS.C, title: '상상으로 만드는 작은 전시', goal: '각자의 상상을 모아 온라인 전시를 열어요.', description: '가상 창작 프로젝트입니다. 그림, 글, 소리 중 잘하는 하나로 참여할 수 있어요.', interests: ['창작', '디자인', '공모전'], roles: ['기획', '디자인', '개발'], capacity: 4, activityMode: 'online' },
    { ...projectBase, id: DEMO_PROJECTS.third, ownerId: DEMO_ACTORS.B, title: '하루 한 번, 배움 기록', goal: '서로 배운 것을 정리하는 작은 앱을 함께 만들어요.', description: '가상 탐구 프로젝트입니다. 경험보다 호기심을 중요하게 생각해요.', interests: ['기술', '탐구', '스터디'], roles: ['기획', '디자인'], capacity: 5, activityMode: 'online', availability: ['평일 저녁'] },
  ];
  const memberships: Membership[] = projects.map((project, index) => ({ id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, projectId: project.id, userId: project.ownerId, role: '팀장', nickname: profiles.find((profile) => profile.id === project.ownerId)!.nickname, avatar: profiles.find((profile) => profile.id === project.ownerId)!.avatar, active: true, joinedAt: now }));
  const state: DemoState = {
    version: 1, actor, profiles, profileUpdatedAt: Object.fromEntries(profiles.map(profile => [profile.id, now])), projects, memberships, applications: [], invitations: [], messages: [], notifications: [], experiences: [], audit: [], jobs: [],
    reports: [{ id: '50000000-0000-4000-8000-000000000001', reporterId: DEMO_ACTORS.B, targetType: 'project', targetId: DEMO_PROJECTS.second, reason: '기타', detail: '운영자 처리 흐름을 확인하기 위한 가상 신고입니다.', status: 'open', createdAt: now, content: projects[1]!.description }],
    communities: [{ id: DEMO_COMMUNITY_ID, name: '인터링크 가상 프로젝트실', status: 'active', memberCount: 4 }],
    communityMemberships: Object.fromEntries(profiles.map((profile) => [profile.id, [DEMO_COMMUNITY_ID]])),
    blocks: [], saved: [], preferences: {}, readPositions: {}, devices: [], deletion: {}, inviteCodes: [], hidden: [], idempotency: {},
  };
  if (actor === 'admin') {
    state.reports.push(
      { id: '50000000-0000-4000-8000-000000000002', reporterId: DEMO_ACTORS.C, targetType: 'profile', targetId: DEMO_ACTORS.B, reason: '커뮤니티 규칙 확인', detail: '계정 제한과 복구를 연습하기 위한 가상 신고입니다.', status: 'open', createdAt: now, content: '가상 두리 · 가상 프로필 신고 검토 예시' },
      { id: '50000000-0000-4000-8000-000000000003', reporterId: DEMO_ACTORS.B, targetType: 'profile', targetId: DEMO_ACTORS.C, reason: '기타', detail: '검토 중 상태와 처리 메모를 확인하는 가상 신고입니다.', status: 'reviewing', createdAt: now, content: '가상 하린 · 실제 피해나 실제 개인정보가 없는 시연용 기록' },
    );
    state.jobs.push(
      { id: '60000000-0000-4000-8000-000000000001', kind: 'push', status: 'failed', attempts: 8, nextAttemptAt: now, lastError: 'DEMO_PROVIDER_UNAVAILABLE' },
      { id: '60000000-0000-4000-8000-000000000002', kind: 'deletion', status: 'failed', attempts: 8, nextAttemptAt: now, lastError: 'DEMO_STORAGE_RETRY_REQUIRED' },
    );
    state.audit.push({ id: '70000000-0000-4000-8000-000000000001', actorId: DEMO_ACTORS.admin, action: 'demo.setup', targetId: DEMO_COMMUNITY_ID, note: '가상 운영 시나리오를 준비했습니다. 실제 신고·발송·삭제 기록이 아닙니다.', createdAt: now });
  }
  return state;
}
