import { assertRuntimeConfig, type AppEnvironment, type DataMode } from '@interlink/shared';
import { createDemoClient, type DemoClient } from './demo';
import { createSupabaseClient, type SupabaseDataClient, type SupabaseOptions } from './supabase';
import type { StorageAdapter } from './storage';

export { createDemoClient, type DemoClient } from './demo';
export { createSupabaseClient, normalizeError, type SupabaseDataClient, type SupabaseOptions } from './supabase';
export { DEMO_ACTORS, DEMO_PROJECTS, DEMO_COMMUNITY_ID, type DemoActor } from './fixtures';
export { createSecureStorageAdapter, createMemoryStorage, createBrowserDemoStorage, type StorageAdapter, type SecureStoreDriver } from './storage';
export type { DataClient } from '@interlink/shared';
export { createQueryReconciler } from './query-reconciliation';

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
/** Explicit mode selection. Missing credentials never switch to demo. */
export function createDataClient(options: DataClientOptions): DemoClient | SupabaseDataClient {
  assertRuntimeConfig(options);
  if (options.mode === 'demo') return createDemoClient({ storage: options.storage });
  return createSupabaseClient({ ...options, url: options.url!, anonKey: options.anonKey! });
}
