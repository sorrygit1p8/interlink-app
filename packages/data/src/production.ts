/** Production bundle entry: intentionally has no runtime dependency on demo.ts. */
import { AppError, assertRuntimeConfig, type AppEnvironment, type DataMode } from '@interlink/shared';
import { createSupabaseClient, type SupabaseOptions, type SupabaseDataClient } from './supabase';
import type { StorageAdapter } from './storage';
import type { DemoClient } from './demo';

export { createSupabaseClient, normalizeError, type SupabaseDataClient, type SupabaseOptions } from './supabase';
export { createSecureStorageAdapter, createMemoryStorage, createBrowserDemoStorage, type StorageAdapter, type SecureStoreDriver } from './storage';
export type { DataClient } from '@interlink/shared';
export { createQueryReconciler } from './query-reconciliation';
export type { DemoClient } from './demo';

export interface DataClientOptions {
  mode: DataMode;
  environment: AppEnvironment;
  url?: string;
  anonKey?: string;
  storage?: StorageAdapter;
  supabase?: SupabaseOptions['supabase'];
  randomUUID?: () => string;
  timeoutMs?: number;
}
export function createDataClient(options: DataClientOptions): SupabaseDataClient {
  if (options.mode !== 'supabase') throw new AppError('CONFIGURATION', '운영 앱에는 데모 기능이 포함되지 않습니다.');
  assertRuntimeConfig({ ...options, environment: 'production' });
  return createSupabaseClient({ ...options, environment: 'production', url: options.url!, anonKey: options.anonKey! });
}
/** A fail-closed compatibility export lets shared UI retain a dead demo branch. */
export function createDemoClient(_options?: { storage?: StorageAdapter; actor?: 'A' | 'B' | 'C' | 'admin' }): DemoClient {
  void _options;
  throw new AppError('CONFIGURATION', '운영 앱에는 데모 기능이 포함되지 않습니다.');
}
