import { z } from 'zod';
export { PROJECT_PURPOSES, getProjectPurpose, type ProjectPurpose } from './project-purpose';
z.config(z.locales.ko());

export type DataMode = 'demo' | 'supabase';
export type AppEnvironment = 'development' | 'staging' | 'production';
export type ActivityMode = 'online' | 'offline' | 'hybrid';
export const EDUCATION_LEVELS = ['middle', 'high', 'university'] as const;
export type EducationLevel = typeof EDUCATION_LEVELS[number];
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = { middle: '중학교', high: '고등학교', university: '대학교' };
export type ProjectStatus = 'draft' | 'recruiting' | 'active' | 'completed' | 'archived';
export type AccountState = 'active' | 'suspended' | 'deleting' | 'deleted';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type ErrorCode = 'CONFIGURATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' | 'CLOSED' | 'FULL' | 'DUPLICATE' | 'RATE_LIMITED' | 'NETWORK' | 'UNAVAILABLE' | 'CONFLICT';
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  CONFIGURATION: '연결 설정을 확인해 주세요.', UNAUTHENTICATED: '로그인이 필요해요.', FORBIDDEN: '이 작업에 접근할 권한이 없어요.',
  VALIDATION: '입력한 내용을 다시 확인해 주세요.', NOT_FOUND: '요청한 항목을 찾을 수 없어요.', CLOSED: '모집이 종료되었어요.',
  FULL: '팀 정원이 모두 찼어요.', DUPLICATE: '이미 처리한 요청이에요.', RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  NETWORK: '연결을 확인하고 다시 시도해 주세요.', UNAVAILABLE: '서비스를 잠시 사용할 수 없어요.', CONFLICT: '상태가 변경되었어요. 새로고침 후 확인해 주세요.',
};
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message = ERROR_MESSAGES[code], retryable = code === 'NETWORK' || code === 'UNAVAILABLE') {
    super(message); this.name = 'AppError'; this.code = code; this.retryable = retryable;
  }
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface Profile {
  id: string; nickname: string; avatar: string; interests: string[]; roles: string[]; learningRoles: string[];
  skills: string[]; availability: string[]; activityMode: ActivityMode; bio: string; discoverable: boolean;
  communityId: string | null; status: AccountState; links: string[]; reasons?: string[];
  /** Optional for legacy responses; adapters normalize missing setup to incomplete. */
  educationLevel?: EducationLevel | null; onboardingCompleted?: boolean;
}
export interface Project {
  id: string; ownerId: string; communityId: string; title: string; goal: string; description: string;
  interests: string[]; roles: string[]; capacity: number; memberCount: number; activityMode: ActivityMode;
  availability: string[]; deadline: string; beginnerFriendly: boolean; status: ProjectStatus;
  createdAt: string; updatedAt: string; saved?: boolean; reasons?: string[]; unreadCount?: number;
}
export interface Membership { id: string; projectId: string; userId: string; role: string; nickname: string; avatar: string; active: boolean; joinedAt: string }
export interface Application { id: string; projectId: string; userId: string; role: string; introduction: string; status: ApplicationStatus; createdAt: string; nickname?: string; projectTitle?: string }
export interface Invitation { id: string; projectId: string; inviterId: string; inviteeId: string; role: string; message: string; status: InvitationStatus; expiresAt: string; createdAt: string; projectTitle?: string; nickname?: string }
export interface Message { id: string; projectId: string; authorId: string; authorName: string; body: string; createdAt: string; clientId: string; deleted: boolean }
export interface Notification { id: string; userId: string; type: string; title: string; projectId?: string; read: boolean; createdAt: string }
export interface NotificationPreferences { push: boolean; team: boolean; applications: boolean }
export interface Experience { id: string; userId: string; projectId: string; title: string; description: string; role: string; isPublic: boolean; createdAt: string }
export type ReportTarget = 'profile' | 'project' | 'message';
export interface Report { id: string; reporterId: string; targetType: ReportTarget; targetId: string; reason: string; detail: string; status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; createdAt: string; content?: string }
export interface Block { id: string; blockedId: string; nickname: string; createdAt: string }
export interface AuditEntry { id: string; actorId: string; action: string; targetId: string; note: string; createdAt: string }
export interface Job { id: string; kind: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null }
export interface Community { id: string; name: string; status: 'active' | 'closed'; memberCount: number }
export interface AccountStatus { status: AccountState; deletionRequestId?: string; deletionStatus?: 'requested' | 'processing' | 'completed' | 'failed'; reason?: string }
export interface ProjectDetail { project: Project; members: Membership[]; application: Application | null; invitation: Invitation | null }
export interface Bootstrap { viewer: Profile | null; community: Community | null; unreadCount: number; messageUnreadCount?: number }
export interface SearchInput { search?: string; interests?: string[]; roles?: string[]; availability?: string[]; activityMode?: ActivityMode; beginnerFriendly?: boolean; status?: ProjectStatus; sort?: 'recommended' | 'newest' | 'deadline'; cursor?: string; limit?: number }
export interface PaginationInput { cursor?: string; limit?: number }
export interface QueryMap {
  bootstrap: { input: Record<string, never>; output: Bootstrap };
  'projects.search': { input: SearchInput; output: Page<Project> };
  'projects.detail': { input: { id: string }; output: ProjectDetail };
  'people.search': { input: SearchInput; output: Page<Profile> };
  'people.detail': { input: { id: string }; output: Profile };
  'teams.mine': { input: PaginationInput; output: Page<Project> };
  'teams.history': { input: PaginationInput; output: Page<Project> };
  'teams.members': { input: PaginationInput & { projectId: string }; output: Page<Membership> };
  'applications.list': { input: PaginationInput & { projectId?: string }; output: Page<Application> };
  'invitations.list': { input: PaginationInput & { projectId?: string }; output: Page<Invitation> };
  'messages.list': { input: PaginationInput & { projectId: string }; output: Page<Message> };
  'notifications.list': { input: PaginationInput; output: Page<Notification> };
  'notifications.preferences': { input: Record<string, never>; output: NotificationPreferences };
  'saved.list': { input: PaginationInput; output: Page<Project> };
  'experiences.list': { input: PaginationInput & { userId?: string }; output: Page<Experience> };
  'blocks.list': { input: PaginationInput; output: Page<Block> };
  'account.status': { input: Record<string, never>; output: AccountStatus };
  'admin.session': { input: Record<string, never>; output: { userId: string; role: 'admin'; mfa: boolean } };
  'admin.overview': { input: Record<string, never>; output: { reports: number; users: number; projects: number; failedJobs: number } };
  'admin.reports': { input: PaginationInput & { status?: Report['status'] }; output: Page<Report> };
  'admin.report': { input: { id: string }; output: Report };
  'admin.audit': { input: PaginationInput; output: Page<AuditEntry> };
  'admin.jobs': { input: PaginationInput; output: Page<Job> };
  'admin.communities': { input: PaginationInput; output: Page<Community> };
}
export type ProfileInput = Omit<Profile, 'id' | 'communityId' | 'status' | 'reasons'>;
export type ProjectInput = Pick<Project, 'title' | 'goal' | 'description' | 'interests' | 'roles' | 'capacity' | 'activityMode' | 'availability' | 'deadline' | 'beginnerFriendly'> & { status?: ProjectStatus };
export interface CommandMap {
  'profile.update': { input: ProfileInput };
  'project.create': { input: ProjectInput };
  'project.update': { input: ProjectInput & { id: string } };
  'project.transition': { input: { id: string; status: ProjectStatus } };
  'project.disband': { input: { id: string } };
  'project.save': { input: { id: string; saved: boolean } };
  'application.submit': { input: { projectId: string; role: string; introduction: string } };
  'application.withdraw': { input: { id: string } };
  'application.review': { input: { id: string; decision: 'approved' | 'rejected' } };
  'invitation.send': { input: { projectId: string; inviteeId: string; role: string; message: string } };
  'invitation.respond': { input: { id: string; decision: 'accepted' | 'declined' } };
  'invitation.cancel': { input: { id: string } };
  'membership.leave': { input: { projectId: string } };
  'membership.remove': { input: { projectId: string; userId: string } };
  'membership.transfer': { input: { projectId: string; userId: string } };
  'message.send': { input: { projectId: string; body: string; clientId: string } };
  'message.delete': { input: { id: string } };
  'message.read': { input: { projectId: string; messageId: string } };
  'notification.read': { input: { id: string } };
  'notification.preferences': { input: NotificationPreferences };
  'device.register': { input: { token: string; platform: 'ios' | 'android' } };
  'device.unregister': { input: { token: string } };
  'report.create': { input: { targetType: ReportTarget; targetId: string; reason: string; detail: string } };
  'block.set': { input: { userId: string; blocked: boolean } };
  'experience.save': { input: { id?: string; projectId: string; title: string; description: string; role: string; isPublic: boolean } };
  'experience.delete': { input: { id: string } };
  'account.delete': { input: { confirmation: 'DELETE'; ownedTeams: 'archive' } };
  'community.join': { input: { code: string } };
  'admin.action': { input: { reportId?: string; targetType: ReportTarget | 'report'; targetId: string; action: 'hide' | 'restore' | 'suspend' | 'reactivate' | 'resolve' | 'dismiss'; note: string } };
  'admin.community': { input: { id?: string; name: string; status: 'active' | 'closed' } };
  'admin.invite': { input: { communityId: string; maxUses: number; expiresAt: string } };
  'admin.job.retry': { input: { id: string; note: string } };
}
export type QueryName = keyof QueryMap;
export type CommandName = keyof CommandMap;
export interface MutationResult { id: string; status?: string }
export interface DataEvent { scope: string; projectId?: string }
export interface AsyncStorageLike { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
export interface DataClient {
  readonly mode: DataMode;
  query<K extends QueryName>(name: K, input: QueryMap[K]['input'], options?: { signal?: AbortSignal }): Promise<QueryMap[K]['output']>;
  command<K extends CommandName>(name: K, input: CommandMap[K]['input'], idempotencyKey?: string): Promise<MutationResult>;
  subscribe(listener: (event: DataEvent) => void): () => void;
  dispose(): void;
}

export const INTERESTS = ['환경', '기술', '디자인', '콘텐츠', '사회문제', '과학', '창작'] as const;
export const ROLES = ['기획', '개발', '디자인', '리서치', '콘텐츠', '발표'] as const;
export const AVAILABILITY = ['평일 저녁', '주말 오전', '주말 오후', '방학'] as const;
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { draft: '초안', recruiting: '모집 중', active: '진행 중', completed: '완료', archived: '보관' };
export const TOKENS = { background: '#070807', card: '#11140F', raised: '#191D16', lime: '#B7FF32', limePressed: '#98D52A', text: '#F6F7F2', muted: '#A0A69A', border: 'rgba(255,255,255,0.12)' } as const;

const id = z.string().uuid();
const short = z.string().trim().min(1).max(80);
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const activityMode = z.enum(['online', 'offline', 'hybrid']);
const projectStatus = z.enum(['draft', 'recruiting', 'active', 'completed', 'archived']);
const timestamp = z.string().datetime({ offset: true });
const safeUrl = z.string().url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'http 또는 https 주소를 입력해 주세요.');
export const profileInputSchema = z.object({
  nickname: z.string().trim().min(2).max(24), avatar: z.string().min(1).max(120), interests: tags, roles: tags, learningRoles: tags,
  skills: tags, availability: tags, activityMode, bio: z.string().trim().max(500), discoverable: z.boolean(), links: z.array(safeUrl).max(3),
  educationLevel: z.enum(EDUCATION_LEVELS).nullable().optional(), onboardingCompleted: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.onboardingCompleted !== true) return;
  if (!value.educationLevel) context.addIssue({ code: 'custom', path: ['educationLevel'], message: '학교급을 선택해 주세요.' });
  if (!value.interests.length) context.addIssue({ code: 'custom', path: ['interests'], message: '관심 분야를 한 개 이상 선택해 주세요.' });
});
export const projectInputSchema = z.object({
  title: z.string().trim().min(3).max(80), goal: z.string().trim().min(5).max(200), description: z.string().trim().min(10).max(4000),
  interests: tags.min(1), roles: tags.min(1), capacity: z.number().int().min(2).max(20), activityMode, availability: tags.min(1),
  deadline: timestamp, beginnerFriendly: z.boolean(), status: projectStatus.optional(),
}).strict();
export const searchSchema = z.object({ search: z.string().trim().max(100).optional(), interests: tags.optional(), roles: tags.optional(), availability: tags.optional(), activityMode: activityMode.optional(), beginnerFriendly: z.boolean().optional(), status: projectStatus.optional(), sort: z.enum(['recommended', 'newest', 'deadline']).optional(), cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).optional() }).strict();
const idInput = z.object({ id }).strict();
const memberTarget = z.object({ projectId: id, userId: id }).strict();
const preferences = z.object({ push: z.boolean(), team: z.boolean(), applications: z.boolean() }).strict();
export const commandSchemas = {
  'profile.update': profileInputSchema,
  'project.create': projectInputSchema,
  'project.update': projectInputSchema.extend({ id }),
  'project.transition': z.object({ id, status: projectStatus }).strict(),
  'project.disband': idInput,
  'project.save': z.object({ id, saved: z.boolean() }).strict(),
  'application.submit': z.object({ projectId: id, role: short, introduction: z.string().trim().min(5).max(500) }).strict(),
  'application.withdraw': idInput,
  'application.review': z.object({ id, decision: z.enum(['approved', 'rejected']) }).strict(),
  'invitation.send': z.object({ projectId: id, inviteeId: id, role: short, message: z.string().trim().max(500) }).strict(),
  'invitation.respond': z.object({ id, decision: z.enum(['accepted', 'declined']) }).strict(),
  'invitation.cancel': idInput,
  'membership.leave': z.object({ projectId: id }).strict(),
  'membership.remove': memberTarget,
  'membership.transfer': memberTarget,
  'message.send': z.object({ projectId: id, body: z.string().trim().min(1).max(2000), clientId: id }).strict(),
  'message.delete': idInput,
  'message.read': z.object({ projectId: id, messageId: id }).strict(),
  'notification.read': idInput,
  'notification.preferences': preferences,
  'device.register': z.object({ token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/), platform: z.enum(['ios', 'android']) }).strict(),
  'device.unregister': z.object({ token: z.string().min(1).max(250) }).strict(),
  'report.create': z.object({ targetType: z.enum(['profile', 'project', 'message']), targetId: id, reason: short, detail: z.string().trim().max(2000) }).strict(),
  'block.set': z.object({ userId: id, blocked: z.boolean() }).strict(),
  'experience.save': z.object({ id: id.optional(), projectId: id, title: short, description: z.string().trim().min(5).max(2000), role: short, isPublic: z.boolean() }).strict(),
  'experience.delete': idInput,
  'account.delete': z.object({ confirmation: z.literal('DELETE'), ownedTeams: z.literal('archive') }).strict(),
  'community.join': z.object({ code: z.string().trim().min(8).max(128) }).strict(),
  'admin.action': z.object({ reportId: id.optional(), targetType: z.enum(['profile', 'project', 'message', 'report']), targetId: id, action: z.enum(['hide', 'restore', 'suspend', 'reactivate', 'resolve', 'dismiss']), note: z.string().trim().min(5).max(1000) }).strict(),
  'admin.community': z.object({ id: id.optional(), name: short, status: z.enum(['active', 'closed']) }).strict(),
  'admin.invite': z.object({ communityId: id, maxUses: z.number().int().min(1).max(100), expiresAt: timestamp }).strict(),
  'admin.job.retry': z.object({ id, note: z.string().trim().min(5).max(1000) }).strict(),
} satisfies Record<CommandName, z.ZodType>;
export function validateCommand<K extends CommandName>(name: K, input: unknown): CommandMap[K]['input'] {
  const result = commandSchemas[name].safeParse(input);
  if (!result.success) {
    const labels: Record<string, string> = { title: '제목', goal: '목표', description: '설명', nickname: '닉네임', body: '메시지', introduction: '자기소개', capacity: '정원', deadline: '마감일', links: '링크', role: '역할', note: '처리 메모', code: '초대코드' };
    const field = String(result.error.issues[0]?.path[0] ?? '');
    throw new AppError('VALIDATION', labels[field] ? `${labels[field]} 입력을 확인해 주세요.` : ERROR_MESSAGES.VALIDATION);
  }
  return result.data as CommandMap[K]['input'];
}
export function isSafeLink(value: string): boolean { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
export function assertRuntimeConfig(config: { mode: string; environment: string; url?: string; anonKey?: string }): asserts config is { mode: DataMode; environment: AppEnvironment; url?: string; anonKey?: string } {
  if (!['demo', 'supabase'].includes(config.mode) || !['development', 'staging', 'production'].includes(config.environment)) throw new AppError('CONFIGURATION', '실행 모드 또는 환경 설정이 올바르지 않아요.');
  if (config.environment === 'production' && config.mode === 'demo') throw new AppError('CONFIGURATION', '운영 빌드에서는 데모 모드를 사용할 수 없어요.');
  if (config.mode === 'supabase') {
    if (!config.url || !config.anonKey) throw new AppError('CONFIGURATION', 'Supabase URL과 공개 키가 필요해요.');
    if (/\s/.test(config.anonKey)) throw new AppError('CONFIGURATION', '공개 키에 공백이나 줄바꿈을 포함할 수 없어요.');
    let url: URL; try { url = new URL(config.url); } catch { throw new AppError('CONFIGURATION', '서버 주소가 올바르지 않아요.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && config.environment !== 'production' && url.protocol === 'http:')) throw new AppError('CONFIGURATION', '보안 연결(HTTPS)을 사용하는 서버 주소가 필요해요.');
    if (config.environment === 'production' && local) throw new AppError('CONFIGURATION', '운영 환경에는 접근 가능한 서버 주소가 필요해요.');
    if (config.anonKey.startsWith('sb_secret_')) throw new AppError('CONFIGURATION', '서버 비밀 키는 클라이언트에 사용할 수 없어요.');
    try {
      const middle = config.anonKey.split('.')[1];
      if (middle && typeof atob !== 'undefined') { const claims = JSON.parse(atob(middle.replace(/-/g, '+').replace(/_/g, '/'))); if (claims.role === 'service_role') throw new AppError('CONFIGURATION', '서버 관리자 키를 앱에 넣을 수 없어요.'); }
    } catch (error) { if (error instanceof AppError) throw error; }
  }
}

export { homeActivity, openRecruitments, recruitmentDeadline, urgentRecruitments } from './home-activity';
