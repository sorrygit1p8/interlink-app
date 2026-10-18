import { describe, expect, it } from 'vitest';
import { checkConfiguration, type PolicyDocuments } from '../../scripts/check-config';
import { policies } from '../../apps/web/content/policies';

const staging = { EXPO_PUBLIC_DATA_MODE: 'supabase', EXPO_PUBLIC_APP_ENV: 'staging', EXPO_PUBLIC_SUPABASE_URL: 'https://staging.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
// Fictional values are parser fixtures only. They are never saved as deployment settings.
const parserFixture = { ...staging, EXPO_PUBLIC_APP_ENV: 'production', INTERLINK_ANDROID_PACKAGE: 'org.fixture.interlink', INTERLINK_IOS_BUNDLE_ID: 'org.fixture.interlink', INTERLINK_OPERATOR_NAME: 'Test operator', INTERLINK_SUPPORT_EMAIL: 'support@fixture.invalid', INTERLINK_PRIVACY_URL: 'https://fixture.invalid/privacy', INTERLINK_TERMS_URL: 'https://fixture.invalid/terms', INTERLINK_RETENTION_POLICY: 'Explicit reviewed retention fixture', INTERLINK_LAUNCH_REVIEW_APPROVED: 'true' };
// In-memory fixtures exercise the validator; no environment/CLI switch can replace
// the actual policy documents. The shipped legal/operating drafts stay unresolved.
const resolvedPolicyFixture: PolicyDocuments = Object.fromEntries(Object.entries(policies).map(([key, document]) => [key, {
  ...document, sections: document.sections.map(([heading, body]) => [heading, body.replaceAll('[미확정]', '검토가 완료된 테스트 정보')]),
}]));
const edgeFixture = { INTERLINK_DATA_MODE: 'supabase', INTERLINK_APP_ENV: 'staging', SUPABASE_URL: 'https://backend.fixture.invalid', SUPABASE_ANON_KEY: 'sb_publishable_fixture', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_never_deployed', INTERLINK_WORKER_SECRET: 'test-only-independent-worker-value-0123456789', EDGE_ALLOWED_ORIGINS: 'https://web.fixture.invalid' };

describe('release configuration parser (presence is not launch approval)', () => {
  it('allows default demo and reports its actual-service limitation', () => {
    const result = checkConfiguration({}); expect(result.ok).toBe(true); expect(result.mode).toBe('demo'); expect(result.warnings.join(' ')).toContain('Fictional');
  });
  it('requires user-owned app identifiers, operating policies and a separate review marker for production', () => {
    const result = checkConfiguration({ ...staging, EXPO_PUBLIC_APP_ENV: 'production' });
    expect(result.ok).toBe(false);
    for (const name of ['INTERLINK_ANDROID_PACKAGE', 'INTERLINK_IOS_BUNDLE_ID', 'INTERLINK_OPERATOR_NAME', 'INTERLINK_SUPPORT_EMAIL', 'INTERLINK_PRIVACY_URL', 'INTERLINK_TERMS_URL', 'INTERLINK_RETENTION_POLICY', 'INTERLINK_LAUNCH_REVIEW_APPROVED']) expect(result.errors.join(' ')).toContain(name);
  });
  it('detects explicitly public server secrets in every data mode', () => {
    for (const name of ['EXPO_PUBLIC_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_PRIVATE_KEY', 'EXPO_PUBLIC_WORKER_SECRET', 'NEXT_PUBLIC_SMTP_PASSWORD']) {
      const result = checkConfiguration({ [name]: 'non-secret-test-marker' }); expect(result.ok).toBe(false); expect(result.errors.join(' ')).toContain(name);
    }
  });
  it('rejects unresolved policy values and insecure policy URLs', () => {
    for (const value of ['미확정', 'TBD', 'https://example.com/privacy', 'http://fixture.invalid/privacy', 'https://localhost/privacy']) {
      expect(checkConfiguration({ ...parserFixture, INTERLINK_PRIVACY_URL: value }, { policyDocuments: resolvedPolicyFixture }).ok).toBe(false);
    }
  });
  it('keeps valid configuration separate from service and security verification', () => {
    const result = checkConfiguration(parserFixture, { policyDocuments: resolvedPolicyFixture }); expect(result.ok).toBe(true); expect(result.warnings.join(' ')).toContain('not proof');
  });
  it('blocks the actual unresolved policy pages even when every environment declaration and review flag is filled', () => {
    const result = checkConfiguration(parserFixture);
    expect(result.ok).toBe(false);
    for (const heading of ['서비스와 운영 주체', '가입과 참여', '개인정보 처리자', '위탁과 국외 이전', '보유와 삭제', '운영 문의']) expect(result.errors.join('\n')).toContain(heading);
  });
  it('cannot hide production web policy checks behind mobile development settings', () => {
    const env = { ...parserFixture, EXPO_PUBLIC_APP_ENV: 'development', INTERLINK_DATA_MODE: 'supabase', INTERLINK_APP_ENV: 'production', SUPABASE_URL: staging.EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY: staging.EXPO_PUBLIC_SUPABASE_ANON_KEY };
    expect(checkConfiguration(env, { policyDocuments: resolvedPolicyFixture }).ok).toBe(true);
    expect(checkConfiguration(env).errors.join('\n')).toContain('Resolve production policy draft');
    expect(checkConfiguration({ ...env, INTERLINK_DATA_MODE: 'demo' }, { policyDocuments: resolvedPolicyFixture }).errors.join('\n')).toContain('Web configuration');
  });
  it.each(['서비스와 운영 주체', '가입과 참여', '개인정보 처리자', '위탁과 국외 이전', '보유와 삭제', '운영 문의'])('requires resolution of the actual %s policy section', (heading) => {
    const documents = structuredClone(resolvedPolicyFixture);
    for (const document of Object.values(documents)) document.sections = document.sections.map(([title, body]) => [title, title === heading ? `${body} [미확정]` : body]);
    const result = checkConfiguration(parserFixture, { policyDocuments: documents });
    expect(result.ok).toBe(false); expect(result.errors.join('\n')).toContain(heading);
  });
  it('cannot pass policy review by dropping required pages or privacy/consent sections', () => {
    const missingPage = { ...resolvedPolicyFixture, privacy: undefined };
    expect(checkConfiguration(parserFixture, { policyDocuments: missingPage }).ok).toBe(false);
    for (const heading of ['가입과 참여', '위탁과 국외 이전', '보유와 삭제']) {
      const documents = structuredClone(resolvedPolicyFixture);
      for (const document of Object.values(documents)) document.sections = document.sections.filter(([title]) => title !== heading);
      expect(checkConfiguration(parserFixture, { policyDocuments: documents }).errors.join('\n')).toContain(heading);
    }
  });
});

describe('server deployment preflight without client secret requirements', () => {
  it('keeps ordinary client demo usable without remote configuration', () => {
    expect(checkConfiguration({})).toMatchObject({ ok: true, target: 'client', mode: 'demo' });
    expect(checkConfiguration(staging).ok).toBe(true);
  });
  it.each(['edge', 'backend'] as const)('validates complete %s settings independently of public client configuration', (target) => {
    expect(checkConfiguration({ ...edgeFixture, EXPO_PUBLIC_DATA_MODE: 'demo', EXPO_PUBLIC_APP_ENV: 'development' }, { target })).toMatchObject({ ok: true, target, mode: 'supabase', environment: 'staging' });
  });
  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'INTERLINK_WORKER_SECRET', 'EDGE_ALLOWED_ORIGINS'])('rejects a missing %s server setting', (name) => {
    const result = checkConfiguration({ ...edgeFixture, [name]: '', ...staging }, { target: 'edge' });
    expect(result.ok).toBe(false);
  });
  it('does not treat an external-free demo as a deployable Edge configuration', () => {
    expect(checkConfiguration({}, { target: 'edge' })).toMatchObject({ ok: false, mode: 'demo' });
  });
  it('rejects public keys used as service keys and worker secrets outside the supported length', () => {
    expect(checkConfiguration({ ...edgeFixture, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_fixture' }, { target: 'edge' }).ok).toBe(false);
    for (const value of ['short', 'x'.repeat(513), ' '.repeat(40)]) expect(checkConfiguration({ ...edgeFixture, INTERLINK_WORKER_SECRET: value }, { target: 'edge' }).ok).toBe(false);
    expect(checkConfiguration({ ...edgeFixture, INTERLINK_WORKER_SECRET: edgeFixture.SUPABASE_SERVICE_ROLE_KEY }, { target: 'edge' }).ok).toBe(false);
    const serviceRole = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    expect(checkConfiguration({ ...edgeFixture, SUPABASE_SERVICE_ROLE_KEY: serviceRole }, { target: 'edge' }).ok).toBe(true);
  });
  it('matches the actual Edge runtime local HTTP backend hosts', () => {
    for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://kong:8000', 'http://host.docker.internal:54321']) {
      expect(checkConfiguration({ ...edgeFixture, SUPABASE_URL: url }, { target: 'edge' }).ok).toBe(true);
    }
    for (const url of ['http://[::1]:54321', 'http://127.0.0.2:54321']) {
      expect(checkConfiguration({ ...edgeFixture, SUPABASE_URL: url }, { target: 'edge' }).ok).toBe(false);
    }
  });
  it('requires a public upload-auth key rather than a second service credential', () => {
    expect(checkConfiguration({ ...edgeFixture, SUPABASE_ANON_KEY: edgeFixture.SUPABASE_SERVICE_ROLE_KEY }, { target: 'edge' }).ok).toBe(false);
    const anon = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
    expect(checkConfiguration({ ...edgeFixture, SUPABASE_ANON_KEY: anon }, { target: 'edge' }).ok).toBe(true);
  });
  it.each(['*', 'null', 'https://*.fixture.invalid', 'https://web.fixture.invalid/', 'https://web.fixture.invalid/path', 'https://web.fixture.invalid?key=value', 'https://web.fixture.invalid#fragment', 'https://user:password@web.fixture.invalid', 'http://web.fixture.invalid', 'https://web.fixture.invalid,'])('rejects an imprecise browser origin: %s', (value) => {
    expect(checkConfiguration({ ...edgeFixture, EDGE_ALLOWED_ORIGINS: value }, { target: 'edge' }).ok).toBe(false);
  });
  it('allows exact local HTTP origins only before production and never exposes a secret in diagnostics', () => {
    expect(checkConfiguration({ ...edgeFixture, EDGE_ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:8081' }, { target: 'edge' }).ok).toBe(true);
    const privateValue = 'do-not-echo-this-value';
    const result = checkConfiguration({ ...edgeFixture, INTERLINK_APP_ENV: 'production', EDGE_ALLOWED_ORIGINS: 'https://127.0.0.2,https://[::1]', INTERLINK_WORKER_SECRET: privateValue }, { target: 'edge' });
    expect(result.ok).toBe(false); expect(result.errors.join('\n')).toContain('EDGE_ALLOWED_ORIGINS'); expect(JSON.stringify(result)).not.toContain(privateValue);
  });
  it.each(['https://user:password@backend.fixture.invalid', 'https://backend.fixture.invalid/path', 'https://backend.fixture.invalid?key=value'])('requires the backend URL to be an origin: %s', (url) => {
    expect(checkConfiguration({ ...edgeFixture, SUPABASE_URL: url }, { target: 'edge' }).ok).toBe(false);
  });
});
