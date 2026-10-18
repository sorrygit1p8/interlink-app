import { test, expect } from '@playwright/test';
import { DEMO_ACTORS, DEMO_STORAGE_KEY } from '../../packages/data/src/fixtures';
import { completeOnboarding, seedCompletedDemo } from './helpers/demo-setup';

test.describe('direct entry into the explicitly fictional local demo', () => {
  test('opens setup before any home on a fresh device and remembers completion without a role chooser', async ({ page }) => {
    await page.addInitScript(() => {
      const observed = window as typeof window & { onboardingHomeFlash: boolean; watchOnboardingHome: boolean };
      observed.onboardingHomeFlash = false;
      observed.watchOnboardingHome = true;
      const sample = () => {
        if (!observed.watchOnboardingHome) return;
        const action = document.querySelector('[role="button"][aria-label="팀 모집하기"]');
        if (action) {
          const box = action.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          if (box.width > 0 && box.height > 0 && hit && action.contains(hit)) observed.onboardingHomeFlash = true;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByLabel('처음 설정 1 / 3단계', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toHaveCount(0);
    await expect(page.getByText('데모 체험 시작하기', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'A · 팀장으로 시작', exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: '대학교', exact: true }).check();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '닉네임', exact: true })).toHaveValue('');
    await page.getByRole('textbox', { name: '닉네임', exact: true }).fill('처음 만나는 나래');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('checkbox', { name: '환경', exact: true }).check();
    const homeFlashed = await page.evaluate(() => {
      const observed = window as typeof window & { onboardingHomeFlash: boolean; watchOnboardingHome: boolean };
      observed.watchOnboardingHome = false;
      return observed.onboardingHomeFlash;
    });
    expect(homeFlashed).toBe(false);
    await page.getByRole('button', { name: '인터링크 시작하기', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '팀 모집하기', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('button', { name: '내 프로필 열기', exact: true }).click();
    await expect(page.getByText('처음 만나는 나래', { exact: true })).toBeVisible();
    await expect(page.getByText('가상 프로필', { exact: true })).toBeVisible();
  });

  test('restores the selected profile after reload and resets to fresh setup for the default profile', async ({ page }) => {
    await seedCompletedDemo(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: 'B · 지원자', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/profile');
    await expect(page.getByText('가상 두리', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('가상 두리', { exact: true })).toBeVisible();
    await expect(page.getByText('데모 체험 시작하기', { exact: true })).toHaveCount(0);
    await page.goto('/settings');
    await page.reload();
    await expect(page.getByText(/가상 프로필과 활동 기록은 이 기기에 저장되며 다음 실행에도 이어져요/)).toBeVisible();
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: '데모 데이터 초기화', exact: true }).click();
    await page.getByRole('button', { name: '데모 초기화', exact: true }).click();
    await expect(page.getByText('데모를 처음부터 시작할까요?', { exact: true })).toBeHidden();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled();
    const reset = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
    expect(reset.actor).toBe('A');
    expect(reset.profiles.find((person: { id: string }) => person.id === DEMO_ACTORS.A)).toMatchObject({ nickname: '', interests: [], educationLevel: null, onboardingCompleted: false });
    await completeOnboarding(page, { nickname: '가상 나래' });
    await page.goto('/profile');
    await expect(page.getByText('가상 나래', { exact: true })).toBeVisible();
    await expect(page.getByText('데모 체험 시작하기', { exact: true })).toHaveCount(0);
  });

  test('preserves a completed profile project deep link on cold start', async ({ page }) => {
    await seedCompletedDemo(page);
    const route = '/project/20000000-0000-4000-8000-000000000001';
    await page.goto(route);
    await expect(page.getByRole('button', { name: '신청자 관리', exact: true })).toBeVisible();
    await expect(page.getByText('우리 동네, 초록 지도', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByText('데모 체험 시작하기', { exact: true })).toHaveCount(0);
  });
});
