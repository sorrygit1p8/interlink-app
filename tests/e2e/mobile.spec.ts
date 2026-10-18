import { test, expect, type Page } from '@playwright/test';
import { seedCompletedDemo } from './helpers/demo-setup';

test.beforeEach(async ({ page }) => { await seedCompletedDemo(page); });

async function asRole(page: Page, role: 'A' | 'B' | 'C', path = '/') {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('데모 체험 모드', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '데모 설정', exact: true }).click();
  const label = role === 'A' ? 'A · 팀장' : role === 'B' ? 'B · 지원자' : 'C · 초대받는 팀원';
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
  if (path !== '/') await page.goto(path);
  if (path === '/settings') await page.getByRole('button', { name: '데모 설정', exact: true }).click();
}
test.describe('mobile Expo web preview: persisted single-device fictional roles', () => {
  test('A creates; B applies; A approves and invites C; C chats; B reads, reports and deletes', async ({ page }) => {
    test.setTimeout(150_000);
    const remoteRequests: string[] = [];
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
    page.on('request', request => { if (/supabase\.(co|in)|\/auth\/v1|\/rest\/v1|\/functions\/v1|exp\.host\/--\/api/.test(request.url())) remoteRequests.push(request.url()); });
    const title = '가상 초록 센서 탐구팀';
    await asRole(page, 'A');
    await expect(page.getByRole('textbox', { name: '홈 검색어', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-home.png', fullPage: true });
    await page.getByRole('button', { name: '팀 모집하기', exact: true }).click();
    await page.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(title);
    await page.getByRole('textbox', { name: '함께 달성할 목표', exact: true }).fill('교실 환경을 함께 관찰하는 가상 시제품을 만들어요.');
    await page.getByRole('textbox', { name: '프로젝트 소개', exact: true }).fill('실제 학생 정보가 없는 가상 프로젝트입니다. 환경 센서와 화면을 함께 탐구하며 배우는 팀이에요.');
    await page.getByRole('textbox', { name: '관심 분야', exact: true }).fill('환경, 기술');
    await page.getByRole('textbox', { name: '필요한 역할', exact: true }).fill('개발, 디자인');
    await page.getByRole('textbox', { name: '전체 정원 · 팀장 포함', exact: true }).fill('3');
    await page.getByRole('button', { name: '모집글 미리보기', exact: true }).click();
    await page.getByRole('button', { name: '모집 시작하기', exact: true }).click();
    await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
    const projectPath = new URL(page.url()).pathname; const projectId = projectPath.split('/').at(-1)!;
    await expect(page.getByRole('button', { name: '신청자 관리', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-project.png', fullPage: true });

    await asRole(page, 'B', projectPath);
    await expect(page.getByRole('button', { name: '신청자 관리', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '참여 신청하기', exact: true }).click();
    await page.getByRole('button', { name: '개발', exact: true }).click();
    await page.getByRole('textbox', { name: '짧은 소개', exact: true }).fill('환경 센서 개발을 배우면서 함께 만들어보고 싶어요.');
    await page.screenshot({ path: 'artifacts/screenshots/mobile-application.png', fullPage: true });
    await page.getByRole('button', { name: '참여 신청 보내기', exact: true }).click();
    await expect(page.getByText('신청을 검토하고 있어요', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '팀 공간 열기', exact: true })).toHaveCount(0);

    await asRole(page, 'A', projectPath); await page.getByRole('button', { name: '신청자 관리', exact: true }).click();
    await page.getByRole('button', { name: '가상 두리 승인', exact: true }).click();
    await expect(page.getByText('승인됨', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-team-management.png', fullPage: true });
    await page.goto('/team/' + projectId);
    await page.getByRole('button', { name: '멤버', exact: true }).click();
    await expect(page.getByRole('button', { name: '팀장 이전', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '팀원 제거', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '가상 두리 멤버 관리', exact: true }).click();
    await expect(page.getByRole('button', { name: '팀원 제거', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '팀장 이전', exact: true }).click();
    await expect(page.getByText('팀장 권한을 이전할까요?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByRole('button', { name: '팀장 이전', exact: true })).toBeVisible();
    await asRole(page, 'A', '/person/10000000-0000-4000-8000-000000000003');
    await page.getByRole('button', { name: '내 프로젝트에 초대하기', exact: true }).click();
    await page.getByRole('radio', { name: new RegExp(title) }).click();
    await page.getByRole('textbox', { name: '함께할 역할', exact: true }).fill('디자인');
    await page.getByRole('textbox', { name: '초대 메시지 · 선택', exact: true }).fill('환경 센서 화면을 함께 디자인해 주세요.');
    await page.getByRole('button', { name: '초대 보내기', exact: true }).click();
    await expect(page.getByText('초대를 보냈어요. 상대방의 응답을 기다려주세요.', { exact: true })).toBeVisible();

    await asRole(page, 'C', projectPath); await page.getByRole('button', { name: '초대 수락', exact: true }).click();
    await page.getByRole('button', { name: '팀 공간 열기', exact: true }).click();
    await page.getByRole('button', { name: '팀 채팅 열기', exact: true }).click();
    const send = page.getByRole('button', { name: '메시지 보내기', exact: true }); await expect(send).toBeDisabled();
    await page.getByRole('textbox', { name: '팀 메시지', exact: true }).fill('가상 디자인 초안을 함께 살펴봐요.'); await send.click();
    await expect(page.getByText('가상 디자인 초안을 함께 살펴봐요.', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-chat.png', fullPage: true });
    await asRole(page, 'B', '/messages');
    const conversation = page.getByRole('button', { name: `${title} 대화 열기`, exact: true });
    await expect(conversation.getByText('1', { exact: true })).toBeVisible();
    await conversation.click(); await expect(page).toHaveURL(new RegExp(`/chat/${projectId}$`));
    await expect(page.getByText('가상 디자인 초안을 함께 살펴봐요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    // The retained messages screen can lose its unread badge before browser
    // back completes. Wait for navigation before starting another document load.
    await expect(page).toHaveURL(/\/messages$/);
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText('1', { exact: true })).toHaveCount(0);

    await asRole(page, 'B', `/team/${projectId}`); await page.getByRole('button', { name: '멤버', exact: true }).click();
    await page.getByRole('button', { name: '팀 탈퇴', exact: true }).click();
    await expect(page.getByText('팀을 떠날까요?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '팀 탈퇴', exact: true }).last().click();
    await expect(page).toHaveURL(/\/teams$/);
    await asRole(page, 'B', '/experience');
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('textbox', { name: '기록 제목', exact: true }).fill('가상 센서팀에서 함께 배운 경험');
    await page.getByRole('textbox', { name: '맡았던 역할', exact: true }).fill('개발');
    await page.getByRole('textbox', { name: '만든 것과 배운 점', exact: true }).fill('함께 환경 센서와 화면을 설계하며 서로의 역할을 배웠어요.');
    await page.screenshot({ path: 'artifacts/screenshots/mobile-experience.png', fullPage: true });
    await page.getByRole('button', { name: '경험 저장', exact: true }).click();
    await expect(page.getByText('가상 센서팀에서 함께 배운 경험', { exact: true })).toBeVisible();
    await expect(page.getByText('나만 보기', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '기록 수정', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '기록 제목', exact: true })).toHaveValue('가상 센서팀에서 함께 배운 경험');
    await page.getByRole('textbox', { name: '기록 제목', exact: true }).fill('가상 센서팀에서 발전시킨 협업 경험');
    await page.getByRole('button', { name: '경험 저장', exact: true }).click();
    await expect(page.getByText('가상 센서팀에서 발전시킨 협업 경험', { exact: true }).filter({ visible: true })).toBeVisible();

    await asRole(page, 'B', projectPath); await page.getByRole('button', { name: '프로젝트 더보기', exact: true }).click();
    await page.getByRole('button', { name: '프로젝트 신고', exact: true }).click();
    await page.getByRole('button', { name: '기타', exact: true }).click();
    await page.getByRole('textbox', { name: '상황 설명 · 선택', exact: true }).fill('실제 신고가 아닌 가상 검증용 신고입니다.');
    await page.getByRole('button', { name: '가상 신고 기록하기', exact: true }).click();
    await expect(page.getByText('가상 신고를 기록했어요', { exact: true })).toBeVisible();

    await asRole(page, 'B', '/profile');
    const profileEdit = page.getByRole('button', { name: '프로필 편집', exact: true });
    await expect(profileEdit).toBeVisible();
    await expect(page.getByText('가상 센서팀에서 발전시킨 협업 경험', { exact: true }).filter({ visible: true })).toBeVisible();
    // A route may have visible layout while its parent is still fading in.
    await expect.poll(() => profileEdit.evaluate(element => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (Number(getComputedStyle(current).opacity) < 0.99) return false;
      }
      return true;
    })).toBe(true);
    await page.screenshot({ path: 'artifacts/screenshots/mobile-profile.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '설정 · 계정 관리' }).click();
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: '가상 계정 삭제 시나리오' }).click();
    await page.getByRole('textbox', { name: '확인을 위해 DELETE 입력', exact: true }).fill('DELETE');
    await page.getByRole('button', { name: '가상 계정 삭제 요청', exact: true }).click();
    await page.getByRole('button', { name: '삭제 요청', exact: true }).click();
    await expect(page.getByText('삭제 요청됨', { exact: true })).toBeVisible();
    await expect(page.getByText('삭제 완료', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '취소', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/screenshots/mobile-delete-request.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '데모 삭제 처리 진행', exact: true }).click();
    await expect(page.getByText('삭제 완료', { exact: true })).toBeVisible();
    expect(remoteRequests).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });

  test('searches with a debounced empty result and exposes reversible offline/empty scenarios', async ({ page }) => {
    await asRole(page, 'B', '/explore');
    await page.getByRole('textbox', { name: '프로젝트 검색어', exact: true }).fill('일치하지않는가상검색어');
    await expect(page.getByText('검색 결과가 없어요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    await expect(page.getByText('우리 동네, 초록 지도', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-explore.png', fullPage: true });
    await asRole(page, 'B', '/settings'); await page.getByRole('button', { name: '오프라인', exact: true }).click();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByText('잠시 연결이 어려워요', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-offline.png', fullPage: true });
  });

  for (const scenario of ['오프라인', '서버 오류']) {
    test(`shows query failures instead of login or empty applications in ${scenario}`, async ({ page }) => {
      await asRole(page, 'B', '/teams');
      await page.getByRole('button', { name: '내 프로필 열기', exact: true }).click();
      await page.getByRole('button', { name: '설정 · 계정 관리', exact: true }).click();
      await page.getByRole('button', { name: '데모 설정', exact: true }).click();
      await page.getByRole('button', { name: scenario, exact: true }).click();
      await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
      await expect(page.getByText('잠시 연결이 어려워요', { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: '로그인', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();

      await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
      await page.getByRole('button', { name: '신청·초대', exact: true }).click();
      await expect(page.getByText('잠시 연결이 어려워요', { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText('아직 보낸 신청이 없어요', { exact: true }).filter({ visible: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);

      await page.getByRole('button', { name: '내 프로필 열기', exact: true }).click();
      await page.getByRole('button', { name: '설정 열기', exact: true }).click();
      await page.getByRole('button', { name: '데모 설정', exact: true }).click();
      await page.getByRole('button', { name: '정상', exact: true }).click();
      await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
      await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
      await expect(page.getByText('아직 보낸 신청이 없어요', { exact: true }).filter({ visible: true })).toBeVisible();
      await expect(page.getByText('잠시 연결이 어려워요', { exact: true }).filter({ visible: true })).toHaveCount(0);
    });
  }

  test('keeps a failed message for same-id retry and deletes the stored message visibly', async ({ page }) => {
    await asRole(page, 'B', '/chat/20000000-0000-4000-8000-000000000003');
    await page.getByRole('textbox', { name: '팀 메시지', exact: true }).fill('저장 실패 뒤 다시 보내는 가상 메시지');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'interlink.demo.state.v1') { Storage.prototype.setItem = original; throw new DOMException('Simulated local storage quota failure', 'QuotaExceededError'); }
        original.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
    await expect(page.getByRole('button', { name: '실패한 메시지 재전송', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/mobile-chat-failure.png', fullPage: true });
    await page.getByRole('button', { name: '실패한 메시지 재전송', exact: true }).click();
    const saved = page.getByRole('button', { name: '저장 실패 뒤 다시 보내는 가상 메시지 · 메시지 동작', exact: true });
    await expect(saved).toHaveCount(1); await expect(page.getByRole('button', { name: '실패한 메시지 재전송', exact: true })).toHaveCount(0);
    await saved.click(); await page.getByRole('button', { name: '메시지 삭제', exact: true }).click();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.getByLabel('삭제된 메시지', { exact: true })).toBeVisible();
    await expect(saved).toHaveCount(0);
  });

  test('validates the recruitment form and confirms loss before leaving a dirty draft', async ({ page }) => {
    await asRole(page, 'A', '/project/new');
    await page.getByRole('button', { name: '모집글 미리보기', exact: true }).click();
    await expect(page.getByText('제목을 4자 이상 입력해 주세요.', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill('아직 저장하지 않은 가상 초안');
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름', exact: true })).toHaveValue('아직 저장하지 않은 가상 초안');
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await page.getByRole('button', { name: '작성 그만두기', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름', exact: true })).toHaveCount(0);
  });
});
