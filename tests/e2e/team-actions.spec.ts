import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_ACTORS, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';

function teamState() {
  const state = createDemoState('A');
  const now = new Date().toISOString();
  for (const [index, projectId, userId] of [
    [4, DEMO_PROJECTS.first, DEMO_ACTORS.B],
    [5, DEMO_PROJECTS.second, DEMO_ACTORS.A],
  ] as const) {
    const person = state.profiles.find(item => item.id === userId)!;
    state.memberships.push({ id: '40000000-0000-4000-8000-' + String(index).padStart(12, '0'), projectId, userId, nickname: person.nickname, avatar: person.avatar, active: true, role: person.roles[0]!, joinedAt: now });
    state.projects.find(item => item.id === projectId)!.memberCount += 1;
  }
  const messageId = '80000000-0000-4000-8000-000000000001';
  state.messages.push({ id: messageId, clientId: messageId, projectId: DEMO_PROJECTS.first, authorId: DEMO_ACTORS.B, authorName: '가상 두리', body: '해체 후에도 보존할 가상 협업 대화', createdAt: now, deleted: false });
  state.experiences.push({ id: '90000000-0000-4000-8000-000000000001', projectId: DEMO_PROJECTS.first, userId: DEMO_ACTORS.A, title: '가상 팀에서 배운 협업', description: '함께 역할을 나누며 배운 경험을 기록했어요.', role: '기획', isPublic: false, createdAt: now });
  return state;
}

async function seed(page: Page, state: DemoState = teamState()) {
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
  await page.goto('/teams');
  await expect(page.getByRole('button', { name: state.projects[0]!.title + ' 팀 공간 열기', exact: true })).toBeVisible();
  return state;
}

async function stored(page: Page): Promise<DemoState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

function teamButton(page: Page, title: string, action = '팀 공간 열기') {
  return page.getByRole('button', { name: title + ' ' + action, exact: true });
}

async function confirmAction(page: Page, title: string, action: '팀 해체' | '팀 탈퇴') {
  if (action === '팀 탈퇴' && !await teamButton(page, title, action).isVisible()) {
    await teamButton(page, title, '팀 메뉴').click();
  }
  await teamButton(page, title, action).click();
  await expect(page.getByText(action === '팀 해체' ? '팀을 해체할까요?' : '팀을 떠날까요?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: action, exact: true }).click();
}

async function expectRevokedAccessWithHistory(page: Page, id: string, title: string) {
  await page.goto('/team/' + id);
  await expect(page.getByText('팀원만 들어올 수 있어요', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '팀 채팅 열기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '팀 탈퇴', exact: true })).toHaveCount(0);
  await page.goto('/chat/' + id);
  await expect(page.getByText('팀원만 대화에 참여할 수 있어요', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '팀 메시지', exact: true })).toHaveCount(0);
  await page.goto('/experience');
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test('owner disbands only the selected team after confirmation; active access ends and history survives reload', async ({ page }) => {
  const initial = await seed(page);
  const [owned, joined, unrelated] = initial.projects;
  await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  await expect(teamButton(page, owned!.title, '팀 탈퇴')).toHaveCount(0);
  await expect(teamButton(page, owned!.title, '팀 메뉴')).toHaveCount(0);
  await expect(teamButton(page, joined!.title, '팀 메뉴')).toBeVisible();
  await expect(teamButton(page, joined!.title, '팀 탈퇴')).toHaveCount(0);
  await expect(teamButton(page, joined!.title, '팀 해체')).toHaveCount(0);
  await expect(teamButton(page, unrelated!.title)).toHaveCount(0);
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 1024 });
    await page.screenshot({ path: 'artifacts/screenshots/team-actions-' + width + '.png', fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await teamButton(page, owned!.title).click();
    await expect(page.getByRole('button', { name: '개요', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const disband = teamButton(page, owned!.title, '팀 해체');
    await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(1);
    await disband.scrollIntoViewIfNeeded();
    const manageBox = (await page.getByRole('button', { name: '신청자 관리', exact: true }).boundingBox())!;
    const findBox = (await page.getByRole('button', { name: '함께할 사람 찾기', exact: true }).boundingBox())!;
    const disbandBox = (await disband.boundingBox())!;
    expect(findBox.y).toBeGreaterThanOrEqual(manageBox.y + manageBox.height);
    expect(disbandBox.y).toBeGreaterThan(findBox.y + findBox.height);
    expect(disbandBox.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: 'artifacts/screenshots/team-disband-tools-' + width + '.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '팀 설정', exact: true }).click();
    await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
    await page.getByRole('button', { name: '개요', exact: true }).click();
    await disband.click();
    await expect(page.getByText('팀을 해체할까요?', { exact: true })).toBeVisible();
    const finalAction = page.getByRole('button', { name: '팀 해체', exact: true });
    await expect(finalAction).toBeInViewport();
    expect((await finalAction.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: 'artifacts/screenshots/team-disband-confirm-' + width + '.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/team/' + owned!.id + '$'));
    await expect(disband).toBeVisible();
    expect(await stored(page)).toEqual(initial);
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(teamButton(page, owned!.title)).toBeVisible();
    await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  }
  await teamButton(page, owned!.title).click();
  await confirmAction(page, owned!.title, '팀 해체');
  await expect(page).toHaveURL(/\/teams$/);
  await expect(teamButton(page, owned!.title)).toHaveCount(0);
  await expect(teamButton(page, joined!.title)).toBeVisible();
  let after = await stored(page);
  expect(after.projects.find(item => item.id === owned!.id)).toMatchObject({ status: 'archived', memberCount: 0 });
  expect(after.memberships.filter(item => item.projectId === owned!.id)).toHaveLength(2);
  expect(after.memberships.filter(item => item.projectId === owned!.id).every(item => !item.active)).toBe(true);
  expect(after.projects.filter(item => item.id !== owned!.id)).toEqual(initial.projects.filter(item => item.id !== owned!.id));
  expect(after.memberships.filter(item => item.projectId !== owned!.id)).toEqual(initial.memberships.filter(item => item.projectId !== owned!.id));
  expect(after.messages).toEqual(initial.messages);
  expect(after.experiences).toEqual(initial.experiences);

  await page.reload();
  await expect(teamButton(page, joined!.title)).toBeVisible();
  for (const tab of ['참여 중', '내가 운영', '완료']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(teamButton(page, owned!.title)).toHaveCount(0);
  }
  await page.goto('/messages');
  await expect(page.getByRole('button', { name: joined!.title + ' 대화 열기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: owned!.title + ' 대화 열기', exact: true })).toHaveCount(0);
  await expectRevokedAccessWithHistory(page, owned!.id, owned!.title);
  after = await stored(page);
  expect(after.projects.find(item => item.id === owned!.id)!.status).toBe('archived');
  expect(after.messages).toEqual(initial.messages);
  expect(after.experiences).toEqual(initial.experiences);
});

test('member leaves only their joined team; cancel is safe and unrelated teams have no controls', async ({ page }) => {
  const initial = await seed(page);
  const [owned, joined, unrelated] = initial.projects;
  await page.goto('/team/' + unrelated!.id);
  await expect(page.getByText('팀원만 들어올 수 있어요', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '팀 탈퇴', exact: true })).toHaveCount(0);
  expect(await stored(page)).toEqual(initial);
  await page.goto('/teams');
  await teamButton(page, joined!.title).click();
  await expect(page.getByRole('button', { name: '팀 채팅 열기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  await expect(page.getByText('팀장 도구', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '팀 설정', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await expect(teamButton(page, joined!.title, '팀 탈퇴')).toHaveCount(0);
  await teamButton(page, joined!.title, '팀 메뉴').click();
  await expect(teamButton(page, joined!.title, '팀 탈퇴')).toBeVisible();
  await teamButton(page, joined!.title, '팀 탈퇴').click();
  await expect(page.getByText('팀을 떠날까요?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(teamButton(page, joined!.title, '팀 탈퇴')).toBeVisible();
  expect(await stored(page)).toEqual(initial);
  await confirmAction(page, joined!.title, '팀 탈퇴');
  await expect(teamButton(page, joined!.title)).toHaveCount(0);
  await expect(teamButton(page, owned!.title)).toBeVisible();
  await expect(page.getByRole('button', { name: /팀 해체$/ })).toHaveCount(0);
  const after = await stored(page);
  expect(after.projects.find(item => item.id === joined!.id)).toMatchObject({ status: joined!.status, ownerId: DEMO_ACTORS.C, memberCount: 1 });
  expect(after.memberships.find(item => item.projectId === joined!.id && item.userId === DEMO_ACTORS.A)!.active).toBe(false);
  expect(after.memberships.find(item => item.projectId === joined!.id && item.userId === DEMO_ACTORS.C)).toEqual(initial.memberships.find(item => item.projectId === joined!.id && item.userId === DEMO_ACTORS.C));
  expect(after.projects.filter(item => item.id !== joined!.id)).toEqual(initial.projects.filter(item => item.id !== joined!.id));
  expect(after.memberships.filter(item => item.projectId !== joined!.id)).toEqual(initial.memberships.filter(item => item.projectId !== joined!.id));
  await page.reload();
  await expect(teamButton(page, owned!.title)).toBeVisible();
  await expect(teamButton(page, joined!.title)).toHaveCount(0);
  await page.goto('/messages');
  await expect(page.getByRole('button', { name: owned!.title + ' 대화 열기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: joined!.title + ' 대화 열기', exact: true })).toHaveCount(0);
  await expectRevokedAccessWithHistory(page, joined!.id, joined!.title);
});

for (const action of ['팀 해체', '팀 탈퇴'] as const) {
  test(action + ' storage failure keeps the team and all state intact, then permits a real retry', async ({ page }) => {
    const initial = await seed(page);
    const target = initial.projects[action === '팀 해체' ? 0 : 1]!;
    if (action === '팀 해체') await teamButton(page, target.title).click();
    const actionPath = action === '팀 해체' ? '/team/' + target.id : '/teams';
    await expect(page).toHaveURL(new RegExp(actionPath + '$'));
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key) {
          Storage.prototype.setItem = original;
          throw new DOMException('Simulated local storage quota failure', 'QuotaExceededError');
        }
        original.call(this, name, value);
      };
    }, DEMO_STORAGE_KEY);
    await confirmAction(page, target.title, action);
    await expect(page.getByText('데모 변경을 저장하지 못했어요. 다시 시도해 주세요.', { exact: true })).toBeVisible();
    await expect(page.getByText(action === '팀 해체' ? '팀을 해체했어요. 작성한 경험 기록은 내 정보에서 확인할 수 있어요.' : '팀에서 탈퇴했어요.', { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(actionPath + '$'));
    await expect(teamButton(page, target.title, action)).toBeEnabled();
    if (action === '팀 해체') await expect(page.getByRole('button', { name: '팀 채팅 열기', exact: true })).toBeVisible();
    expect(await stored(page)).toEqual(initial);
    await page.goto('/teams');
    await expect(teamButton(page, target.title)).toBeVisible();
    expect(await stored(page)).toEqual(initial);
    await page.reload();
    await expect(teamButton(page, target.title)).toBeVisible();
    expect(await stored(page)).toEqual(initial);
    if (action === '팀 해체') await teamButton(page, target.title).click();
    await confirmAction(page, target.title, action);
    await expect(page).toHaveURL(/\/teams$/);
    await expect(teamButton(page, target.title)).toHaveCount(0);
    expect((await stored(page)).memberships.find(item => item.projectId === target.id && item.userId === DEMO_ACTORS.A)!.active).toBe(false);
  });
}
