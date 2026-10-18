import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_ACTORS, DEMO_PROJECTS, DEMO_STORAGE_KEY, type DemoState } from '../../packages/data/src/fixtures';
import { completeOnboarding } from './helpers/demo-setup';

async function seed(page: Page, state: DemoState) {
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
}

async function stored(page: Page): Promise<DemoState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

test.describe('first-time profile setup', () => {
  test('validates each step, retains previous-step drafts and retries an atomic storage failure before opening home', async ({ page }) => {
    const state = createDemoState('B');
    Object.assign(state.profiles.find(person => person.id === DEMO_ACTORS.B)!, {
      nickname: '', interests: [], educationLevel: null, onboardingCompleted: false,
    });
    await seed(page, state);
    await page.goto(`/project/${DEMO_PROJECTS.first}`);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toHaveCount(0);
    await expect(page.getByText('우리 동네, 초록 지도', { exact: true })).toHaveCount(0);
    const next = page.getByRole('button', { name: '다음', exact: true });
    await expect(next).toBeDisabled();
    for (const school of ['중학교', '고등학교', '대학교']) await expect(page.getByRole('radio', { name: school, exact: true })).not.toBeChecked();
    await page.getByRole('radio', { name: '고등학교', exact: true }).check();
    await next.click();
    await expect(page.getByLabel('처음 설정 2 / 3단계', { exact: true })).toBeVisible();
    const nickname = page.getByRole('textbox', { name: '닉네임', exact: true });
    await expect(nickname).toHaveValue('');
    await next.click();
    await expect(page.getByText('닉네임은 2~24자로 입력해 주세요.', { exact: true })).toBeVisible();
    await nickname.fill('한');
    await next.click();
    await expect(page.getByLabel('처음 설정 2 / 3단계', { exact: true })).toBeVisible();
    await expect(page.getByText('닉네임은 2~24자로 입력해 주세요.', { exact: true })).toBeVisible();
    await nickname.fill('  함께하는 두리  ');
    const previous = page.getByRole('button', { name: '이전 단계', exact: true });
    await previous.click();
    await expect(page.getByRole('radio', { name: '고등학교', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: '중학교', exact: true }).check();
    await next.click();
    await expect(nickname).toHaveValue('  함께하는 두리  ');
    await next.click();
    await expect(page.getByLabel('처음 설정 3 / 3단계', { exact: true })).toBeVisible();
    const start = page.getByRole('button', { name: '인터링크 시작하기', exact: true });
    await expect(start).toBeDisabled();
    await page.getByRole('checkbox', { name: '환경', exact: true }).check();
    await page.getByRole('checkbox', { name: '환경', exact: true }).uncheck();
    await expect(start).toBeDisabled();
    await page.getByRole('checkbox', { name: '환경', exact: true }).check();
    await page.getByRole('checkbox', { name: '기술', exact: true }).check();
    await previous.click();
    await expect(nickname).toHaveValue('함께하는 두리');
    await next.click();
    await expect(page.getByRole('checkbox', { name: '환경', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '기술', exact: true })).toBeChecked();
    const before = await stored(page);
    expect(before.profiles.find(person => person.id === DEMO_ACTORS.B)).toMatchObject({ nickname: '', educationLevel: null, interests: [], onboardingCompleted: false });
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          Storage.prototype.setItem = original;
          throw new DOMException('Test storage is full', 'QuotaExceededError');
        }
        return original.call(this, name, value);
      };
    }, DEMO_STORAGE_KEY);
    await start.click();
    await expect(page.getByText('설정을 저장하지 못했어요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.', { exact: true })).toBeVisible();
    await expect(page.getByText('데모 변경을 저장하지 못했어요. 다시 시도해 주세요.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
    await expect(page.getByRole('checkbox', { name: '환경', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '기술', exact: true })).toBeChecked();
    await previous.click();
    await expect(nickname).toHaveValue('함께하는 두리');
    await previous.click();
    await expect(page.getByRole('radio', { name: '중학교', exact: true })).toBeChecked();
    await next.click();
    await next.click();
    await start.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    const after = await stored(page);
    expect(after.profiles.find(person => person.id === DEMO_ACTORS.B)).toMatchObject({ nickname: '함께하는 두리', educationLevel: 'middle', interests: ['환경', '기술'], onboardingCompleted: true });
    expect(after.profiles.filter(person => person.id !== DEMO_ACTORS.B)).toEqual(before.profiles.filter(person => person.id !== DEMO_ACTORS.B));
    expect(after.projects).toEqual(before.projects);
    expect(after.applications).toEqual(before.applications);
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/$/);
  });

  test('restores legacy nickname and custom interests through one-time setup without losing existing activity', async ({ page }) => {
    const state = createDemoState('A');
    const person = state.profiles.find(profile => profile.id === DEMO_ACTORS.A)!;
    delete person.educationLevel;
    delete person.onboardingCompleted;
    person.nickname = '이어 쓰는 닉네임';
    person.interests = ['환경', '나만의 관심 분야'];
    state.saved.push({ userId: person.id, projectId: DEMO_PROJECTS.second });
    await seed(page, state);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: '데모 설정', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: '대학교', exact: true }).check();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '닉네임', exact: true })).toHaveValue(person.nickname);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    for (const interest of person.interests) await expect(page.getByRole('checkbox', { name: interest, exact: true })).toBeChecked();
    await page.getByRole('button', { name: '인터링크 시작하기', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    const after = await stored(page);
    expect(after.profiles.find(profile => profile.id === person.id)).toEqual({ ...person, educationLevel: 'university', onboardingCompleted: true });
    expect(after.projects).toEqual(state.projects);
    expect(after.saved).toEqual(state.saved);
    expect(after.communityMemberships).toEqual(state.communityMemberships);
    await page.reload();
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/$/);
  });

  test('persists later profile edits and keeps school, nickname and completion isolated when switching profiles', async ({ page }) => {
    const state = createDemoState('B');
    Object.assign(state.profiles.find(person => person.id === DEMO_ACTORS.A)!, {
      nickname: '', interests: [], educationLevel: null, onboardingCompleted: false,
    });
    await seed(page, state);
    await page.goto('/profile');
    await expect(page.getByText('가상 두리', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '프로필 편집', exact: true }).click();
    await expect(page).toHaveURL(/\/profile\/edit$/);
    await expect(page.getByRole('radio', { name: '대학교', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: '고등학교', exact: true }).check();
    await page.getByRole('textbox', { name: '닉네임', exact: true }).fill('수정한 두리');
    await page.getByRole('textbox', { name: '관심 분야', exact: true }).fill('과학, 나만의 관심');
    await page.getByRole('button', { name: '프로필 저장', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText('수정한 두리', { exact: true })).toBeVisible();
    await expect(page.getByText('고등학교', { exact: true })).toBeVisible();
    const edited = (await stored(page)).profiles.find(person => person.id === DEMO_ACTORS.B)!;
    expect(edited).toMatchObject({ nickname: '수정한 두리', educationLevel: 'high', interests: ['과학', '나만의 관심'], onboardingCompleted: true });
    await page.reload();
    await expect(page.getByText('수정한 두리', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '프로필 편집', exact: true }).click();
    await expect(page.getByRole('radio', { name: '고등학교', exact: true })).toBeChecked();
    await expect(page.getByRole('textbox', { name: '관심 분야', exact: true })).toHaveValue('과학, 나만의 관심');
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole('button', { name: '설정 열기', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: 'A · 팀장', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: '중학교', exact: true }).check();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '닉네임', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '이전 단계', exact: true }).click();
    await completeOnboarding(page, { nickname: '다른 프로필 나래', school: '중학교', interests: ['디자인'] });
    expect((await stored(page)).profiles.find(person => person.id === DEMO_ACTORS.B)).toEqual(edited);
    await page.goto('/settings');
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: 'B · 지원자', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    await page.goto('/profile');
    await expect(page.getByText('수정한 두리', { exact: true })).toBeVisible();
    await expect(page.getByText('고등학교', { exact: true })).toBeVisible();
    await expect(page.getByText('다른 프로필 나래', { exact: true })).toHaveCount(0);
  });

  test('caps legacy interests at twenty while allowing a selected tag to be replaced and saved', async ({ page }) => {
    const state = createDemoState('A');
    const person = state.profiles.find(profile => profile.id === DEMO_ACTORS.A)!;
    person.educationLevel = null;
    person.onboardingCompleted = false;
    person.interests = Array.from({ length: 20 }, (_, index) => `기존 관심 ${index + 1}`);
    await seed(page, state);
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole('radio', { name: '대학교', exact: true }).check();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '닉네임', exact: true })).toHaveValue(person.nickname);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(20);
    await expect(page.getByText('관심 분야는 최대 20개까지 선택할 수 있어요.', { exact: true })).toBeVisible();
    const environment = page.getByRole('checkbox', { name: '환경', exact: true });
    await expect(environment).toBeDisabled();
    const custom = page.getByRole('checkbox', { name: '기존 관심 20', exact: true });
    await custom.uncheck();
    await expect(custom).not.toBeChecked();
    await expect(environment).toBeEnabled();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(19);
    await custom.check();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(20);
    await expect(environment).toBeDisabled();
    await custom.uncheck();
    await environment.check();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(20);
    await expect(page.getByRole('checkbox', { name: '기술', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '인터링크 시작하기', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    expect((await stored(page)).profiles.find(profile => profile.id === person.id)).toEqual({
      ...person, educationLevel: 'university', onboardingCompleted: true,
      interests: [...person.interests.slice(0, 19), '환경'],
    });
  });
});
