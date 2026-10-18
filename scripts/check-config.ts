import { pathToFileURL } from 'node:url';
import { assertRuntimeConfig, AppError } from '@interlink/shared';
import { policies, type PolicyKey } from '../apps/web/content/policies';

export type ConfigurationTarget = 'client' | 'edge' | 'backend';
type PolicyDocument = { title: string; eyebrow: string; summary: string; sections: readonly (readonly [string, string])[] };
export type PolicyDocuments = Partial<Record<PolicyKey, PolicyDocument>>;
export interface ConfigurationResult { ok: boolean; target: ConfigurationTarget; mode: string; environment: string; errors: string[]; warnings: string[] }
const unresolved = /TODO|TBD|미정|미확정|example\.|placeholder|changeme/i;
const requiredPolicySections: Record<PolicyKey, string[]> = {
  terms: ['서비스와 운영 주체', '가입과 참여', '탈퇴와 책임'],
  privacy: ['개인정보 처리자', '위탁과 국외 이전', '보유와 삭제', '이용자의 권리'],
  community: ['문제가 생겼다면', '운영자의 약속'],
  support: ['운영 문의'],
};

function checkPolicyDocuments(documents: PolicyDocuments, errors: string[]) {
  for (const key of Object.keys(requiredPolicySections) as PolicyKey[]) {
    const document = documents[key];
    if (!document || !document.title.trim() || !document.summary.trim() || !document.sections.length) {
      errors.push(`Missing production policy document: apps/web/content/policies.ts (${key})`);
      continue;
    }
    const headings = new Set(document.sections.map(([heading]) => heading));
    for (const heading of requiredPolicySections[key]) {
      if (!headings.has(heading)) errors.push(`Missing production policy section: ${key} / ${heading}`);
    }
    if ([document.title, document.eyebrow, document.summary].some((value) => unresolved.test(value))) {
      errors.push(`Resolve production policy draft: apps/web/content/policies.ts (${key})`);
    }
    for (const [heading, body] of document.sections) {
      if (!heading.trim() || !body.trim() || unresolved.test(heading) || unresolved.test(body)) {
        errors.push(`Resolve production policy draft: apps/web/content/policies.ts (${key} / ${heading})`);
      }
    }
  }
}

function localHost(hostname: string) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' ||
    hostname === '[::]' || hostname === '0.0.0.0' || /^127\./.test(hostname) ||
    ['kong', 'host.docker.internal'].includes(hostname);
}

function strictOrigin(value: string, production: boolean) {
  try {
    const url = new URL(value);
    return !value.includes('*') && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === '/' || url.pathname === '') && value.replace(/\/$/, '') === url.origin &&
      (url.protocol === 'https:' || !production && url.protocol === 'http:' && localHost(url.hostname)) &&
      !(production && localHost(url.hostname));
  } catch { return false; }
}

function checkEdgeConfiguration(env: Record<string, string | undefined>, environment: string, errors: string[]) {
  let validBackend = !!env.SUPABASE_URL && strictOrigin(env.SUPABASE_URL, environment === 'production');
  if (validBackend) {
    const url = new URL(env.SUPABASE_URL!);
    // Match the local HTTP hosts supported by the actual Edge backendUrl().
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', 'kong', 'host.docker.internal'].includes(url.hostname)) validBackend = false;
  }
  if (!validBackend) errors.push('Set a valid backend origin: SUPABASE_URL');
  const publicKey = env.SUPABASE_ANON_KEY ?? '';
  let validPublicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey);
  if (!validPublicKey && publicKey.split('.').length === 3 && !/\s/.test(publicKey)) {
    try { validPublicKey = JSON.parse(Buffer.from(publicKey.split('.')[1]!, 'base64url').toString('utf8')).role === 'anon'; }
    catch { /* Only a public publishable/anon key is supported. */ }
  }
  if (!validPublicKey) errors.push('Set the public key used to authenticate image uploads: SUPABASE_ANON_KEY');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  let validServiceKey = /^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey);
  if (!validServiceKey && serviceKey.split('.').length === 3 && !/\s/.test(serviceKey)) {
    try { validServiceKey = JSON.parse(Buffer.from(serviceKey.split('.')[1]!, 'base64url').toString('utf8')).role === 'service_role'; }
    catch { /* Invalid key shape; never include the supplied value in diagnostics. */ }
  }
  if (!validServiceKey || unresolved.test(serviceKey)) errors.push('Set a server-only service key: SUPABASE_SERVICE_ROLE_KEY');
  const workerSecret = env.INTERLINK_WORKER_SECRET ?? '';
  if (workerSecret.length < 32 || workerSecret.length > 512 || /\s/.test(workerSecret) || unresolved.test(workerSecret) || workerSecret === serviceKey) errors.push('Set an independent 32–512 character server secret: INTERLINK_WORKER_SECRET');
  const origins = (env.EDGE_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim());
  if (!origins.length || origins.some((value) => !strictOrigin(value, environment === 'production') || value.endsWith('/'))) {
    errors.push('Set exact allowed browser origins without paths, wildcards or trailing slashes: EDGE_ALLOWED_ORIGINS');
  }
}

export function checkConfiguration(env: Record<string, string | undefined>, options: { target?: ConfigurationTarget; policyDocuments?: PolicyDocuments } = {}): ConfigurationResult {
  const target = options.target ?? 'client';
  const server = target === 'edge' || target === 'backend';
  const mode = server ? env.INTERLINK_DATA_MODE ?? env.EXPO_PUBLIC_DATA_MODE ?? 'demo' : env.EXPO_PUBLIC_DATA_MODE ?? env.INTERLINK_DATA_MODE ?? 'demo';
  const environment = server ? env.INTERLINK_APP_ENV ?? env.EXPO_PUBLIC_APP_ENV ?? 'development' : env.EXPO_PUBLIC_APP_ENV ?? env.INTERLINK_APP_ENV ?? 'development';
  const errors: string[] = [];
  const warnings: string[] = [];
  const url = server ? env.SUPABASE_URL : env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const anonKey = server ? env.SUPABASE_ANON_KEY : env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY;
  if (server) {
    if (!['development', 'staging', 'production'].includes(environment)) errors.push('Select a valid deployment environment.');
    if (mode !== 'supabase') errors.push('Edge deployment requires supabase mode; demo does not deploy server handlers.');
    else checkEdgeConfiguration(env, environment, errors);
  } else {
    try { assertRuntimeConfig({ mode, environment, url, anonKey }); }
    catch (error) { errors.push(error instanceof AppError ? error.message : 'Configuration validation failed.'); }
    // A separately configured operations web must not be masked by mobile
    // development/demo settings in the same environment file.
    if (env.INTERLINK_DATA_MODE !== undefined || env.INTERLINK_APP_ENV !== undefined) {
      try { assertRuntimeConfig({ mode: env.INTERLINK_DATA_MODE ?? 'demo', environment: env.INTERLINK_APP_ENV ?? 'development', url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }); }
      catch (error) { errors.push(`Web configuration: ${error instanceof AppError ? error.message : 'validation failed.'}`); }
    }
  }
  for (const key of Object.keys(env)) {
    if ((key.startsWith('EXPO_PUBLIC_') || key.startsWith('NEXT_PUBLIC_')) && /SERVICE_ROLE|PRIVATE_KEY|SECRET|PASSWORD/.test(key) && env[key]) errors.push(`Server-only value declared publicly: ${key}`);
  }
  if (environment === 'production' || !server && env.INTERLINK_APP_ENV === 'production') {
    for (const key of server ? [] : ['INTERLINK_ANDROID_PACKAGE', 'INTERLINK_IOS_BUNDLE_ID']) {
      const value = env[key] ?? '';
      if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){2,}$/.test(value) || /example|placeholder|demo|changeme/i.test(value)) errors.push(`Set an owned production identifier: ${key}`);
    }
    for (const key of ['INTERLINK_OPERATOR_NAME', 'INTERLINK_SUPPORT_EMAIL', 'INTERLINK_PRIVACY_URL', 'INTERLINK_TERMS_URL', 'INTERLINK_RETENTION_POLICY']) {
      const value = env[key] ?? '';
      if (!value.trim() || unresolved.test(value)) errors.push(`Resolve production operating policy: ${key}`);
    }
    for (const key of ['INTERLINK_PRIVACY_URL', 'INTERLINK_TERMS_URL']) {
      try { const value = new URL(env[key] ?? ''); if (value.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(value.hostname)) errors.push(`Use a public HTTPS policy URL: ${key}`); }
      catch { errors.push(`Invalid policy URL: ${key}`); }
    }
    if (env.INTERLINK_LAUNCH_REVIEW_APPROVED !== 'true') errors.push('Production release requires a separate operating/security/policy review: INTERLINK_LAUNCH_REVIEW_APPROVED');
    // Inspect the exact editable content rendered by the policy pages. Environment
    // declarations cannot make unfinished operator/contact/retention/transfer/age
    // and consent drafts complete. Injection is for isolated tests, never CLI/env.
    checkPolicyDocuments(options.policyDocuments ?? policies, errors);
  }
  if (mode === 'demo') warnings.push('Fictional local demo only: no remote account, email, push or deletion is performed.');
  if (mode === 'supabase') warnings.push('Configuration presence is not proof of database migration, remote connectivity, permission correctness or operational readiness.');
  return { ok: errors.length === 0, target, mode, environment, errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env };
  const args = process.argv.slice(2);
  let target: ConfigurationTarget = 'client';
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i]!;
    const separator = argument.indexOf('=');
    const name = separator < 0 ? argument : argument.slice(0, separator);
    const value = separator < 0 ? args[++i] : argument.slice(separator + 1);
    if (!value || value.startsWith('--') || !['--mode', '--environment', '--target'].includes(name!)) throw new Error('Usage: check:config [--target client|edge|backend] [--mode demo|supabase] [--environment development|staging|production]');
    if (name === '--mode') env.EXPO_PUBLIC_DATA_MODE = env.INTERLINK_DATA_MODE = value;
    else if (name === '--environment') env.EXPO_PUBLIC_APP_ENV = env.INTERLINK_APP_ENV = value;
    else if (['client', 'edge', 'backend'].includes(value)) target = value as ConfigurationTarget;
    else throw new Error('Configuration target must be client, edge or backend.');
  }
  const result = checkConfiguration(env, { target });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
