import { test, expect } from '@playwright/test';
import { seedCompletedDemo } from './helpers/demo-setup';

test('mobile home fits narrow phone and tablet viewports with reachable primary action', async ({ page }) => {
  await seedCompletedDemo(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const [name, width, height] of [['narrow', 360, 780], ['tablet', 768, 1024]] as const) {
    await page.setViewportSize({ width, height }); await page.goto('/');
    await expect(page.getByText('데모 체험 시작하기', { exact: true })).toHaveCount(0);
    const action = page.getByRole('button', { name: '팀 모집하기', exact: true });
    await expect(action).toBeVisible(); await action.scrollIntoViewIfNeeded();
    const bounds = await action.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('textbox', { name: '홈 검색어', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/screenshots/mobile-home-${name}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('operations overview fits narrow phone and tablet viewports without page overflow', async ({ page }) => {
  const web = process.env.WEB_BASE_URL || 'http://127.0.0.1:3000';
  for (const [name, width, height] of [['narrow', 360, 780], ['tablet', 768, 1024]] as const) {
    await page.setViewportSize({ width, height }); await page.goto(web);
    await expect(page.getByRole('heading', { name: '좋은 연결을 지키는 곳.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/screenshots/web-overview-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: '감사 기록', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
