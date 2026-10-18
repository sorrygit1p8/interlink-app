import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/dist-*/**', '**/.expo/**', '**/android/**', '**/ios/**', '**/next-env.d.ts', '**/expo-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended.map(config => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { __dirname: 'readonly', process: 'readonly' } } },
  { files: ['**/*.{ts,tsx,js,mjs}'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly', Headers: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', crypto: 'readonly', atob: 'readonly', document: 'readonly', window: 'readonly', navigator: 'readonly', localStorage: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly' } } }
);
