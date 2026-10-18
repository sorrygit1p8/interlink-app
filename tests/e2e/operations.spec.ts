import { test, expect } from '@playwright/test';

const web = process.env.WEB_BASE_URL || 'http://127.0.0.1:3000';
test.describe('operations web explicit memory demo', () => {
  test('moderates a fictional report and records an audit note', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto(web);
    await expect(page.locator('.connection-pill')).toContainText('DEMO · 서버 미연결');
    await expect(page.getByRole('button', { name: '가상 운영 기록 초기화' })).toBeEnabled();
    await expect(page.getByRole('heading', { name: '좋은 연결을 지키는 곳.' })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/web-overview.png', fullPage: true });
    await page.locator('.report-row').first().click();
    const detail = page.getByRole('region', { name: '신고 상세' });
    await expect(detail.getByText('운영자 처리 흐름을 확인하기 위한 가상 신고입니다.')).toBeVisible();
    await expect(detail.getByRole('button', { name: '처리 완료 적용' })).toBeDisabled();
    await detail.getByRole('textbox', { name: /처리 메모/ }).fill('가상 신고를 확인하고 명확한 처리 근거를 남깁니다.');
    await detail.getByRole('button', { name: '처리 완료 적용' }).click();
    await expect(detail.locator('.badge')).toHaveText('처리 완료');
    await page.screenshot({ path: 'artifacts/screenshots/web-report.png', fullPage: true });
    await page.getByRole('button', { name: '감사 기록', exact: true }).click();
    await expect(page.getByRole('cell', { name: '가상 신고를 확인하고 명확한 처리 근거를 남깁니다.' })).toBeVisible();
  });

  test('creates a community and an expiring, bounded fictional invitation', async ({ page }) => {
    await page.goto(web); await page.getByRole('button', { name: '커뮤니티', exact: true }).click();
    await page.getByRole('textbox', { name: '커뮤니티 이름' }).fill('가상 환경 탐구실');
    await page.getByRole('button', { name: '커뮤니티 만들기' }).click();
    await expect(page.getByRole('button', { name: /가상 환경 탐구실.*구성원/ })).toBeVisible();
    await page.getByRole('combobox', { name: '커뮤니티', exact: true }).selectOption({ label: '가상 환경 탐구실' });
    await page.getByRole('spinbutton', { name: '최대 사용 횟수' }).fill('2');
    await page.getByRole('spinbutton', { name: '유효 기간 (일)' }).fill('1');
    await page.getByRole('button', { name: '초대 코드 생성' }).click();
    await expect(page.locator('.invite-result code')).toHaveText(/[0-9a-f-]{36}/);
    await expect(page.getByText('가상 초대 코드가 생성되었습니다. 외부 계정에는 사용할 수 없습니다.')).toBeVisible();
  });

  test('keeps account deletion request distinct from completed deletion and supports reset', async ({ page }) => {
    await page.goto(`${web}/account/delete`);
    await expect(page.getByText('가상 사용자 B의 삭제 시나리오 · 실제 계정은 삭제되지 않음')).toBeVisible();
    const submit = page.getByRole('button', { name: '가상 계정 삭제 시나리오 실행' }); await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check(); await page.getByRole('textbox', { name: '확인을 위해 DELETE를 입력해 주세요.' }).fill('DELETE');
    await submit.click(); await expect(page.getByRole('status').getByText('삭제 요청됨', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').getByText('삭제 완료', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/screenshots/web-deletion.png', fullPage: true });
    await page.getByRole('button', { name: '가상 사용자 초기화' }).click(); await expect(submit).toBeVisible();
  });

  test('loads communities on the next page and preserves loaded pages after refresh', async ({ page }) => {
    await page.goto(web); await page.getByRole('button', { name: '커뮤니티', exact: true }).click();
    const name = page.getByRole('textbox', { name: '커뮤니티 이름' });
    const create = page.getByRole('button', { name: '커뮤니티 만들기' });
    for (let index = 1; index <= 21; index++) {
      await expect(name).toHaveValue('');
      await expect(create).toBeDisabled();
      await name.fill(`가상 페이지 검증 ${String(index).padStart(2, '0')}`);
      await expect(create).toBeEnabled();
      await create.click();
      await expect(page.locator('.community-row')).toHaveCount(Math.min(20, index + 1));
      await expect(name).toHaveValue('');
      await expect(create).toBeDisabled();
    }
    await expect(page.locator('.community-row')).toHaveCount(20);
    await page.getByRole('button', { name: '커뮤니티 더 보기', exact: true }).click();
    await expect(page.locator('.community-row')).toHaveCount(22);
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(page.locator('.community-row')).toHaveCount(22);
    await page.screenshot({ path: 'artifacts/screenshots/web-community-pagination.png', fullPage: true });
  });

  test('requires same-origin JSON and rejects actual API use in demo without granting fake admin access', async ({ request }) => {
    const crossSite = await request.post(`${web}/api/data`, { data: { type: 'query', name: 'admin.overview', input: {} }, headers: { Origin: 'https://untrusted.invalid' } });
    expect(crossSite.status()).toBe(403); expect((await crossSite.json()).error.code).toBe('FORBIDDEN');
    const sameOrigin = await request.post(`${web}/api/data`, { data: { type: 'query', name: 'admin.overview', input: {} }, headers: { Origin: web } });
    expect([401, 503]).toContain(sameOrigin.status());
    expect(['UNAUTHENTICATED', 'CONFIGURATION']).toContain((await sameOrigin.json()).error.code);
  });

  test('applies and restores fictional account restrictions with an audit trail', async ({ page }) => {
    await page.goto(web); await page.getByRole('button', { name: /신고 관리/ }).click();
    await page.locator('.report-row').filter({ hasText: '커뮤니티 규칙 확인' }).click();
    const detail = page.getByRole('region', { name: '신고 상세' });
    await detail.getByRole('combobox', { name: '운영 조치' }).selectOption('suspend');
    await detail.getByRole('textbox', { name: /처리 메모/ }).fill('가상 계정 제한의 근거를 확인했습니다.');
    await detail.getByRole('button', { name: '계정 제한 적용' }).click();
    await expect(page.getByRole('status')).toContainText('가상 신고에 조치가 반영');
    await detail.getByRole('combobox', { name: '운영 조치' }).selectOption('reactivate');
    await detail.getByRole('textbox', { name: /처리 메모/ }).fill('가상 계정 제한을 검토하고 해제합니다.');
    await detail.getByRole('button', { name: '계정 제한 해제 적용' }).click();
    await page.getByRole('button', { name: '감사 기록', exact: true }).click();
    await expect(page.getByRole('cell', { name: '가상 계정 제한을 검토하고 해제합니다.' })).toBeVisible();
  });

  test('queues a failed demo job for retry and never labels it completed', async ({ page }) => {
    await page.goto(web); await page.getByRole('button', { name: '작업 모니터', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: 'DEMO_PROVIDER_UNAVAILABLE' });
    await expect(row).toContainText('실패'); await row.getByRole('button', { name: '재시도', exact: true }).click();
    await page.getByRole('textbox', { name: '재시도 사유' }).fill('가상 제공자 오류를 검토한 후 다시 시도합니다.');
    await page.getByRole('button', { name: '재시도 대기열에 등록' }).click();
    await expect(page.getByRole('status')).toContainText('가상 작업이 재시도 대기 상태');
    const updated = page.getByRole('row').filter({ hasText: 'push' }); await expect(updated).toContainText('대기'); await expect(updated).not.toContainText('완료');
    await page.screenshot({ path: 'artifacts/screenshots/web-jobs.png', fullPage: true });
  });
});
