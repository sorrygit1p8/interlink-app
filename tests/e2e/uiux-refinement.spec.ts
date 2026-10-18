import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_ACTORS, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

async function seed(page: Page, path: string, state: DemoState = createDemoState('B')) {
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
  await page.goto(path);
}

test('filter drafts cancel safely, commit explicitly, and can be removed without clearing search', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seed(page, '/explore');
  const search = page.getByRole('textbox', { name: '프로젝트 검색어', exact: true });
  const first = page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true });
  await search.fill('초록');
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: '필터 열기', exact: true }).click();
  await page.getByRole('button', { name: '발표', exact: true }).click();
  await page.getByRole('button', { name: '필터 닫기', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(page.getByRole('button', { name: '발표 역할 조건 해제', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '필터 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '발표', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '발표', exact: true }).click();
  await expect(page.getByRole('button', { name: '결과 보기', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '결과 보기', exact: true }).click();
  await expect(page.getByText('검색 결과가 없어요', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('초록');
  await page.getByRole('button', { name: '발표 역할 조건 해제', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(search).toHaveValue('초록');
});

test('project action stays reachable when long details are scrolled on narrow and tablet screens', async ({ page }) => {
  const state = createDemoState('B');
  state.projects[0]!.description = '함께 아이디어를 나누고 작은 결과물을 완성하는 프로젝트입니다.\n'.repeat(24);
  await seed(page, '/project/' + DEMO_PROJECTS.first, state);
  for (const viewport of [{ width: 360, height: 780 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    const apply = page.getByRole('button', { name: '참여 신청하기', exact: true });
    await expect(apply).toBeInViewport();
    const before = await apply.boundingBox();
    await page.getByText('지금 함께하는 1명', { exact: true }).scrollIntoViewIfNeeded();
    const after = await apply.boundingBox();
    await expect(apply).toBeInViewport();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    expect(after!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

test('chat keeps its composer in a short viewport and loads older messages without duplicating sends', async ({ page }) => {
  const state = createDemoState('B');
  state.messages = Array.from({ length: 45 }, (_, index) => {
    const id = '80000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    return {
      id, clientId: id, projectId: DEMO_PROJECTS.third, authorId: DEMO_ACTORS.B,
      authorName: '가상 두리', body: '이전 대화 ' + (index + 1),
      createdAt: new Date(Date.now() - (46 - index) * 60000).toISOString(), deleted: false,
    };
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await seed(page, '/chat/' + DEMO_PROJECTS.third, state);
  const composer = page.getByRole('textbox', { name: '팀 메시지', exact: true });
  await expect(composer).toBeInViewport();
  await page.getByRole('button', { name: '이전 대화 불러오기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이전 대화 불러오기', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('이전 대화 1 · 메시지 동작', { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 360, height: 440 });
  await expect(composer).toBeInViewport();
  await composer.fill('작은 화면에서도 이어지는 대화');
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  await expect(send).toBeInViewport();
  await send.click();
  await expect.poll(() => page.evaluate(key =>
    JSON.parse(localStorage.getItem(key)!).messages.filter((message: { body: string }) => message.body === '작은 화면에서도 이어지는 대화').length,
    DEMO_STORAGE_KEY)).toBe(1);
  await expect(composer).toHaveValue('');
  await expect(send).toBeDisabled();
});

test('bookmark feedback preserves navigation and saved state survives reload', async ({ page }) => {
  await seed(page, '/');
  await page.getByRole('button', { name: '우리 동네, 초록 지도 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 저장 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('저장했어요. 내 프로필에서 다시 볼 수 있어요.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 저장 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/saved');
  await expect(page.getByText('우리 동네, 초록 지도', { exact: true })).toBeVisible();
});
