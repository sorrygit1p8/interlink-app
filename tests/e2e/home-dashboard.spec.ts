import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_ACTORS, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

async function open(page: Page, state = createDemoState('B'), path = '/') {
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key: DEMO_STORAGE_KEY, state });
  await page.goto(path);
  await expect(page.getByRole('button', { name: path === '/me' ? '참여 중 1' : '공모전 모집글 모아보기', exact: true })).toBeVisible();
}

test('home keeps its banner, search, purposes, quick actions and five tabs reachable on phone and tablet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const viewport of [{ width: 360, height: 780 }, { width: 412, height: 890 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await open(page);
    const banner = page.getByRole('button', { name: '공모전 모집글 모아보기', exact: true });
    const search = page.getByRole('textbox', { name: '홈 검색어', exact: true });
    const create = page.getByRole('button', { name: '팀 모집하기', exact: true });
    await expect(banner).toBeInViewport();
    await expect(search).toBeInViewport();
    await expect(create).toBeInViewport();
    await expect(page.getByRole('button', { name: '내 활동 전체 보기', exact: true })).toBeInViewport();
    for (const purpose of ['조별과제', '캡스톤', '공모전', '스터디']) await expect(page.getByRole('button', { name: `${purpose} 팀 찾기`, exact: true })).toBeInViewport();
    const bannerBox = (await banner.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    expect(bannerBox.height).toBeCloseTo(viewport.width === 360 ? 174 : viewport.width === 412 ? 190 : 244, 0);
    expect(searchBox.y).toBeGreaterThan(bannerBox.y + bannerBox.height);
    expect(searchBox.y).toBeLessThanOrEqual(400);
    await expect(page.getByText('추천 팀 모집', { exact: true })).toBeInViewport();
    await expect(page.getByRole('tab')).toHaveCount(5);
    for (const label of ['홈', '팀 찾기', '내 활동', '채팅', '내 정보']) {
      const tab = page.getByRole('tab', { name: new RegExp(label + '$') });
      await expect(tab).toBeInViewport();
      await expect(tab).toBeEnabled();
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `artifacts/screenshots/home-dashboard-${viewport.width}.png`, fullPage: true });
  }
  for (const [label, path] of [['팀 찾기', '/explore'], ['내 활동', '/teams'], ['채팅', '/messages'], ['내 정보', '/me'], ['홈', '/']] as const) {
    await page.getByRole('tab', { name: new RegExp(label + '$') }).click();
    await expect(page).toHaveURL(new RegExp(path + '$'));
  }
  expect(errors).toEqual([]);
});

test('home banner, purpose filters and search open actual results and repeated shortcuts reset stale conditions', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '공모전 모집글 모아보기', exact: true }).click();
  await expect(page.getByLabel('선택 조건: 공모전', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '상상으로 만드는 작은 전시 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /홈$/ }).click();
  await page.getByRole('button', { name: '캡스톤 팀 찾기', exact: true }).click();
  await expect(page.getByLabel('선택 조건: 캡스톤', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '상상으로 만드는 작은 전시 상세 보기', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '프로젝트 검색어', exact: true }).fill('일치하지않음');
  await page.getByRole('tab', { name: /홈$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '캡스톤 팀 찾기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '프로젝트 검색어', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /홈$/ }).click();
  await page.getByRole('textbox', { name: '홈 검색어', exact: true }).fill('작은 전시');
  await page.getByRole('button', { name: '프로젝트 검색', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '프로젝트 검색어', exact: true })).toHaveValue('작은 전시');
  await expect(page.getByRole('button', { name: '상상으로 만드는 작은 전시 상세 보기', exact: true })).toBeVisible();
});

test('My Info profile visibility changes real persisted data without altering biography or tags', async ({ page }) => {
  const state = createDemoState('B');
  const original = state.profiles.find(x => x.id === DEMO_ACTORS.B)!;
  await open(page, state, '/me');
  const toggle = page.getByRole('switch', { name: '프로필 공개', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  const saved = await page.evaluate(({ key, id }) => (JSON.parse(localStorage.getItem(key)!) as DemoState).profiles.find(x => x.id === id), { key: DEMO_STORAGE_KEY, id: DEMO_ACTORS.B });
  expect(saved).toEqual({ ...original, discoverable: false });
});

test('My Info prioritizes a valid invitation until answered, then opens the pending application status', async ({ page }) => {
  const state = createDemoState('B');
  state.applications.push({ id: '60000000-0000-4000-8000-000000000001', projectId: DEMO_PROJECTS.first, userId: DEMO_ACTORS.B, role: '개발', introduction: '함께 환경 앱을 만들고 싶어요.', status: 'pending', createdAt: new Date().toISOString() });
  state.invitations.push({ id: '70000000-0000-4000-8000-000000000001', projectId: DEMO_PROJECTS.second, inviterId: DEMO_ACTORS.C, inviteeId: DEMO_ACTORS.B, role: '개발', message: '온라인 전시를 함께 만들어요.', status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await open(page, state, '/me');
  await expect(page.getByRole('button', { name: '지원 중 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '받은 초대 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '상상으로 만드는 작은 전시 · 초대 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '초대 수락', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '거절', exact: true }).click();
  await expect(page.getByRole('button', { name: '초대 수락', exact: true })).toHaveCount(0);
  await page.goto('/me');
  await page.getByRole('button', { name: '우리 동네, 초록 지도 · 지원 확인', exact: true }).click();
  await expect(page.getByText('신청을 검토하고 있어요', { exact: true })).toBeVisible();
});

test('home urgency uses actual remaining capacity and omits the section when nothing is urgent', async ({ page }) => {
  await open(page);
  await expect(page.getByText('마감·남은 자리', { exact: true })).toHaveCount(0);
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
    state.projects[0]!.capacity = 2;
    localStorage.setItem(key, JSON.stringify(state));
  }, DEMO_STORAGE_KEY);
  await page.reload();
  await expect(page.getByText('마감·남은 자리', { exact: true })).toBeVisible();
  await expect(page.getByText('1자리 남음', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '우리 동네, 초록 지도 · 남은 자리 상세 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '참여 신청하기', exact: true })).toBeVisible();
});
