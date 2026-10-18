import { describe, expect, it } from 'vitest';
import { createDataClient, createDemoClient } from '../../packages/data/src/production';

describe('production-only data entry', () => {
  it('cannot create a fictional actor through either factory', () => {
    expect(() => createDemoClient({ actor: 'admin' })).toThrow();
    expect(() => createDataClient({ mode: 'demo', environment: 'development' })).toThrow();
  });
  it('enforces production validation even when a caller labels the environment development', () => {
    expect(() => createDataClient({ mode: 'supabase', environment: 'development', url: 'http://127.0.0.1:54321', anonKey: 'sb_publishable_fixture' })).toThrow();
    expect(() => createDataClient({ mode: 'supabase', environment: 'development' })).toThrow();
  });
});
