#!/usr/bin/env node
// Local static export only: synthetic settings cannot connect to a real backend.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some((argument) => argument !== '--scan-only') || args.length > 1) {
  throw new Error('Usage: npm run check:production [-- --scan-only]');
}
const env = {
  ...process.env,
  CI: '1', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1',
  EXPO_PUBLIC_DATA_MODE: 'supabase', EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_SUPABASE_URL: 'https://static-bundle-check.invalid',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_static_bundle_check_not_a_real_key',
  INTERLINK_ANDROID_PACKAGE: 'invalid.interlink.staticcheck',
  INTERLINK_IOS_BUNDLE_ID: 'invalid.interlink.staticcheck',
  PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
};
const candidates = process.env.INTERLINK_PYTHON
  ? [[process.env.INTERLINK_PYTHON]]
  : process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
const python = candidates.find(([executable, ...prefix]) => spawnSync(executable, [
  ...prefix, '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)',
], { env, cwd: root, stdio: 'ignore', timeout: 5000, windowsHide: true }).status === 0);
if (!python) throw new Error('Python 3.10+ is required. Set INTERLINK_PYTHON to its executable path.');

function run(executable, arguments_, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code, signal) => signal ? reject(new Error(`Check interrupted: ${signal}`)) : resolve(code ?? 1));
  });
}

let exitCode = 0;
if (!args.includes('--scan-only')) {
  const expo = path.join(root, 'node_modules/expo/bin/cli');
  if (!existsSync(expo)) throw new Error('Local Expo CLI is missing. Run npm ci first.');
  exitCode = await run(process.execPath, [expo, 'export', '--platform', 'all', '--no-bytecode',
    '--source-maps', 'external', '--max-workers', '1', '--output-dir', path.join(root, 'artifacts/prod-check')], path.join(root, 'apps/mobile'));
}
if (exitCode === 0) {
  const [executable, ...prefix] = python;
  exitCode = await run(executable, [...prefix, path.join(root, 'scripts/check-production-bundle.py')], root);
}
process.exitCode = exitCode;
