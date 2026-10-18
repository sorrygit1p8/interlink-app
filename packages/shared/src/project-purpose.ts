import type { Project } from './index';

export const PROJECT_PURPOSES = ['조별과제', '캡스톤', '공모전', '스터디'] as const;
export type ProjectPurpose = typeof PROJECT_PURPOSES[number];

/** Existing projects without an exact purpose tag remain uncategorized. */
export function getProjectPurpose(project: Pick<Project, 'interests'>): ProjectPurpose | undefined {
  return PROJECT_PURPOSES.find(purpose => project.interests.includes(purpose));
}
