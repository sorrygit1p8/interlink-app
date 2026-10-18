import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_STORAGE_KEY } from '../../packages/data/src/fixtures';

const banners = [
  { action: '공모전 모집글 모아보기', purpose: '공모전', project: '상상으로 만드는 작은 전시' },
  { action: '캡스톤 팀 찾아보기', purpose: '캡스톤', project: '우리 동네, 초록 지도' },
  { action: '조별과제 모집글 보기', purpose: '조별과제', project: null },
] as const;
const viewports = [{ width: 360, height: 780 }, { width: 412, height: 890 }, { width: 768, height: 1024 }];

async function openHome(page: Page) {
  const state = createDemoState('B');
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: DEMO_STORAGE_KEY, state });
  await page.goto('/');
  await expect(page.getByTestId('home-banner-active')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function settledPosition(page: Page) {
  const active = page.getByTestId('home-banner-active');
  // Sample the rendered position over several frames: changing the page number
  // alone must not let a partly clipped or still-moving card pass this check.
  await expect.poll(async () => active.evaluate(async element => {
    const viewport = document.querySelector('[data-testid="home-banner-carousel"]');
    if (!viewport) return false;
    const offsets: number[] = [];
    for (let sample = 0; sample < 3; sample++) {
      offsets.push(element.getBoundingClientRect().x - viewport.getBoundingClientRect().x);
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    return offsets.every(offset => Math.abs(offset - 20) <= 1) && Math.max(...offsets) - Math.min(...offsets) <= .5;
  }), { timeout: 5_000 }).toBe(true);
}

async function aligned(page: Page, index: number) {
  const active = page.getByTestId('home-banner-active');
  const viewport = page.getByTestId('home-banner-carousel');
  await expect(active).toHaveAccessibleName(banners[index]!.action);
  await expect(page.getByTestId('home-banner-pager')).toHaveAccessibleName(`추천 배너 ${index + 1} / 3, 다음 배너 보기`);
  await settledPosition(page);
  const outer = (await viewport.boundingBox())!;
  const card = (await active.boundingBox())!;
  expect(outer.width).toBeCloseTo(Math.min(page.viewportSize()!.width, 620), 0);
  expect(card.width).toBeCloseTo(outer.width - 56, 0);
  expect(card.x).toBeGreaterThanOrEqual(outer.x);
  expect(card.x + card.width).toBeLessThanOrEqual(outer.x + outer.width);
  await expect(page.getByRole('button', { name: new RegExp('^(' + banners.map(banner => banner.action).join('|') + ')$') })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function swipe(page: Page, dx: number, dy = 0, stepDuration = 45) {
  const card = (await page.getByTestId('home-banner-active').boundingBox())!;
  const startX = card.x + card.width * (dx < 0 ? .78 : dx > 0 ? .22 : .5);
  const startY = card.y + card.height * (dy < 0 ? .8 : .45);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + dx * step / 8, y: startY + dy * step / 8 }] });
      // Keep the gesture slow enough to distinguish a tiny drag from a flick.
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test('tiny swipes settle aligned and full swipes loop continuously through both ends at phone and tablet widths', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHome(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await aligned(page, 0);
    for (const distance of [-24, 24]) {
      await swipe(page, distance);
      await aligned(page, 0);
      await expect(page).toHaveURL(/\/$/);
    }
    const card = (await page.getByTestId('home-banner-active').boundingBox())!;
    const distance = (card.width + 12) * .55;
    for (const index of [1, 2, 0, 1, 2, 0]) {
      await swipe(page, -distance);
      await aligned(page, index);
      await expect(page).toHaveURL(/\/$/);
    }
    for (const index of [2, 1, 0, 2, 1, 0]) {
      await swipe(page, distance);
      await aligned(page, index);
      await expect(page).toHaveURL(/\/$/);
    }
    for (const dx of [-30, 30]) {
      await swipe(page, dx, 0, 3);
      await settledPosition(page);
      const label = await page.getByTestId('home-banner-active').getAttribute('aria-label');
      let index = banners.findIndex(banner => banner.action === label);
      expect(dx < 0 ? [0, 1] : [0, 2]).toContain(index);
      await aligned(page, index);
      await expect(page).toHaveURL(/\/$/);
      // A fast flick may advance despite its small distance. Return through the
      // real pager so the next direction starts from the same first-card edge.
      while (index !== 0) {
        await page.getByTestId('home-banner-pager').click();
        index = (index + 1) % banners.length;
        await aligned(page, index);
      }
    }
    await page.screenshot({ path: `artifacts/screenshots/home-banner-aligned-${viewport.width}.png`, animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});

test('pager and arrow keys wrap accessibly, resize keeps the selected card aligned, and every banner opens its actual purpose', async ({ page }) => {
  await page.setViewportSize(viewports[0]!);
  await openHome(page);
  const pager = page.getByTestId('home-banner-pager');
  await pager.focus();
  await pager.press('ArrowLeft');
  await aligned(page, 2);
  for (const viewport of [viewports[1]!, viewports[2]!, viewports[0]!]) {
    await page.setViewportSize(viewport);
    await aligned(page, 2);
  }
  await pager.press('ArrowRight');
  await aligned(page, 0);
  await pager.click();
  await aligned(page, 1);
  await pager.press('ArrowRight');
  await aligned(page, 2);
  await pager.click();
  await aligned(page, 0);

  for (const [index, banner] of banners.entries()) {
    if (index > 0) {
      await page.goto('/');
      await aligned(page, 0);
      for (let step = 0; step < index; step++) {
        await pager.click();
        await aligned(page, step + 1);
      }
    }
    await page.getByTestId('home-banner-active').click();
    await expect(page).toHaveURL(/\/explore(?:\?|$)/);
    await expect(page.getByLabel('선택 조건: ' + banner.purpose, { exact: true })).toBeVisible();
    if (banner.project) {
      await expect(page.getByRole('button', { name: banner.project + ' 상세 보기', exact: true })).toBeVisible();
    } else {
      await expect(page.getByText('검색 결과가 없어요', { exact: true })).toBeVisible();
    }
    for (const title of ['상상으로 만드는 작은 전시', '우리 동네, 초록 지도', '하루 한 번, 배움 기록'].filter(title => title !== banner.project)) {
      await expect(page.getByRole('button', { name: title + ' 상세 보기', exact: true })).toHaveCount(0);
    }
  }
});

test('a vertical gesture starting on the banner still scrolls the home page without activating or changing a card', async ({ page }) => {
  await page.setViewportSize(viewports[0]!);
  await openHome(page);
  await aligned(page, 0);
  const viewport = page.getByTestId('home-banner-carousel');
  const before = (await viewport.boundingBox())!.y;
  await swipe(page, 0, -140);
  await expect.poll(async () => before - (await viewport.boundingBox())!.y).toBeGreaterThan(30);
  await expect(page).toHaveURL(/\/$/);
  await aligned(page, 0);
  await expect(page.getByRole('tab', { name: /홈$/ })).toBeInViewport();
});
