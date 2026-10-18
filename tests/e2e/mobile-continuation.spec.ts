import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_ACTORS, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

async function openSeededDemo(page: Page, path: string, state = createDemoState('B')) {
  await page.addInitScript(({ key, state }) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
  await page.goto(path);
}

function experienceState(count: number) {
  const state = createDemoState('B');
  state.experiences = Array.from({ length: count }, (_, index) => ({
    id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    userId: DEMO_ACTORS.B,
    projectId: DEMO_PROJECTS.third,
    title: `가상 경험 ${index + 1}`,
    role: '기획',
    description: `가상 팀에서 배운 내용을 기록한 경험 ${index + 1}입니다.`,
    isPublic: false,
    createdAt: new Date().toISOString(),
  }));
  return state;
}

async function savedState(page: Page): Promise<DemoState> {
  return page.evaluate(key => JSON.parse(window.localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

test.describe('mobile continuation: safe form loading and drafts', () => {
  test('clears search separately and exposes hidden filters without losing the search term', async ({ page }) => {
    await openSeededDemo(page, '/explore');
    const search = page.getByRole('textbox', { name: '프로젝트 검색어', exact: true });
    await search.fill('초록');
    await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '필터 열기', exact: true }).click();
    await page.getByRole('button', { name: '발표', exact: true }).click();
    await page.getByRole('button', { name: '결과 보기', exact: true }).click();
    await expect(page.getByText('나에게 맞는 활동 조건', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('선택 조건: 발표 역할', { exact: true })).toBeVisible();
    await expect(page.getByText('검색 결과가 없어요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '선택 조건 지우기', exact: true }).click();
    await expect(search).toHaveValue('초록');
    await expect(page.getByRole('button', { name: '선택 조건 지우기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '검색어 지우기', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(page.getByRole('button', { name: '검색어 지우기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '상상으로 만드는 작은 전시 상세 보기', exact: true })).toBeVisible();
  });

  test('team find-people action selects people again after a manual project-tab switch', async ({ page }) => {
    await openSeededDemo(page, `/team/${DEMO_PROJECTS.third}`);
    await page.getByRole('button', { name: '함께할 사람 찾기', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/explore' && url.searchParams.get('kind') === 'people');
    await expect(page.getByRole('textbox', { name: '사람 검색어', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '가상 나래 프로필', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '프로젝트', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/explore' && url.searchParams.get('kind') === 'project');
    await expect(page.getByRole('textbox', { name: '프로젝트 검색어', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /내 활동$/ }).click();
    await expect(page).toHaveURL(/\/teams$/);
    await page.getByRole('button').filter({ hasText: '하루 한 번, 배움 기록' }).filter({ hasText: '팀 공간 열기' }).click();
    await page.getByRole('button', { name: '함께할 사람 찾기', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/explore' && url.searchParams.get('kind') === 'people');
    await expect(page.getByRole('textbox', { name: '사람 검색어', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '가상 나래 프로필', exact: true })).toBeVisible();
  });

  test('resolves an experience beyond the first page before editing and preserves its other fields', async ({ page }) => {
    const state = experienceState(21);
    const record = state.experiences[20]!;
    await openSeededDemo(page, `/experience?id=${record.id}&projectId=${record.projectId}`, state);
    const title = page.getByRole('textbox', { name: '기록 제목', exact: true });
    await expect(title).toHaveValue(record.title);
    await expect(page.getByRole('textbox', { name: '만든 것과 배운 점', exact: true })).toHaveValue(record.description);
    await title.fill('스물한 번째 경험을 수정했어요');
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(title).toHaveValue('스물한 번째 경험을 수정했어요');
    await page.getByRole('button', { name: '경험 저장', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toHaveCount(0);
    const saved = await savedState(page);
    expect(saved.experiences).toHaveLength(21);
    expect(saved.experiences[0]).toEqual(state.experiences[0]);
    expect(saved.experiences.find(item => item.id === record.id)).toEqual({ ...record, title: '스물한 번째 경험을 수정했어요' });
  });

  test('a missing experience has no editable or destructive form', async ({ page }) => {
    await openSeededDemo(page, '/experience?id=90000000-0000-4000-8000-000000000099');
    await expect(page.getByText('수정할 기록을 찾을 수 없어요', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '기록 제목', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '경험 저장', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '경험 삭제', exact: true })).toHaveCount(0);
  });

  test('an existing experience remains editable after its original project is hidden', async ({ page }) => {
    const state = experienceState(1);
    const record = state.experiences[0]!;
    state.hidden.push(record.projectId);
    await openSeededDemo(page, `/experience?id=${record.id}`, state);
    await expect(page.getByRole('textbox', { name: '기록 제목', exact: true })).toHaveValue(record.title);
    await expect(page.getByText('기존 경험은 처음 기록한 프로젝트에 연결돼요.', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '기록 제목', exact: true }).fill('보이지 않는 프로젝트에서도 남긴 경험');
    await page.getByRole('button', { name: '경험 저장', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    expect((await savedState(page)).experiences[0]).toEqual({ ...record, title: '보이지 않는 프로젝트에서도 남긴 경험' });
  });

  test('changing only experience visibility is an unsaved edit', async ({ page }) => {
    const state = experienceState(1);
    const record = state.experiences[0]!;
    await openSeededDemo(page, `/experience?id=${record.id}`, state);
    await expect(page.getByRole('textbox', { name: '기록 제목', exact: true })).toHaveValue(record.title);
    const visibility = page.getByRole('switch', { name: '경험 공개', exact: true });
    await visibility.check();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(visibility).toBeChecked();
    await page.getByRole('button', { name: '경험 저장', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    expect((await savedState(page)).experiences[0]?.isPublic).toBe(true);
  });

  test('profile lookup failure shows retry instead of blank editable defaults', async ({ page }) => {
    const state = createDemoState('B');
    state.profiles = state.profiles.filter(person => person.id !== DEMO_ACTORS.B);
    await openSeededDemo(page, '/profile/edit', state);
    await expect(page.getByText('잠시 연결이 어려워요', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '닉네임', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '프로필 저장', exact: true })).toHaveCount(0);
  });

  test('a missing project cannot expose a blank application form', async ({ page }) => {
    await openSeededDemo(page, '/apply/20000000-0000-4000-8000-000000000099');
    await expect(page.getByText('잠시 연결이 어려워요', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '참여 신청 보내기', exact: true })).toHaveCount(0);
  });

  test('role-only application drafts ask before leaving, then successful submit navigates without asking', async ({ page }) => {
    await openSeededDemo(page, `/project/${DEMO_PROJECTS.first}`);
    await page.getByRole('button', { name: '참여 신청하기', exact: true }).click();
    await page.getByRole('button', { name: '개발', exact: true }).click();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.getByRole('textbox', { name: '짧은 소개', exact: true }).fill('가상 팀에서 개발과 협업을 함께 배우고 싶어요.');
    await page.getByRole('button', { name: '참여 신청 보내기', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${DEMO_PROJECTS.first}$`));
    await expect(page.getByText('신청을 검토하고 있어요', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toHaveCount(0);
    expect((await savedState(page)).applications).toHaveLength(1);
  });

  test('an existing team member cannot use a direct application link', async ({ page }) => {
    await openSeededDemo(page, `/apply/${DEMO_PROJECTS.third}`);
    await expect(page.getByText('이미 함께하는 팀이에요', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '참여 신청 보내기', exact: true })).toHaveCount(0);
  });
});
