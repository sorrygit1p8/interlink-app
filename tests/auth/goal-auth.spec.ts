import { expect, test } from '@playwright/test';

test('real-mode login validates input, recovers from mocked OTP errors, and never switches to demo', async ({ page }, testInfo) => {
  const unexpected: string[] = [];
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let otpRequests = 0;
  // Every external HTTP and socket is intercepted. The reserved .invalid host and
  // synthetic publishable key come from check-production-bundle.mjs, not a service account.
  await page.routeWebSocket(/.*/, socket => { unexpected.push('socket:' + socket.url()); socket.close(); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:8082') { await route.continue(); return; }
    if (url.hostname !== 'static-bundle-check.invalid' || request.method() !== 'POST' || !['/auth/v1/otp', '/auth/v1/verify'].includes(url.pathname)) {
      unexpected.push(request.url()); await route.abort('blockedbyclient'); return;
    }
    requests.push({ path: url.pathname, body: request.postDataJSON() });
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Supabase-Api-Version', 'x-supabase-api-version': '2024-01-01' };
    if (url.pathname === '/auth/v1/otp') {
      otpRequests++;
      await route.fulfill(otpRequests === 1
        ? { status: 429, headers, json: { code: 'over_email_send_rate_limit', message: 'Synthetic provider rate-limit failure' } }
        : { status: 200, headers, json: {} });
    } else {
      await route.fulfill({ status: 403, headers, json: { code: 'otp_expired', message: 'Synthetic expired or incorrect OTP' } });
    }
  });

  await page.goto('/auth?returnTo=%2Fsaved');
  const email = page.getByRole('textbox', { name: '이메일', exact: true });
  const send = page.getByRole('button', { name: '인증코드 받기', exact: true });
  await expect(email).toBeVisible();
  await email.fill('not-an-email');
  await expect(send).toBeDisabled();
  expect(requests).toHaveLength(0);
  await email.fill('synthetic-student@example.invalid');
  await send.click();
  await expect(page.getByText('요청이 많아요. 잠시 후 다시 시도해 주세요.', { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '인증코드', exact: true })).toHaveCount(0);

  await page.clock.install({ time: new Date('2026-10-18T02:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-18T02:00:01Z'));
  await send.click();
  const code = page.getByRole('textbox', { name: '인증코드', exact: true });
  await expect(code).toBeVisible();
  await expect(page.getByRole('button', { name: /^코드 재요청 · / })).toBeDisabled();
  const verify = page.getByRole('button', { name: '인증하고 계속하기', exact: true });
  await code.fill('12345');
  await expect(verify).toBeDisabled();
  await code.fill('123456');
  await verify.click();
  await expect(page.getByText('로그인이 필요해요.', { exact: true })).toBeVisible();
  await expect(code).toHaveValue('123456');
  await expect(verify).toBeEnabled();
  await expect(page).toHaveURL(url => url.pathname === '/auth' && url.searchParams.get('returnTo') === '/saved');
  await page.screenshot({ path: testInfo.outputPath('mobile-auth-error.png'), fullPage: true });

  // Flush each React effect before advancing again: the UI schedules its next
  // one-second tick after rendering, rather than through a fixed interval.
  for (let remaining = 59; remaining >= 0; remaining--) {
    await page.clock.runFor(1000);
    await expect(page.getByRole('button', { name: remaining ? '코드 재요청 · ' + remaining + '초' : '코드 다시 요청', exact: true })).toBeVisible();
  }
  const resend = page.getByRole('button', { name: '코드 다시 요청', exact: true });
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.getByText('로그인이 필요해요.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^코드 재요청 · / })).toBeDisabled();
  expect(requests.map(request => request.path)).toEqual(['/auth/v1/otp', '/auth/v1/otp', '/auth/v1/verify', '/auth/v1/otp']);
  expect(requests[2]?.body).toMatchObject({ email: 'synthetic-student@example.invalid', token: '123456', type: 'email' });
  expect(await page.evaluate(() => Object.keys(window.sessionStorage).filter(key => /^interlink\.supabase\.(?:session\.v1$|[^.]+\.session\.v2\.[0-9a-f]+$)/.test(key)))).toEqual([]);

  await page.clock.resume();
  await page.goto('/settings');
  await expect(page.getByText('실제 연결 모드', { exact: true })).toBeVisible();
  await expect(page.getByText('환경: production · 데이터: supabase', { exact: true })).toBeVisible();
  await expect(page.getByText('가상 역할 전환', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('interlink.demo.state.v1'))).toBeNull();
  expect(unexpected).toEqual([]);
});
