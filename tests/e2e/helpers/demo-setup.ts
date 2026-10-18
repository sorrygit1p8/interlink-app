import { expect, type Page } from '@playwright/test';
import { createDemoState, DEMO_STORAGE_KEY, type DemoActor } from '../../../packages/data/src/fixtures';

/** Regression screens start from an explicitly completed profile; fresh-entry tests do not use this helper. */
export async function seedCompletedDemo(page: Page, actor: DemoActor = 'A') {
  const state = createDemoState(actor);
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
}

export async function completeOnboarding(page: Page, { nickname, school = '대학교', interests = ['환경'] }: {
  nickname: string;
  school?: '중학교' | '고등학교' | '대학교';
  interests?: string[];
}) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('radio', { name: school, exact: true }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('textbox', { name: '닉네임', exact: true }).fill(nickname);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  for (const interest of interests) await page.getByRole('checkbox', { name: interest, exact: true }).check();
  await page.getByRole('button', { name: '인터링크 시작하기', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
}
