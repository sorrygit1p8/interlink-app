import { AppError, EDUCATION_LEVELS, getProjectPurpose, validateCommand, searchSchema } from '@interlink/shared';
import type { DataClient, QueryMap, QueryName, CommandMap, CommandName, MutationResult, Profile, Project, Page, Application, Invitation } from '@interlink/shared';
import type { StorageAdapter } from './storage';
import { createDemoState, DEMO_ACTORS, DEMO_STORAGE_KEY, type DemoState, type DemoActor } from './fixtures';

export interface DemoClient extends DataClient {
  readonly mode: 'demo';
  readonly actor: DemoActor;
  ready(): Promise<void>;
  selectActor(actor: DemoActor): Promise<void>;
  reset(): Promise<void>;
  processDeletion(): Promise<void>;
}

type Event = { scope: string; projectId?: string };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const timestamp = () => new Date().toISOString();
// Legacy profiles predate tracked updates. Never assign reload time to them.
const LEGACY_PROFILE_UPDATED_AT = '1970-01-01T00:00:00.000Z';
export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // Demo IDs only. Real adapters require a cryptographic RNG, including on native.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
function fail(code: ConstructorParameters<typeof AppError>[0], message?: string): never { throw new AppError(code, message); }

function normalizeLegacyProjectPurposes(restored: DemoState, fixtures: Project[]): void {
  const unchangedFields = ['ownerId', 'communityId', 'title', 'goal', 'description', 'roles', 'capacity', 'memberCount', 'activityMode', 'availability', 'beginnerFriendly', 'status'] as const;
  for (const project of restored.projects) {
    const fixture = fixtures.find(item => item.id === project.id);
    const purpose = fixture && getProjectPurpose(fixture);
    if (!fixture || !purpose || project.updatedAt !== project.createdAt || !Array.isArray(project.interests)) continue;
    const originalInterests = fixture.interests.filter(interest => interest !== purpose);
    if (project.interests.length !== originalInterests.length || project.interests.some((interest, index) => interest !== originalInterests[index])) continue;
    if (unchangedFields.some(field => JSON.stringify(project[field]) !== JSON.stringify(fixture[field]))) continue;
    // Only append to untouched original fixture data. Normal commands persist the
    // result; loading never rewrites storage or replaces a user's saved edits.
    project.interests = [...project.interests, purpose];
  }
}

function page<T extends { id: string }>(items: T[], input: { cursor?: string; limit?: number } = {}): Page<T> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  if (!Number.isInteger(limit)) fail('VALIDATION');
  const offset = input.cursor ? items.findIndex((item) => item.id === input.cursor) + 1 : 0;
  if (input.cursor && offset === 0) fail('VALIDATION', '목록이 변경되었어요. 처음부터 다시 불러와 주세요.');
  const selected = items.slice(offset, offset + limit);
  return { items: selected, nextCursor: offset + limit < items.length ? selected.at(-1)!.id : null };
}

export function createDemoClient(options: { storage?: StorageAdapter; actor?: DemoActor } = {}): DemoClient {
  const initialState = (): DemoState => {
    const initial = createDemoState(options.actor);
    // Explicit actor fixtures stay ready to demonstrate team flows. A real local
    // first launch asks for the user's own choices without overwriting any save.
    if (options.actor === undefined) Object.assign(initial.profiles.find(profile => profile.id === DEMO_ACTORS.A)!, { nickname: '', interests: [], educationLevel: null, onboardingCompleted: false });
    return initial;
  };
  let state = initialState();
  let disposed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: Event) => void>();
  let ready = (async () => {
    if (!options.storage) return;
    try {
      const persisted = await options.storage.getItem(DEMO_STORAGE_KEY);
      if (persisted) {
        const restored = JSON.parse(persisted) as DemoState;
        const arrayFields = ['profiles', 'projects', 'memberships', 'applications', 'invitations', 'messages', 'notifications', 'experiences', 'reports', 'audit', 'jobs', 'communities', 'blocks', 'saved', 'devices', 'inviteCodes', 'hidden'] as const;
        const objectFields = ['preferences', 'readPositions', 'deletion', 'idempotency'] as const;
        if (restored.version !== 1 || arrayFields.some((key) => !Array.isArray(restored[key])) || objectFields.some((key) => !restored[key] || typeof restored[key] !== 'object') || !Object.hasOwn(DEMO_ACTORS, restored.actor)) fail('CONFIGURATION', '데모 저장 형식이 달라요. 데모 초기화를 실행해 주세요.');
        normalizeLegacyProjectPurposes(restored, state.projects);
        for (const profile of restored.profiles) {
          const validLevel = EDUCATION_LEVELS.some(level => level === profile.educationLevel);
          profile.educationLevel = validLevel ? profile.educationLevel : null;
          // Never infer completion from a legacy sample nickname or interests.
          profile.onboardingCompleted = profile.onboardingCompleted === true && validLevel && profile.nickname.trim().length >= 2 && profile.interests.length > 0;
        }
        state = restored;
        if (options.actor) state.actor = options.actor;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UNAVAILABLE', '데모 저장소를 읽을 수 없어요. 저장 공간을 확인해 주세요.');
    }
  })();
  // Rejection is surfaced by every operation / ready(), without global unhandled rejection.
  void ready.catch(() => undefined);
  const emit = (event: Event) => { for (const listener of listeners) { try { listener(event); } catch { /* An observer cannot roll back a committed command. */ } } };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation); tail = next.catch(() => undefined); return next;
  };
  const commit = async (next: DemoState, event: Event, broadcast = true) => {
    if (disposed) fail('UNAVAILABLE', '종료된 연결입니다.');
    try { await options.storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(next)); }
    catch { fail('UNAVAILABLE', '데모 변경을 저장하지 못했어요. 다시 시도해 주세요.'); }
    state = next; if (broadcast) emit(event);
  };
  const actorId = (current: DemoState) => DEMO_ACTORS[current.actor];
  const viewer = (current: DemoState, active = true): Profile => {
    const profile = current.profiles.find((item) => item.id === actorId(current));
    if (!profile) fail('UNAUTHENTICATED');
    if (active && profile.status !== 'active') fail('FORBIDDEN', '이 계정은 현재 활동할 수 없어요.');
    return profile;
  };
  const admin = (current: DemoState) => { viewer(current); if (current.actor !== 'admin') fail('FORBIDDEN'); };
  const blocked = (current: DemoState, first: string, second: string) => current.blocks.some((item) => (item.userId === first && item.blockedId === second) || (item.userId === second && item.blockedId === first));
  const communityAccess = (current: DemoState, communityId: string | null, userId = actorId(current)) => {
    const person = current.profiles.find((item) => item.id === userId);
    const approvals = current.communityMemberships?.[userId] ?? (person?.communityId ? [person.communityId] : []);
    return person?.status === 'active' && communityId !== null && approvals.includes(communityId) && current.communities.some((item) => item.id === communityId && item.status === 'active');
  };
  const member = (current: DemoState, projectId: string, userId = actorId(current)) => {
    const project = current.projects.find((item) => item.id === projectId);
    return Boolean(project && communityAccess(current, project.communityId, userId) && !current.hidden.includes(projectId) && current.memberships.some((item) => item.projectId === projectId && item.userId === userId && item.active));
  };
  const profileVisible = (current: DemoState, person: Profile): boolean => person.id === actorId(current) || person.status === 'active' && person.discoverable && !current.hidden.includes(person.id) && communityAccess(current, person.communityId) && !blocked(current, person.id, actorId(current));
  const projectById = (current: DemoState, id: string): Project => {
    const project = current.projects.find((item) => item.id === id);
    if (!project) fail('NOT_FOUND');
    return project;
  };
  const projectVisible = (current: DemoState, project: Project): boolean => {
    const me = viewer(current);
    if (current.hidden.includes(project.id) || !communityAccess(current, project.communityId)) return false;
    if (member(current, project.id) || project.ownerId === me.id) return true;
    return project.status !== 'draft' && current.profiles.some((item) => item.id === project.ownerId && item.status === 'active') && !blocked(current, me.id, project.ownerId);
  };
  const owned = (current: DemoState, projectId: string): Project => {
    const project = projectById(current, projectId);
    if (project.ownerId !== actorId(current) || !communityAccess(current, project.communityId) || current.hidden.includes(projectId)) fail('FORBIDDEN');
    return project;
  };
  const team = (current: DemoState, projectId: string): Project => {
    viewer(current);
    const project = projectById(current, projectId);
    if (!member(current, projectId) || current.hidden.includes(projectId)) fail('FORBIDDEN');
    return project;
  };
  const eligible = (current: DemoState, project: Project, userId: string) => {
    const user = current.profiles.find((item) => item.id === userId);
    if (!user || !communityAccess(current, project.communityId, userId) || !current.profiles.some((person) => person.id === project.ownerId && person.status === 'active') || blocked(current, project.ownerId, userId) || current.hidden.includes(project.id)) fail('FORBIDDEN');
    if (project.status !== 'recruiting' || Date.parse(project.deadline) <= Date.now()) fail('CLOSED');
    if (project.memberCount >= project.capacity) fail('FULL');
    if (member(current, project.id, userId)) fail('DUPLICATE');
  };
  const notify = (current: DemoState, userId: string, type: string, title: string, projectId?: string) => {
    const actor = actorId(current);
    if (actor === userId || current.profiles.find((profile) => profile.id === userId)?.status !== 'active' || blocked(current, actor, userId)) return;
    const preferences = current.preferences[userId];
    if (preferences && ((type === 'message' || type === 'team') ? !preferences.team : !preferences.applications)) return;
    current.notifications.unshift({ id: newId(), userId, actorId: actor, type, title, ...(projectId ? { projectId } : {}), read: false, createdAt: timestamp() });
  };
  const refreshCounts = (current: DemoState, project: Project) => {
    project.memberCount = current.memberships.filter((item) => item.projectId === project.id && item.active).length;
    project.updatedAt = timestamp();
  };
  const join = (current: DemoState, project: Project, userId: string, role: string) => {
    eligible(current, project, userId);
    const person = current.profiles.find((profile) => profile.id === userId)!;
    const old = current.memberships.find((item) => item.projectId === project.id && item.userId === userId);
    if (old) Object.assign(old, { active: true, role, joinedAt: timestamp() });
    else current.memberships.push({ id: newId(), projectId: project.id, userId, role, nickname: person.nickname, avatar: person.avatar, active: true, joinedAt: timestamp() });
    refreshCounts(current, project);
    current.applications.filter((item) => item.projectId === project.id && item.userId === userId && item.status === 'pending').forEach((item) => { item.status = 'approved'; });
    current.invitations.filter((item) => item.projectId === project.id && item.inviteeId === userId && item.status === 'pending').forEach((item) => { item.status = 'accepted'; });
    notify(current, userId, 'team', '새로운 팀에 함께하게 되었어요.', project.id);
    notify(current, project.ownerId, 'team', '팀원이 새롭게 합류했어요.', project.id);
  };
  const decorateProject = (current: DemoState, project: Project): Project => {
    const me = viewer(current);
    const reasons = [
      ...project.roles.filter((role) => me.roles.includes(role) || me.learningRoles.includes(role)).map((role) => `${role} 역할 일치`),
      ...project.interests.filter((interest) => me.interests.includes(interest)).map((interest) => `${interest} 관심`),
      ...project.availability.filter((time) => me.availability.includes(time)).map((time) => `${time} 참여 가능`),
    ];
    const lastRead = current.messages.find((item) => item.id === current.readPositions[`${me.id}:${project.id}`]);
    const unreadCount = member(current, project.id) ? current.messages.filter((item) => item.projectId === project.id && item.authorId !== me.id && !item.deleted && !current.hidden.includes(item.id) && !blocked(current, item.authorId, me.id) && (!lastRead || item.createdAt > lastRead.createdAt || item.createdAt === lastRead.createdAt && item.id > lastRead.id)).length : 0;
    return { ...project, saved: current.saved.some((item) => item.userId === me.id && item.projectId === project.id), reasons, unreadCount };
  };

  function read<K extends QueryName>(name: K, input: QueryMap[K]['input']): QueryMap[K]['output'] {
    const me = viewer(state, name !== 'account.status' && name !== 'bootstrap');
    let result: unknown;
    switch (name) {
      case 'bootstrap': result = { viewer: me, community: state.communities.find((item) => item.id === me.communityId && communityAccess(state, item.id)) ?? null, unreadCount: state.notifications.filter((item) => item.userId === me.id && !item.read && (!item.actorId || !blocked(state, me.id, item.actorId))).length, messageUnreadCount: me.status === 'active' ? state.projects.filter((project) => member(state, project.id)).reduce((sum, project) => sum + (decorateProject(state, project).unreadCount ?? 0), 0) : 0 }; break;
      case 'projects.search': {
        const criteria = input as QueryMap['projects.search']['input'];
        let projects = state.projects.filter((project) => projectVisible(state, project) && project.status !== 'draft' && project.status !== 'archived' && !blocked(state, me.id, project.ownerId) && state.profiles.some((person) => person.id === project.ownerId && person.status === 'active') && project.status === (criteria.status || 'recruiting'));
        if (!criteria.status || criteria.status === 'recruiting') projects = projects.filter((project) => Date.parse(project.deadline) > Date.now() && project.memberCount < project.capacity);
        if (criteria.search) projects = projects.filter((project) => `${project.title} ${project.goal} ${project.description}`.toLocaleLowerCase().includes(criteria.search!.trim().toLocaleLowerCase()));
        if (criteria.interests?.length) projects = projects.filter((project) => criteria.interests!.some((item) => project.interests.includes(item)));
        if (criteria.roles?.length) projects = projects.filter((project) => criteria.roles!.some((item) => project.roles.includes(item)));
        if (criteria.availability?.length) projects = projects.filter((project) => criteria.availability!.some((item) => project.availability.includes(item)));
        if (criteria.activityMode) projects = projects.filter((project) => project.activityMode === criteria.activityMode);
        if (criteria.beginnerFriendly !== undefined) projects = projects.filter((project) => project.beginnerFriendly === criteria.beginnerFriendly);
        const decorated = projects.map((project) => decorateProject(state, project));
        decorated.sort((a, b) => criteria.sort === 'deadline' ? a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id) : criteria.sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id) : (b.reasons?.length ?? 0) - (a.reasons?.length ?? 0) || a.id.localeCompare(b.id));
        result = page(decorated, criteria); break;
      }
      case 'projects.detail': {
        const project = projectById(state, (input as QueryMap['projects.detail']['input']).id);
        if (!projectVisible(state, project)) fail('NOT_FOUND');
        const invitation = [...state.invitations].reverse().find((item) => item.projectId === project.id && item.inviteeId === me.id);
        result = { project: decorateProject(state, project), members: state.memberships.filter((item) => item.projectId === project.id && item.active), application: [...state.applications].reverse().find((item) => item.projectId === project.id && item.userId === me.id) ?? null, invitation: invitation ? { ...invitation, status: invitation.status === 'pending' && Date.parse(invitation.expiresAt) <= Date.now() ? 'expired' : invitation.status } : null }; break;
      }
      case 'people.search': {
        const criteria = input as QueryMap['people.search']['input'];
        let profiles = state.profiles.filter((person) => person.id !== me.id && profileVisible(state, person));
        if (criteria.search) profiles = profiles.filter((person) => `${person.nickname} ${person.bio}`.toLocaleLowerCase().includes(criteria.search!.trim().toLocaleLowerCase()));
        if (criteria.interests?.length) profiles = profiles.filter((person) => criteria.interests!.some((item) => person.interests.includes(item)));
        if (criteria.roles?.length) profiles = profiles.filter((person) => criteria.roles!.some((item) => person.roles.includes(item) || person.learningRoles.includes(item)));
        if (criteria.availability?.length) profiles = profiles.filter((person) => criteria.availability!.some((item) => person.availability.includes(item)));
        if (criteria.activityMode) profiles = profiles.filter((person) => person.activityMode === criteria.activityMode);
        const decorated = profiles.map((person) => ({ ...person, reasons: [...person.interests.filter((item) => me.interests.includes(item)).map((item) => `${item} 관심`), ...person.roles.filter((item) => me.roles.includes(item) || me.learningRoles.includes(item)).map((item) => `${item} 역할 일치`), ...person.availability.filter((item) => me.availability.includes(item)).map((item) => `${item} 참여 가능`)] }));
        const updatedAt = (id: string) => state.profileUpdatedAt?.[id] ?? LEGACY_PROFILE_UPDATED_AT;
        decorated.sort((a, b) => ((!criteria.sort || criteria.sort === 'recommended') ? b.reasons.length - a.reasons.length : 0) || updatedAt(b.id).localeCompare(updatedAt(a.id)) || b.id.localeCompare(a.id));
        result = page(decorated, criteria); break;
      }
      case 'people.detail': {
        const person = state.profiles.find((item) => item.id === (input as QueryMap['people.detail']['input']).id);
        if (!person || !profileVisible(state, person)) fail('NOT_FOUND');
        result = person; break;
      }
      case 'teams.mine': result = page(state.projects.filter((project) => member(state, project.id)).map((project) => decorateProject(state, project)), input as QueryMap['teams.mine']['input']); break;
      case 'teams.history': {
        const projects = state.projects.filter((project) => state.memberships.some((item) => item.projectId === project.id && item.userId === me.id) && communityAccess(state, project.communityId) && !state.hidden.includes(project.id) && !blocked(state, me.id, project.ownerId));
        result = page(projects.map((project) => ({ ...project, title: state.profiles.find((person) => person.id === project.ownerId)?.status === 'deleted' ? '종료된 프로젝트' : project.title, goal: '', description: '', interests: [], roles: [], availability: [], memberCount: 0, saved: false, unreadCount: 0 })), input as QueryMap['teams.history']['input']); break;
      }
      case 'teams.members': { const criteria = input as QueryMap['teams.members']['input']; const id = criteria.projectId; team(state, id); result = page(state.memberships.filter((item) => item.projectId === id && item.active), criteria); break; }
      case 'applications.list': {
        const criteria = input as QueryMap['applications.list']['input']; const projectId = criteria.projectId;
        if (projectId) owned(state, projectId);
        result = page(state.applications.filter((item) => projectId ? item.projectId === projectId : item.userId === me.id || state.projects.some((project) => project.id === item.projectId && project.ownerId === me.id && communityAccess(state, project.communityId))).map((item) => ({ ...item, nickname: state.profiles.find((person) => person.id === item.userId)?.nickname, projectTitle: state.projects.find((project) => project.id === item.projectId)?.title })), criteria); break;
      }
      case 'invitations.list': {
        const criteria = input as QueryMap['invitations.list']['input']; const projectId = criteria.projectId;
        if (projectId) owned(state, projectId);
        result = page(state.invitations.filter((item) => projectId ? item.projectId === projectId : item.inviteeId === me.id || item.inviterId === me.id || state.projects.some((project) => project.id === item.projectId && project.ownerId === me.id && communityAccess(state, project.communityId))).map((item) => ({ ...item, status: item.status === 'pending' && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : item.status, nickname: state.profiles.find((person) => person.id === item.inviteeId)?.nickname, projectTitle: state.projects.find((project) => project.id === item.projectId)?.title })), criteria); break;
      }
      case 'messages.list': {
        const criteria = input as QueryMap['messages.list']['input']; team(state, criteria.projectId);
        result = page(state.messages.filter((item) => item.projectId === criteria.projectId).map((item) => {
          const author = state.profiles.find((person) => person.id === item.authorId);
          const visible = { ...item, authorName: author && (author.status === 'deleting' || author.status === 'deleted') ? '탈퇴한 팀원' : author?.nickname ?? item.authorName };
          return item.deleted || blocked(state, item.authorId, me.id) || state.hidden.includes(item.id) ? { ...visible, body: '', deleted: true } : visible;
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), criteria); break;
      }
      case 'notifications.list': result = page(state.notifications.filter((item) => item.userId === me.id && (!item.actorId || !blocked(state, me.id, item.actorId))).map((item) => { const visible = { ...item }; delete visible.actorId; return visible; }), input as QueryMap['notifications.list']['input']); break;
      case 'notifications.preferences': result = state.preferences[me.id] ?? { push: false, team: true, applications: true }; break;
      case 'saved.list': result = page(state.projects.filter((project) => projectVisible(state, project) && state.saved.some((item) => item.userId === me.id && item.projectId === project.id)).map((project) => decorateProject(state, project)), input as QueryMap['saved.list']['input']); break;
      case 'experiences.list': { const criteria = input as QueryMap['experiences.list']['input']; const userId = criteria.userId ?? me.id; const person = state.profiles.find((item) => item.id === userId); if (!person || !profileVisible(state, person)) fail('NOT_FOUND'); result = page(state.experiences.filter((item) => item.userId === userId && (userId === me.id || item.isPublic)), criteria); break; }
      case 'blocks.list': result = page(state.blocks.filter((item) => item.userId === me.id).map((item) => ({ id: item.id, blockedId: item.blockedId, nickname: state.profiles.find((person) => person.id === item.blockedId)?.nickname ?? '알 수 없는 사용자', createdAt: item.createdAt })), input as QueryMap['blocks.list']['input']); break;
      case 'account.status': result = { status: me.status, ...(state.deletion[me.id] ? { deletionRequestId: state.deletion[me.id]!.id, deletionStatus: state.deletion[me.id]!.status } : {}) }; break;
      case 'admin.session': admin(state); result = { userId: me.id, role: 'admin', mfa: false }; break;
      case 'admin.overview': admin(state); result = { reports: state.reports.filter((item) => item.status === 'open' || item.status === 'reviewing').length, users: state.profiles.filter((person) => person.status === 'active').length, projects: state.projects.length, failedJobs: state.jobs.filter((item) => item.status === 'failed').length }; break;
      case 'admin.reports': { admin(state); const criteria = input as QueryMap['admin.reports']['input']; result = page(state.reports.filter((item) => !criteria.status || item.status === criteria.status).map((item) => { const result = { ...item }; delete result.content; return result; }), criteria); break; }
      case 'admin.report': { admin(state); result = state.reports.find((item) => item.id === (input as QueryMap['admin.report']['input']).id); if (!result) fail('NOT_FOUND'); break; }
      case 'admin.audit': admin(state); result = page(state.audit, input as QueryMap['admin.audit']['input']); break;
      case 'admin.jobs': admin(state); result = page(state.jobs, input as QueryMap['admin.jobs']['input']); break;
      case 'admin.communities': admin(state); result = page(state.communities, input as QueryMap['admin.communities']['input']); break;
      default: fail('VALIDATION');
    }
    return clone(result) as QueryMap[K]['output'];
  }

  function mutate<K extends CommandName>(current: DemoState, name: K, input: CommandMap[K]['input']): MutationResult {
    const me = viewer(current, name !== 'account.delete' && name !== 'device.unregister');
    const now = timestamp();
    switch (name) {
      case 'profile.update': {
        const value = input as CommandMap['profile.update']['input'];
        if (me.onboardingCompleted && value.onboardingCompleted === false) fail('VALIDATION', '완료한 시작 설정은 프로필 수정으로 되돌릴 수 없어요.');
        const merged = validateCommand('profile.update', {
          ...value,
          educationLevel: value.educationLevel === undefined ? me.educationLevel ?? null : value.educationLevel,
          onboardingCompleted: value.onboardingCompleted === undefined ? me.onboardingCompleted === true : value.onboardingCompleted,
        });
        Object.assign(me, merged);
        (current.profileUpdatedAt ??= {})[me.id] = now;
        current.memberships.filter((item) => item.userId === me.id).forEach((item) => { item.nickname = me.nickname; item.avatar = me.avatar; });
        return { id: me.id };
      }
      case 'project.create': {
        const value = input as CommandMap['project.create']['input'];
        if (!me.communityId || !current.communities.some((community) => community.id === me.communityId && community.status === 'active')) fail('FORBIDDEN');
        if (Date.parse(value.deadline) <= Date.now()) fail('VALIDATION', '모집 마감은 현재보다 뒤여야 해요.');
        if (value.status && value.status !== 'draft' && value.status !== 'recruiting') fail('VALIDATION');
        const id = newId(); const project: Project = { ...value, id, ownerId: me.id, communityId: me.communityId, memberCount: 1, status: value.status ?? 'recruiting', createdAt: now, updatedAt: now };
        current.projects.unshift(project); current.memberships.push({ id: newId(), projectId: id, userId: me.id, nickname: me.nickname, avatar: me.avatar, active: true, role: '팀장', joinedAt: now }); return { id };
      }
      case 'project.update': {
        const value = input as CommandMap['project.update']['input']; const project = owned(current, value.id);
        if (project.status === 'completed' || project.status === 'archived') fail('CLOSED');
        if ((project.status === 'draft' || project.status === 'recruiting') && Date.parse(value.deadline) <= Date.now()) fail('VALIDATION');
        if (value.capacity < project.memberCount) fail('FULL', '현재 팀원 수보다 정원을 줄일 수 없어요.');
        if (value.status && value.status !== project.status) fail('CONFLICT', '상태 변경 기능을 사용해 주세요.');
        Object.assign(project, value, { updatedAt: now }); return { id: project.id };
      }
      case 'project.disband': {
        const value = input as CommandMap['project.disband']['input'];
        const project = owned(current, value.id);
        const members = current.memberships.filter(item => item.projectId === project.id && item.active);
        const applications = current.applications.filter(item => item.projectId === project.id && item.status === 'pending');
        const invitations = current.invitations.filter(item => item.projectId === project.id && item.status === 'pending');
        if (project.status === 'archived' && !members.length && !applications.length && !invitations.length) return { id: project.id, status: 'archived' };
        project.status = 'archived';
        applications.forEach(item => { item.status = 'rejected'; });
        invitations.forEach(item => { item.status = 'cancelled'; });
        members.forEach(item => {
          item.active = false;
          notify(current, item.userId, 'team', '팀이 해체되어 참여가 종료되었어요.', project.id);
        });
        refreshCounts(current, project);
        return { id: project.id, status: 'archived' };
      }
      case 'project.transition': {
        const value = input as CommandMap['project.transition']['input']; const project = owned(current, value.id);
        const transitions: Record<Project['status'], Project['status'][]> = { draft: ['recruiting', 'archived'], recruiting: ['active', 'archived'], active: ['completed', 'archived'], completed: ['archived'], archived: [] };
        if (!transitions[project.status].includes(value.status)) fail('CONFLICT', '가능하지 않은 상태 변경이에요.');
        if (value.status === 'recruiting' && Date.parse(project.deadline) <= Date.now()) fail('CLOSED');
        project.status = value.status; project.updatedAt = now;
        if (value.status !== 'recruiting') { current.applications.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'rejected'; notify(current, item.userId, 'application', '프로젝트의 모집이 종료되었어요.', project.id); }); current.invitations.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'cancelled'; }); }
        return { id: project.id, status: value.status };
      }
      case 'project.save': { const value = input as CommandMap['project.save']['input']; const project = projectById(current, value.id); if (!projectVisible(current, project)) fail('FORBIDDEN'); current.saved = current.saved.filter((item) => item.userId !== me.id || item.projectId !== value.id); if (value.saved) current.saved.push({ userId: me.id, projectId: value.id }); return { id: value.id }; }
      case 'application.submit': {
        const value = input as CommandMap['application.submit']['input']; const project = projectById(current, value.projectId); eligible(current, project, me.id);
        if (!project.roles.includes(value.role)) fail('VALIDATION', '모집 중인 역할을 선택해 주세요.');
        if (current.applications.some((item) => item.projectId === project.id && item.userId === me.id && item.status === 'pending') || current.invitations.some((item) => item.projectId === project.id && item.inviteeId === me.id && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now())) fail('DUPLICATE', '이미 신청 또는 초대가 대기 중이에요.');
        const application: Application = { id: newId(), ...value, userId: me.id, status: 'pending', createdAt: now }; current.applications.push(application); notify(current, project.ownerId, 'application', '새로운 참여 신청이 도착했어요.', project.id); return { id: application.id, status: 'pending' };
      }
      case 'application.withdraw': { const value = input as CommandMap['application.withdraw']['input']; const item = current.applications.find((application) => application.id === value.id); if (!item) fail('NOT_FOUND'); if (item.userId !== me.id) fail('FORBIDDEN'); if (item.status !== 'pending') fail('CONFLICT'); item.status = 'withdrawn'; return { id: item.id, status: item.status }; }
      case 'application.review': {
        const value = input as CommandMap['application.review']['input']; const item = current.applications.find((application) => application.id === value.id); if (!item) fail('NOT_FOUND'); const project = owned(current, item.projectId); if (item.status !== 'pending') fail('CONFLICT');
        if (value.decision === 'approved') join(current, project, item.userId, item.role); else { item.status = 'rejected'; notify(current, item.userId, 'application', '참여 신청 결과를 확인해 주세요.', project.id); }
        return { id: item.id, status: value.decision };
      }
      case 'invitation.send': {
        const value = input as CommandMap['invitation.send']['input']; const project = owned(current, value.projectId); eligible(current, project, value.inviteeId);
        if (!project.roles.includes(value.role)) fail('VALIDATION', '모집 중인 역할을 선택해 주세요.');
        if (!current.profiles.find((person) => person.id === value.inviteeId)?.discoverable) fail('FORBIDDEN');
        if (current.invitations.some((item) => item.projectId === project.id && item.inviteeId === value.inviteeId && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now()) || current.applications.some((item) => item.projectId === project.id && item.userId === value.inviteeId && item.status === 'pending')) fail('DUPLICATE');
        const invitation: Invitation = { ...value, id: newId(), inviterId: me.id, status: 'pending', expiresAt: new Date(Math.min(Date.parse(project.deadline), Date.now() + 7 * 86400000)).toISOString(), createdAt: now }; current.invitations.push(invitation); notify(current, value.inviteeId, 'invitation', '함께할 팀의 초대가 도착했어요.', project.id); return { id: invitation.id, status: 'pending' };
      }
      case 'invitation.respond': {
        const value = input as CommandMap['invitation.respond']['input']; const item = current.invitations.find((invitation) => invitation.id === value.id); if (!item) fail('NOT_FOUND'); if (item.inviteeId !== me.id) fail('FORBIDDEN'); if (item.status !== 'pending') fail('CONFLICT'); if (Date.parse(item.expiresAt) <= Date.now()) fail('CLOSED');
        if (value.decision === 'accepted') join(current, projectById(current, item.projectId), me.id, item.role); else item.status = 'declined'; return { id: item.id, status: value.decision };
      }
      case 'invitation.cancel': { const value = input as CommandMap['invitation.cancel']['input']; const item = current.invitations.find((invitation) => invitation.id === value.id); if (!item) fail('NOT_FOUND'); owned(current, item.projectId); if (item.status !== 'pending') fail('CONFLICT'); item.status = 'cancelled'; return { id: item.id, status: item.status }; }
      case 'membership.leave': { const value = input as CommandMap['membership.leave']['input']; const project = team(current, value.projectId); if (project.ownerId === me.id && project.status !== 'archived') fail('CONFLICT', '팀장은 먼저 소유권을 이전하거나 프로젝트를 보관해 주세요.'); current.memberships.filter((item) => item.projectId === project.id && item.userId === me.id).forEach((item) => { item.active = false; }); refreshCounts(current, project); return { id: project.id }; }
      case 'membership.remove': { const value = input as CommandMap['membership.remove']['input']; const project = owned(current, value.projectId); if (value.userId === me.id) fail('CONFLICT'); const item = current.memberships.find((membership) => membership.projectId === project.id && membership.userId === value.userId && membership.active); if (!item) fail('NOT_FOUND'); item.active = false; refreshCounts(current, project); notify(current, value.userId, 'team', '팀 참여가 종료되었어요.', project.id); return { id: item.id }; }
      case 'membership.transfer': { const value = input as CommandMap['membership.transfer']['input']; const project = owned(current, value.projectId); if (value.userId === me.id || !member(current, project.id, value.userId) || current.profiles.find((person) => person.id === value.userId)?.status !== 'active') fail('VALIDATION'); project.ownerId = value.userId; project.updatedAt = now; notify(current, value.userId, 'team', '팀 운영 권한을 받았어요.', project.id); return { id: project.id }; }
      case 'message.send': {
        const value = input as CommandMap['message.send']['input']; const project = team(current, value.projectId); if (project.status !== 'recruiting' && project.status !== 'active') fail('CLOSED');
        const existing = current.messages.find((item) => item.authorId === me.id && item.clientId === value.clientId); if (existing) { if (existing.projectId !== value.projectId || existing.body !== value.body && !existing.deleted) fail('CONFLICT'); return { id: existing.id }; }
        const id = newId(); const previousTime = current.messages.reduce((latest, message) => Math.max(latest, Date.parse(message.createdAt)), 0);
        const sentAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
        current.messages.push({ ...value, id, authorId: me.id, authorName: me.nickname, createdAt: sentAt, deleted: false });
        current.memberships.filter((item) => item.projectId === project.id && item.active && item.userId !== me.id && !blocked(current, item.userId, me.id)).forEach((item) => notify(current, item.userId, 'message', '팀에 새 메시지가 도착했어요.', project.id)); return { id };
      }
      case 'message.delete': { const value = input as CommandMap['message.delete']['input']; const message = current.messages.find((item) => item.id === value.id); if (!message) fail('NOT_FOUND'); team(current, message.projectId); if (message.authorId !== me.id) fail('FORBIDDEN'); message.deleted = true; message.body = ''; return { id: message.id }; }
      case 'message.read': { const value = input as CommandMap['message.read']['input']; team(current, value.projectId); const message = current.messages.find((item) => item.id === value.messageId && item.projectId === value.projectId); if (!message) fail('NOT_FOUND'); const key = `${me.id}:${value.projectId}`; const previous = current.messages.find((item) => item.id === current.readPositions[key]); if (!previous || previous.createdAt < message.createdAt || previous.createdAt === message.createdAt && previous.id < message.id) current.readPositions[key] = message.id; current.notifications.filter((item) => item.userId === me.id && item.projectId === value.projectId && item.type === 'message' && item.createdAt <= message.createdAt).forEach((item) => { item.read = true; }); return { id: message.id }; }
      case 'notification.read': { const value = input as CommandMap['notification.read']['input']; const item = current.notifications.find((notification) => notification.id === value.id); if (!item) fail('NOT_FOUND'); if (item.userId !== me.id) fail('FORBIDDEN'); item.read = true; return { id: item.id }; }
      case 'notification.preferences': current.preferences[me.id] = input as CommandMap['notification.preferences']['input']; return { id: me.id };
      case 'device.register': { const value = input as CommandMap['device.register']['input']; current.devices = current.devices.filter((item) => item.token !== value.token); current.devices.push({ ...value, userId: me.id }); return { id: me.id }; }
      case 'device.unregister': { const value = input as CommandMap['device.unregister']['input']; current.devices = current.devices.filter((item) => item.userId !== me.id || item.token !== value.token); return { id: me.id }; }
      case 'report.create': {
        const value = input as CommandMap['report.create']['input']; let content: string | undefined;
        if (value.targetType === 'project') { const project = projectById(current, value.targetId); if (!projectVisible(current, project)) fail('NOT_FOUND'); content = project.description; }
        else if (value.targetType === 'profile') { const person = current.profiles.find((item) => item.id === value.targetId); if (!person || !profileVisible(current, person)) fail('NOT_FOUND'); content = person.bio; }
        else { const message = current.messages.find((item) => item.id === value.targetId); if (!message) fail('NOT_FOUND'); team(current, message.projectId); content = message.deleted ? '삭제된 메시지' : message.body; }
        if (current.reports.some((item) => item.reporterId === me.id && item.targetId === value.targetId && ['open', 'reviewing'].includes(item.status))) fail('DUPLICATE');
        const id = newId(); current.reports.unshift({ ...value, id, reporterId: me.id, status: 'open', createdAt: now, content }); return { id, status: 'open' };
      }
      case 'block.set': {
        const value = input as CommandMap['block.set']['input']; if (value.userId === me.id) fail('VALIDATION'); const target = current.profiles.find((item) => item.id === value.userId); if (!target) fail('NOT_FOUND');
        if (value.blocked && !current.blocks.some((item) => item.userId === me.id && item.blockedId === target.id) && !profileVisible(current, target) && !current.memberships.some((item) => item.userId === target.id && item.active && member(current, item.projectId))) fail('NOT_FOUND');
        current.blocks = current.blocks.filter((item) => item.userId !== me.id || item.blockedId !== value.userId);
        if (value.blocked) { current.blocks.push({ id: newId(), userId: me.id, blockedId: value.userId, createdAt: now }); current.invitations.filter((item) => item.status === 'pending' && (item.inviterId === me.id && item.inviteeId === value.userId || item.inviterId === value.userId && item.inviteeId === me.id)).forEach((item) => { item.status = 'cancelled'; }); current.applications.filter((item) => item.status === 'pending' && current.projects.some((project) => project.id === item.projectId && (project.ownerId === me.id && item.userId === value.userId || project.ownerId === value.userId && item.userId === me.id))).forEach((item) => { item.status = 'withdrawn'; }); }
        return { id: value.userId };
      }
      case 'experience.save': { const value = input as CommandMap['experience.save']['input']; if (!current.memberships.some((item) => item.projectId === value.projectId && item.userId === me.id)) fail('FORBIDDEN'); const old = value.id ? current.experiences.find((item) => item.id === value.id) : undefined; if (value.id && !old || old && old.projectId !== value.projectId) fail('NOT_FOUND'); if (old && old.userId !== me.id) fail('FORBIDDEN'); const id = old?.id ?? newId(); if (old) Object.assign(old, value); else current.experiences.unshift({ ...value, id, userId: me.id, createdAt: now }); return { id }; }
      case 'experience.delete': { const value = input as CommandMap['experience.delete']['input']; const item = current.experiences.find((experience) => experience.id === value.id); if (!item) fail('NOT_FOUND'); if (item.userId !== me.id) fail('FORBIDDEN'); current.experiences = current.experiences.filter((experience) => experience.id !== value.id); return { id: value.id }; }
      case 'account.delete': {
        const value = input as CommandMap['account.delete']['input']; if (value.confirmation !== 'DELETE' || value.ownedTeams !== 'archive') fail('VALIDATION');
        const existing = current.deletion[me.id]; if (existing) return { id: existing.id, status: existing.status };
        const id = newId(); me.status = 'deleting'; me.discoverable = false;
        current.projects.filter((project) => project.ownerId === me.id).forEach((project) => {
          project.status = 'archived'; project.updatedAt = now;
          current.applications.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'rejected'; });
          current.invitations.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'cancelled'; });
        });
        current.memberships.filter((item) => item.userId === me.id).forEach((item) => { item.active = false; item.nickname = '탈퇴한 팀원'; });
        current.projects.forEach((project) => refreshCounts(current, project));
        current.applications.filter((item) => item.userId === me.id && item.status === 'pending').forEach((item) => { item.status = 'withdrawn'; });
        current.invitations.filter((item) => (item.inviterId === me.id || item.inviteeId === me.id) && item.status === 'pending').forEach((item) => { item.status = 'cancelled'; });
        current.deletion[me.id] = { id, status: 'requested' }; current.jobs.push({ id, kind: 'deletion', status: 'pending', attempts: 0, nextAttemptAt: now, lastError: '' }); current.devices = current.devices.filter((item) => item.userId !== me.id); return { id, status: 'requested' };
      }
      case 'community.join': { const value = input as CommandMap['community.join']['input']; const code = current.inviteCodes.find((item) => item.id === value.code.trim().toLowerCase()); if (!code || Date.parse(code.expiresAt) <= Date.now() || code.uses.length >= code.maxUses || !current.communities.some((item) => item.id === code.communityId && item.status === 'active')) fail('FORBIDDEN', '초대코드가 유효하지 않아요.'); if (communityAccess(current, code.communityId)) fail('DUPLICATE');
        current.communityMemberships ??= Object.fromEntries(current.profiles.map((person) => [person.id, person.communityId ? [person.communityId] : []]));
        (current.communityMemberships[me.id] ??= []).push(code.communityId);
        code.uses.push(me.id); me.communityId = code.communityId; (current.profileUpdatedAt ??= {})[me.id] = now; current.communities.forEach((community) => { community.memberCount = Object.values(current.communityMemberships!).filter((ids) => ids.includes(community.id)).length; }); return { id: code.communityId, status: 'approved' }; }
      case 'admin.action': {
        admin(current); const value = input as CommandMap['admin.action']['input'];
        const linkedReport = value.reportId ? current.reports.find((item) => item.id === value.reportId) : undefined;
        if (value.reportId && (!linkedReport || !(value.targetType === 'report' ? linkedReport.id === value.targetId : linkedReport.targetType === value.targetType && linkedReport.targetId === value.targetId))) fail('FORBIDDEN');
        if (value.targetType === 'message' && !current.reports.some((item) => item.targetType === 'message' && item.targetId === value.targetId)) fail('FORBIDDEN');
        const target = value.targetType === 'profile' ? current.profiles.find((item) => item.id === value.targetId) : value.targetType === 'project' ? current.projects.find((item) => item.id === value.targetId) : value.targetType === 'message' ? current.messages.find((item) => item.id === value.targetId) : current.reports.find((item) => item.id === value.targetId);
        if (!target) fail('NOT_FOUND');
        if (value.action === 'hide' || value.action === 'restore') { if (value.targetType === 'report') fail('VALIDATION'); current.hidden = current.hidden.filter((id) => id !== value.targetId); if (value.action === 'hide') current.hidden.push(value.targetId); }
        else if (value.action === 'suspend' || value.action === 'reactivate') { if (value.targetType !== 'profile' || value.targetId === me.id) fail('VALIDATION'); const person = current.profiles.find((item) => item.id === value.targetId)!; if (person.status === 'deleting' || person.status === 'deleted') fail('CONFLICT'); person.status = value.action === 'suspend' ? 'suspended' : 'active'; if (value.action === 'suspend') current.devices = current.devices.filter((item) => item.userId !== person.id); }
        else { const report = current.reports.find((item) => item.id === (value.reportId ?? value.targetId)); if (!report) fail('NOT_FOUND'); report.status = value.action === 'resolve' ? 'resolved' : 'dismissed'; }
        if (linkedReport && value.targetType !== 'report') linkedReport.status = 'reviewing';
        current.audit.unshift({ id: newId(), actorId: me.id, action: value.action, targetId: value.targetId, note: value.note, createdAt: now }); return { id: value.targetId };
      }
      case 'admin.community': { admin(current); const value = input as CommandMap['admin.community']['input']; const old = value.id ? current.communities.find((item) => item.id === value.id) : undefined; if (value.id && !old) fail('NOT_FOUND'); const id = old?.id ?? newId(); if (old) Object.assign(old, value); else current.communities.push({ ...value, id, memberCount: 0 }); current.audit.unshift({ id: newId(), actorId: me.id, action: 'community.update', targetId: id, note: value.name, createdAt: now }); return { id }; }
      case 'admin.invite': { admin(current); const value = input as CommandMap['admin.invite']['input']; if (!current.communities.some((item) => item.id === value.communityId && item.status === 'active') || Date.parse(value.expiresAt) <= Date.now()) fail('VALIDATION'); const id = newId(); current.inviteCodes.push({ ...value, id, uses: [] }); current.audit.unshift({ id: newId(), actorId: me.id, action: 'invite.create', targetId: value.communityId, note: '가상 커뮤니티 초대 발급', createdAt: now }); return { id }; }
      case 'admin.job.retry': { admin(current); const value = input as CommandMap['admin.job.retry']['input']; const job = current.jobs.find((item) => item.id === value.id); if (!job) fail('NOT_FOUND'); if (job.status !== 'failed') fail('CONFLICT'); job.status = 'retry'; job.attempts = 0; job.nextAttemptAt = now; job.lastError = null; current.audit.unshift({ id: newId(), actorId: me.id, action: 'job.retry', targetId: job.id, note: value.note, createdAt: now }); return { id: job.id, status: 'retry' }; }
      default: return fail('VALIDATION');
    }
  }

  return {
    mode: 'demo',
    get actor() { return state.actor; },
    ready: () => ready,
    async query(name, input, operationOptions) {
      await ready; await tail;
      if (disposed) fail('UNAVAILABLE');
      if (operationOptions?.signal?.aborted) { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; }
      if ((name === 'projects.search' || name === 'people.search') && !searchSchema.safeParse(input).success) fail('VALIDATION');
      if (name === 'admin.report') return enqueue(async () => {
        const result = read(name, input);
        const next = clone(state);
        next.audit.unshift({ id: newId(), actorId: actorId(next), action: 'report.view', targetId: (input as QueryMap['admin.report']['input']).id, note: '가상 신고 증거 조회', createdAt: timestamp() });
        // Reading evidence must be audited, but cannot recursively invalidate
        // its own query every time a view observer refetches.
        await commit(next, { scope: 'admin.audit' }, false);
        return result;
      });
      return read(name, input);
    },
    command(name, input, idempotencyKey = newId()) {
      return enqueue(async () => {
        await ready;
        const validated = validateCommand(name, input);
        // A stored response is not an authorization grant after suspension or
        // deletion. Match the server's account check before replaying a key.
        viewer(state, name !== 'account.delete' && name !== 'device.unregister');
        const key = `${actorId(state)}:${idempotencyKey}`;
        const fingerprint = JSON.stringify({ name, input: validated });
        const existing = state.idempotency[key];
        if (existing) { if (existing.fingerprint !== fingerprint) fail('CONFLICT', '같은 요청 키로 다른 내용을 보낼 수 없어요.'); return clone(existing.result); }
        const next = clone(state);
        const result = mutate(next, name, validated as CommandMap[typeof name]['input']);
        next.idempotency[key] = { fingerprint, result };
        // Bound local demo history; the server maintains its separate durable retention policy.
        const keys = Object.keys(next.idempotency); if (keys.length > 2000) delete next.idempotency[keys[0]!];
        const projectId = 'projectId' in input && typeof input.projectId === 'string' ? input.projectId : name === 'project.disband' && 'id' in input ? input.id : undefined;
        await commit(next, { scope: name, ...(projectId ? { projectId } : {}) });
        return clone(result);
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; listeners.clear(); },
    selectActor(actor) { return enqueue(async () => { await ready; if (!Object.hasOwn(DEMO_ACTORS, actor)) fail('VALIDATION'); const next = clone(state); next.actor = actor; await commit(next, { scope: 'session' }); }); },
    reset() { return enqueue(async () => { await ready.catch(() => undefined); await commit(initialState(), { scope: 'reset' }); ready = Promise.resolve(); }); },
    processDeletion() {
      return enqueue(async () => {
        await ready; const userId = actorId(state); const deletion = state.deletion[userId]; if (!deletion || deletion.status === 'completed') fail('CONFLICT');
        const processing = clone(state); processing.deletion[userId]!.status = 'processing'; const job = processing.jobs.find((item) => item.id === deletion.id); if (job) { job.status = 'processing'; job.attempts += 1; } await commit(processing, { scope: 'account.status' });
        const next = clone(state); const person = viewer(next, false);
        const ownedProjectIds = new Set(next.projects.filter((project) => project.ownerId === userId).map((project) => project.id));
        const authoredMessageIds = new Set(next.messages.filter((item) => item.authorId === userId).map((item) => item.id));
        const relatedInvitationIds = new Set(next.invitations.filter((item) => item.inviterId === userId || item.inviteeId === userId).map((item) => item.id));
        const relatedReportIds = new Set(next.reports.filter((item) => item.reporterId === userId || item.targetType === 'profile' && item.targetId === userId || item.targetType === 'project' && ownedProjectIds.has(item.targetId) || item.targetType === 'message' && authoredMessageIds.has(item.targetId)).map((item) => item.id));
        next.projects.filter((project) => ownedProjectIds.has(project.id)).forEach((project) => { Object.assign(project, { title: '종료된 프로젝트', goal: '삭제된 계정이 종료한 프로젝트', description: '계정 삭제로 종료된 프로젝트입니다.', interests: [], roles: [], availability: [], status: 'archived', updatedAt: timestamp() }); next.applications.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'rejected'; }); next.invitations.filter((item) => item.projectId === project.id && item.status === 'pending').forEach((item) => { item.status = 'cancelled'; }); });
        next.memberships.filter((item) => item.userId === userId).forEach((item) => { item.active = false; item.nickname = '삭제된 가상 계정'; item.avatar = 'orbit'; item.role = '탈퇴한 팀원'; }); next.projects.forEach((project) => refreshCounts(next, project));
        next.applications.filter((item) => item.userId === userId).forEach((item) => { item.introduction = ''; item.role = '탈퇴한 팀원'; if (item.status === 'pending') item.status = 'withdrawn'; });
        next.invitations.filter((item) => item.inviterId === userId || item.inviteeId === userId).forEach((item) => { item.message = ''; item.role = '탈퇴한 팀원'; if (item.status === 'pending') item.status = 'cancelled'; });
        next.messages.filter((item) => item.authorId === userId).forEach((item) => { item.body = ''; item.deleted = true; item.authorName = '삭제된 가상 계정'; });
        next.experiences = next.experiences.filter((item) => item.userId !== userId); next.notifications = next.notifications.filter((item) => item.userId !== userId && item.actorId !== userId); next.devices = next.devices.filter((item) => item.userId !== userId); next.saved = next.saved.filter((item) => item.userId !== userId); next.blocks = next.blocks.filter((item) => item.userId !== userId && item.blockedId !== userId);
        next.reports = next.reports.filter((item) => item.reporterId !== userId);
        next.reports.filter((item) => relatedReportIds.has(item.id)).forEach((item) => { delete item.content; item.detail = ''; item.reason = '삭제된 계정 관련 신고'; });
        next.audit.filter((item) => item.actorId === userId || item.targetId === userId || ownedProjectIds.has(item.targetId) || authoredMessageIds.has(item.targetId) || relatedReportIds.has(item.targetId)).forEach((item) => { item.note = '삭제된 계정의 운영 기록'; });
        // Demo replay fingerprints contain the original payload, unlike SQL's
        // hashes. Remove both the deleted actor's requests and evidence-bearing
        // requests concerning erased content from other demo actors.
        for (const [key, entry] of Object.entries(next.idempotency)) {
          const request = JSON.parse(entry.fingerprint) as { input: { targetId?: string; reportId?: string } };
          if (key.startsWith(`${userId}:`) || relatedInvitationIds.has(entry.result.id) || relatedReportIds.has(entry.result.id) || request.input.reportId && relatedReportIds.has(request.input.reportId) || request.input.targetId && (request.input.targetId === userId || ownedProjectIds.has(request.input.targetId) || authoredMessageIds.has(request.input.targetId) || relatedReportIds.has(request.input.targetId))) delete next.idempotency[key];
        }
        delete next.communityMemberships?.[userId];
        delete next.profileUpdatedAt?.[userId];
        next.communities.forEach((community) => { community.memberCount = next.profiles.filter((profile) => profile.id !== userId && profile.status !== 'deleted' && (next.communityMemberships?.[profile.id] ?? (profile.communityId ? [profile.communityId] : [])).includes(community.id)).length; });
        Object.assign(person, { status: 'deleted', nickname: '삭제된 가상 계정', avatar: 'orbit', bio: '', links: [], interests: [], roles: [], learningRoles: [], skills: [], availability: [], discoverable: false, communityId: null, educationLevel: null, onboardingCompleted: false });
        delete next.preferences[userId]; for (const key of Object.keys(next.readPositions)) if (key.startsWith(`${userId}:`)) delete next.readPositions[key];
        next.deletion[userId]!.status = 'completed'; const finishedJob = next.jobs.find((item) => item.id === deletion.id); if (finishedJob) finishedJob.status = 'completed'; await commit(next, { scope: 'account.status' });
      });
    },
  };
}
