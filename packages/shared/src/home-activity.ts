import type { Application, Invitation, Profile, Project } from './index';

/** Only resolved, visible records from the signed-in account are summarized. */
export function homeActivity(viewer: Profile | null | undefined, teams: Project[], applications: Application[], invitations: Invitation[], now = Date.now()) {
  const liveTeams = teams.filter(team => team.status === 'active' || team.status === 'recruiting');
  const owned = new Set(liveTeams.filter(team => team.ownerId === viewer?.id).map(team => team.id));
  const awaitingReview = applications.filter(item => item.status === 'pending' && owned.has(item.projectId) && item.userId !== viewer?.id);
  const pendingApplications = applications.filter(item => item.userId === viewer?.id && item.status === 'pending');
  const pendingInvitations = invitations.filter(item => item.inviteeId === viewer?.id && item.status === 'pending' && Date.parse(item.expiresAt) > now);
  const byLatest = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nextTeam = [...liveTeams].sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || b.updatedAt.localeCompare(a.updatedAt))[0];
  return { liveTeams, awaitingReview: byLatest(awaitingReview), pendingApplications: byLatest(pendingApplications), pendingInvitations: byLatest(pendingInvitations), nextTeam };
}

export function openRecruitments(projects: Project[], myTeamIds: Set<string>, viewerId?: string, now = Date.now()) {
  return projects.filter(project => project.status === 'recruiting' && Date.parse(project.deadline) > now && project.capacity > project.memberCount && project.ownerId !== viewerId && !myTeamIds.has(project.id));
}

export function urgentRecruitments(projects: Project[], now = Date.now()) {
  return projects.filter(project => project.status === 'recruiting' && project.capacity > project.memberCount && Date.parse(project.deadline) > now && (project.capacity - project.memberCount === 1 || Date.parse(project.deadline) - now <= 3 * 86400000))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export function recruitmentDeadline(project: Pick<Project, 'deadline'>, now = Date.now()) {
  const hours = Math.ceil((Date.parse(project.deadline) - now) / 3600000);
  return hours <= 0 ? '모집 마감' : hours <= 24 ? `${hours}시간 남음` : `D-${Math.ceil(hours / 24)}`;
}
