import { expect, test } from '@playwright/test';
import { seedCompletedDemo } from './helpers/demo-setup';

test.beforeEach(async ({ page }) => { await seedCompletedDemo(page); });

test.describe('mobile accessibility and query error recovery', () => {
  test('restores exploration scroll, filter and sort after returning from project details', async ({ page }) => {
    await page.goto('/explore');
    const card = page.getByRole('button', { name: / 상세 보기$/ }).last();
    await card.scrollIntoViewIfNeeded();
    const scrollPosition = () => page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('*'), element => element.scrollTop)));
    const before = await scrollPosition();
    expect(before).toBeGreaterThan(0);
    await card.click();
    await page.getByRole('button', { name: '프로젝트 더보기', exact: true }).click();
    await expect(page.getByRole('button', { name: '프로젝트 공유', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 검색어', exact: true })).toBeVisible();
    await expect.poll(scrollPosition).toBe(before);
    await page.getByRole('button', { name: '환경', exact: true }).click();
    await page.getByRole('button', { name: '정렬 변경', exact: true }).click();
    await page.getByRole('button', { name: '우리 동네, 초록 지도 상세 보기', exact: true }).click();
    await page.getByRole('button', { name: '프로젝트 더보기', exact: true }).click();
    await expect(page.getByRole('button', { name: '프로젝트 공유', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await expect(page.getByLabel('선택 조건: 환경', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '정렬 변경', exact: true }).getByText('최신순', { exact: true })).toBeVisible();
  });

  test('exposes selected discovery tabs and filters, and keeps saving separate from navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '캡스톤 팀 찾기', exact: true })).not.toHaveAttribute('aria-pressed');
    await page.getByRole('button', { name: '프로젝트 검색', exact: true }).click();
    const projectTab = page.getByRole('tab', { name: '프로젝트', exact: true });
    const peopleTab = page.getByRole('tab', { name: '사람', exact: true });
    await expect(projectTab).toHaveAttribute('aria-selected', 'true');
    await expect(peopleTab).toHaveAttribute('aria-selected', 'false');
    await peopleTab.click();
    await expect(peopleTab).toHaveAttribute('aria-selected', 'true');
    await expect(projectTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('textbox', { name: '사람 검색어', exact: true })).toBeVisible();
    await projectTab.click();
    const environment = page.getByRole('button', { name: '환경', exact: true });
    await environment.click();
    await expect(environment).toHaveAttribute('aria-pressed', 'true');
    const save = page.getByRole('button', { name: '우리 동네, 초록 지도 저장', exact: true });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(page.getByRole('button', { name: '우리 동네, 초록 지도 저장 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(url => url.pathname === '/explore');
  });

  test('exposes avatar and invitation-project choices with the correct button and radio semantics', async ({ page }) => {
    await page.goto('/profile/edit');
    const star = page.getByRole('button', { name: '별 아바타', exact: true });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '링 아바타', exact: true })).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
    await page.getByRole('button', { name: '작성 그만두기', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/');
    await page.goto('/invite/10000000-0000-4000-8000-000000000003');
    const project = page.getByRole('radio').first();
    await expect(project).toHaveAttribute('aria-checked', 'false');
    await project.click();
    await expect(project).toHaveAttribute('aria-checked', 'true');
  });

  test('confirmation respects reduced motion and responds to a live preference change', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/settings');
    await page.getByRole('button', { name: '데모 설정', exact: true }).click();
    await page.getByRole('button', { name: '데모 데이터 초기화', exact: true }).click();
    const title = page.getByText('데모를 처음부터 시작할까요?', { exact: true });
    await expect(title).toBeVisible();
    const animatedAncestors = () => title.evaluate(element => {
      const animations: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.animationName !== 'none' && style.animationDuration.split(',').some(value => parseFloat(value) > 0)) animations.push(style.animationName);
      }
      return animations;
    });
    await expect.poll(animatedAncestors).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await animatedAncestors()).length).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(animatedAncestors).toEqual([]);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(title).toHaveCount(0);
  });

  test('missing project offers one recoverable error before displaying application or invitation lists', async ({ page }) => {
    await page.goto('/applications/20000000-0000-4000-8000-000000000099');
    await expect(page.getByText('잠시 연결이 어려워요', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
    await expect(page.getByText('아직 보낸 초대가 없어요.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('아직 신청이 없어요', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
  });
});
