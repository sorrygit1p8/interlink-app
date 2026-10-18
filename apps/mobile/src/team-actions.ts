import { useRef, useState } from 'react';
import type { Project } from '@interlink/shared';
import { useCommand, useRuntime } from './runtime';

/** Shared by My Activity and the team screen, with one confirmation per action. */
export function useTeamActions() {
  const { confirm } = useRuntime();
  const { run } = useCommand();
  const locked = useRef(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  async function perform(project: Pick<Project, 'id' | 'title'>, action: 'disband' | 'leave') {
    if (locked.current) return false;
    locked.current = true;
    try {
      const accepted = await confirm(
        action === 'disband' ? '팀을 해체할까요?' : '팀을 떠날까요?',
        action === 'disband'
          ? `“${project.title}”의 모집과 진행 중인 신청·초대가 종료돼요. 모든 팀원의 팀 공간과 대화 접근이 종료되며, 해체는 되돌릴 수 없어요. 작성한 경험 기록은 남아요.`
          : `“${project.title}”에서 탈퇴하면 이 팀의 대화와 팀 공간에 더 이상 접근할 수 없어요. 다른 팀원의 활동과 내가 작성한 경험 기록은 유지돼요.`,
        action === 'disband' ? '팀 해체' : '팀 탈퇴',
        true,
      );
      if (!accepted) return false;
      setPendingProjectId(project.id);
      const result = action === 'disband'
        ? await run('project.disband', { id: project.id }, '팀을 해체했어요. 작성한 경험 기록은 내 정보에서 확인할 수 있어요.')
        : await run('membership.leave', { projectId: project.id }, '팀에서 탈퇴했어요.');
      return !!result;
    } finally {
      setPendingProjectId(null);
      locked.current = false;
    }
  }

  return {
    pendingProjectId,
    disband: (project: Pick<Project, 'id' | 'title'>) => perform(project, 'disband'),
    leave: (project: Pick<Project, 'id' | 'title'>) => perform(project, 'leave'),
  };
}
