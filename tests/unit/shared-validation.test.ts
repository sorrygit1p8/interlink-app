import { describe, expect, it } from 'vitest';
import { AppError, assertRuntimeConfig, isSafeLink, profileInputSchema, projectInputSchema, searchSchema, validateCommand } from '@interlink/shared';

const projectId = '20000000-0000-4000-8000-000000000001';
const validProject = { title: '가상 환경 프로젝트', goal: '함께 환경 문제를 탐구해요', description: '가상 프로젝트에 사용할 테스트 설명입니다.', interests: ['환경'], roles: ['개발'], capacity: 2, activityMode: 'online', availability: ['주말 오전'], deadline: '2027-01-01T12:00:00Z', beginnerFriendly: true };
const profile = { nickname: '가상 학생', avatar: 'leaf', interests: [], roles: [], learningRoles: [], skills: [], availability: [], activityMode: 'online', bio: '', discoverable: false, links: [] };

describe('input and trust-boundary validation', () => {
  it('rejects identity and authorization fields added to public mutation inputs', () => {
    expect(() => validateCommand('project.create', { ...validProject, ownerId: projectId, isAdmin: true })).toThrow(AppError);
    expect(profileInputSchema.safeParse({ ...profile, status: 'active', email: 'not-real@example.invalid' }).success).toBe(false);
    expect(() => validateCommand('application.submit', { projectId, role: '개발', introduction: '테스트 지원 소개입니다.', status: 'approved' })).toThrow(AppError);
  });
  it('validates team capacity including the owner and rejects fractional or excessive seats', () => {
    expect(projectInputSchema.safeParse(validProject).success).toBe(true);
    for (const capacity of [0, 1, 2.5, 21]) expect(projectInputSchema.safeParse({ ...validProject, capacity }).success).toBe(false);
  });
  it('rejects blank chat messages and invalid idempotency message ids', () => {
    expect(() => validateCommand('message.send', { projectId, body: '  \n ', clientId: projectId })).toThrow(AppError);
    expect(() => validateCommand('message.send', { projectId, body: '가상 메시지', clientId: 'not-a-uuid' })).toThrow(AppError);
    expect(() => validateCommand('message.send', { projectId, body: 'x'.repeat(2001), clientId: projectId })).toThrow(AppError);
  });
  it('permits only web URL schemes for profile links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'intent://app', 'interlink://project/1']) {
      expect(isSafeLink(url)).toBe(false); expect(profileInputSchema.safeParse({ ...profile, links: [url] }).success).toBe(false);
    }
    expect(profileInputSchema.safeParse({ ...profile, links: ['https://example.org/work'] }).success).toBe(true);
  });
  it('requires explicit account-deletion confirmation and bounded search pages', () => {
    expect(() => validateCommand('account.delete', { confirmation: 'delete', ownedTeams: 'archive' })).toThrow(AppError);
    expect(() => validateCommand('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive', userId: projectId })).toThrow(AppError);
    expect(searchSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(searchSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(searchSchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('mode and public configuration boundary', () => {
  it('allows explicitly selected demo without remote credentials', () => {
    expect(() => assertRuntimeConfig({ mode: 'demo', environment: 'development' })).not.toThrow();
    expect(() => assertRuntimeConfig({ mode: 'demo', environment: 'staging' })).not.toThrow();
  });
  it('rejects production demo, unknown modes, and missing actual-service settings', () => {
    for (const input of [
      { mode: 'demo', environment: 'production' }, { mode: 'automatic', environment: 'development' },
      { mode: 'supabase', environment: 'development' }, { mode: 'supabase', environment: 'development', url: 'https://example.invalid' },
    ]) expect(() => assertRuntimeConfig(input)).toThrow(AppError);
  });
  it('rejects insecure remote and production loopback addresses', () => {
    for (const url of ['http://example.invalid', 'file:///tmp/db', 'not a URL']) expect(() => assertRuntimeConfig({ mode: 'supabase', environment: 'development', url, anonKey: 'sb_publishable_test' })).toThrow(AppError);
    expect(() => assertRuntimeConfig({ mode: 'supabase', environment: 'development', url: 'http://127.0.0.1:54321', anonKey: 'local-public-test' })).not.toThrow();
    expect(() => assertRuntimeConfig({ mode: 'supabase', environment: 'production', url: 'https://127.0.0.1', anonKey: 'local-public-test' })).toThrow(AppError);
  });
  it('rejects modern and legacy service-role keys in public configuration', () => {
    const legacy = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.nonsecret-test-signature`;
    for (const anonKey of ['sb_secret_not_a_real_key', legacy]) expect(() => assertRuntimeConfig({ mode: 'supabase', environment: 'staging', url: 'https://example.invalid', anonKey })).toThrow(AppError);
  });
  it('rejects whitespace-obfuscated secret keys and malformed public-key whitespace', () => {
    for (const anonKey of [' sb_secret_fake', '\tsb_secret_fake', 'sb_secret_fake\n', 'sb_publishable_\tfixture', '\nsb_publishable_fixture']) {
      expect(() => assertRuntimeConfig({ mode: 'supabase', environment: 'staging', url: 'https://example.invalid', anonKey })).toThrow(AppError);
    }
  });
});
