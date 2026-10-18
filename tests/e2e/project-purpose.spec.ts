import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

async function seed(page: Page, path: string, state: DemoState = createDemoState('A')) {
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
  await page.goto(path);
}

async function stored(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as DemoState, DEMO_STORAGE_KEY);
}

test('purpose prefill stays clean; preview, chosen purpose, custom tags and guarded edits persist', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const route = '/project/new?purpose=' + encodeURIComponent('공모전');
  await seed(page, route);
  await expect(page.getByRole('button', { name: '공모전', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toHaveCount(0);

  await page.goto(route);
  await page.getByRole('button', { name: '캡스톤', exact: true }).click();
  await page.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill('가상 캠퍼스 센서 캡스톤');
  await page.getByRole('textbox', { name: '함께 달성할 목표', exact: true }).fill('캠퍼스에서 사용할 환경 센서 시제품을 함께 만들어요.');
  await page.getByRole('textbox', { name: '프로젝트 소개', exact: true }).fill('전공 지식을 실제 제작 과정에 적용하는 가상 프로젝트입니다. 기획부터 센서 개발과 발표까지 함께해요.');
  await page.getByRole('textbox', { name: '관심 분야', exact: true }).fill('기술, 센서 실험, 기술, 캡스톤');
  await page.getByRole('button', { name: '개발', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '필요한 역할', exact: true })).toHaveValue('개발');
  await page.getByRole('button', { name: '정원 늘리기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '전체 정원 · 팀장 포함', exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '평일 저녁', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '함께할 수 있는 시간', exact: true })).toHaveValue('주말, 평일 저녁');
  const before = (await stored(page)).projects.length;
  await page.getByRole('button', { name: '모집글 미리보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '모집 시작하기', exact: true })).toBeInViewport();
  expect((await stored(page)).projects).toHaveLength(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: '모집 시작하기', exact: true }).click();
  await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  let state = await stored(page);
  let project = state.projects.find(item => item.id === id)!;
  expect(project.interests).toEqual(['캡스톤', '기술', '센서 실험']);
  expect(project.capacity).toBe(5);
  expect(project).not.toHaveProperty('purpose');
  const create = Object.values(state.idempotency).map(entry => JSON.parse(entry.fingerprint)).find(request => request.name === 'project.create');
  expect(create.input).not.toHaveProperty('purpose');

  const edit = '/project/edit?id=' + id;
  await page.goto(edit);
  await expect(page.getByRole('button', { name: '캡스톤', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: '관심 분야', exact: true })).toHaveValue('기술, 센서 실험');
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/project/' + id + '$'));
  expect((await stored(page)).projects.find(item => item.id === id)!.interests).toEqual(project.interests);
  await page.goto(edit);
  await page.getByRole('button', { name: '스터디', exact: true }).click();
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await expect(page.getByText('저장하지 않은 내용은 사라져요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '스터디', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/project/' + id + '$'));
  state = await stored(page);
  project = state.projects.find(item => item.id === id)!;
  expect(project.interests).toEqual(['스터디', '기술', '센서 실험']);
  for (const request of Object.values(state.idempotency).map(entry => JSON.parse(entry.fingerprint)).filter(request => request.name === 'project.update')) expect(request.input).not.toHaveProperty('purpose');
});

test('legacy interests stay intact and the twenty-tag limit counts the selected purpose', async ({ page }) => {
  const state = createDemoState('A');
  const interests = Array.from({ length: 20 }, (_, index) => '직접 분야 ' + (index + 1));
  state.projects[0]!.interests = interests;
  await seed(page, '/project/edit?id=' + DEMO_PROJECTS.first, state);
  await expect(page.getByRole('button', { name: '기타', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: '관심 분야', exact: true })).toHaveValue(interests.join(', '));
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/project/' + DEMO_PROJECTS.first + '$'));
  expect((await stored(page)).projects[0]!.interests).toEqual(interests);
  await page.goto('/project/edit?id=' + DEMO_PROJECTS.first);
  await page.getByRole('button', { name: '조별과제', exact: true }).click();
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  await expect(page.getByText('모집 목적을 포함해 관심 분야는 최대 20개까지 선택할 수 있어요.', { exact: true })).toBeVisible();
  expect((await stored(page)).projects[0]!.interests).toEqual(interests);
  await page.getByRole('textbox', { name: '관심 분야', exact: true }).fill(interests.slice(0, 19).join(', '));
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/project/' + DEMO_PROJECTS.first + '$'));
  expect((await stored(page)).projects[0]!.interests).toEqual(['조별과제', ...interests.slice(0, 19)]);
});
