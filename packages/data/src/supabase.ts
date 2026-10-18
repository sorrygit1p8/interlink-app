import { createClient, type SupabaseClient, type Session, type AuthChangeEvent, type RealtimeChannel } from '@supabase/supabase-js';
import { AppError, ERROR_MESSAGES, assertRuntimeConfig, validateCommand, searchSchema } from '@interlink/shared';
import type { DataClient, QueryMap, QueryName, CommandMap, CommandName, MutationResult, ErrorCode, AppEnvironment } from '@interlink/shared';
import type { StorageAdapter } from './storage';

type Event = { scope: string; projectId?: string };
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export interface SupabaseDataClient extends DataClient {
  readonly mode: 'supabase';
  readonly connectionState: ConnectionState;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<Session>;
  getSession(): Promise<Session | null>;
  refreshSession(): Promise<Session | null>;
  signOut(deviceToken?: string): Promise<void>;
  onAuthStateChange(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void;
  setForeground(active: boolean): void;
  reconnect(): Promise<void>;
  uploadAvatar(bytes: ArrayBuffer, contentType: 'image/jpeg' | 'image/png' | 'image/webp', options?: { signal?: AbortSignal }): Promise<{ path: string; mimeType: string; width: number; height: number }>;
  getAvatarUrl(path: string): Promise<string>;
}

export interface SupabaseOptions {
  url: string;
  anonKey: string;
  environment?: AppEnvironment;
  storage?: StorageAdapter;
  /** Use an already-authenticated SSR cookie client; no service role allowed. */
  supabase?: SupabaseClient;
  timeoutMs?: number;
  randomUUID?: () => string;
  /** Injection is for isolated contract tests. The default is the standard fetch. */
  fetch?: typeof fetch;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const candidate = error && typeof error === 'object' ? error as { code?: string; message?: string; status?: number; name?: string } : {};
  // Accept only enumerated domain codes, never leak SQL, message text, emails, or stacks.
  const domain = candidate.code && Object.hasOwn(ERROR_MESSAGES, candidate.code) ? candidate.code : candidate.message && Object.hasOwn(ERROR_MESSAGES, candidate.message) ? candidate.message : undefined;
  if (domain) return new AppError(domain as ErrorCode);
  if (candidate.status === 401 || candidate.code === 'PGRST301' || candidate.code === 'session_not_found' || candidate.code === 'otp_expired') return new AppError('UNAUTHENTICATED');
  if (candidate.status === 403 || candidate.code === '42501') return new AppError('FORBIDDEN');
  if (candidate.status === 429 || candidate.code === 'over_email_send_rate_limit' || candidate.code === 'over_request_rate_limit') return new AppError('RATE_LIMITED');
  if (candidate.code === '23505') return new AppError('DUPLICATE');
  if (candidate.status === 404) return new AppError('NOT_FOUND');
  if (candidate.status === 400 || candidate.status === 422) return new AppError('VALIDATION');
  if (candidate.name === 'TypeError' || candidate.name === 'AbortError' || candidate.code === 'ECONNRESET' || candidate.status === 0 || candidate.message?.startsWith('TypeError:')) return new AppError('NETWORK');
  return new AppError('UNAVAILABLE');
}

function secureId(generator?: () => string): string {
  if (generator) return generator();
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const data = globalThis.crypto.getRandomValues(new Uint8Array(16));
    data[6] = (data[6]! & 15) | 64; data[8] = (data[8]! & 63) | 128;
    const hex = Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new AppError('CONFIGURATION', '안전한 요청 ID 생성기를 설정해 주세요.');
}

function cancellationError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Cancelled', 'AbortError');
  const error = new Error('Cancelled'); error.name = 'AbortError'; return error;
}
function isCancellation(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'); }

function sessionStorage(url: string, environment: AppEnvironment, storage?: StorageAdapter) {
  // Include the complete canonical endpoint (including a custom base path), not
  // only the host. Hex is collision-free and uses SecureStore-safe characters.
  const endpoint = new URL(url).href.replace(/\/+$/, '');
  const encoded = Array.from(endpoint, character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const storageKey = `interlink.supabase.${environment}.session.v2.${encoded}`;
  if (!storage) return { storageKey, storage: undefined };
  let cleanup: Promise<void> | undefined;
  const clearLegacy = () => cleanup ??= (async () => {
    // The old key did not identify its backend: never adopt its credentials in
    // any new scope. Remove its session and SDK auxiliary keys before reading.
    for (const suffix of ['', '-code-verifier', '-user']) await storage.removeItem(`interlink.supabase.session.v1${suffix}`);
  })();
  return { storageKey, storage: {
    async getItem(key: string) { await clearLegacy(); return storage.getItem(key); },
    async setItem(key: string, value: string) { await clearLegacy(); await storage.setItem(key, value); },
    async removeItem(key: string) { await clearLegacy(); await storage.removeItem(key); },
  } satisfies StorageAdapter };
}

export function createSupabaseClient(options: SupabaseOptions): SupabaseDataClient {
  assertRuntimeConfig({ mode: 'supabase', environment: options.environment ?? 'development', url: options.url, anonKey: options.anonKey });
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 12000, 60000));
  const transport = options.fetch ?? globalThis.fetch;
  let disposed = false;
  let connectionState: ConnectionState = 'idle';
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let realtimeGeneration = 0;
  let foreground = true;
  let otpPending = false;
  let lastOtpAt = 0;
  let authenticatedUserId: string | null = null;
  let authGeneration = 0;
  const listeners = new Set<(event: Event) => void>();
  const controllers = new Set<AbortController>();
  let authSignal: AbortSignal | undefined;
  let authTail: Promise<void> = Promise.resolve();
  const pendingMutations = new Map<string, { key: string; inFlight?: Promise<MutationResult> }>();
  let authUnsubscribe: (() => void) | undefined;
  const emit = (event: Event) => { for (const listener of listeners) { try { listener(event); } catch { /* Consumer errors must not break transport lifecycle. */ } } };
  const sdk = options.supabase ?? createClient(options.url, options.anonKey, {
    auth: { ...sessionStorage(options.url, options.environment ?? 'development', options.storage), persistSession: Boolean(options.storage), autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    global: { fetch: sdkFetch },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  /** Abort the actual SDK fetch, including GoTrue operations without a signal API.
   * A transport that ignores AbortSignal still cannot return a late successful
   * response to GoTrue because bounded() rejects the fetch promise itself.
   */
  async function sdkFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const incomingSignal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const signals = [incomingSignal, url.includes('/auth/v1/') ? authSignal : undefined].filter((value): value is AbortSignal => Boolean(value));
    const combined = new AbortController();
    const cancel = () => combined.abort();
    for (const signal of signals) { if (signal.aborted) combined.abort(); else signal.addEventListener('abort', cancel, { once: true }); }
    try { return await bounded((signal) => transport(input, { ...init, signal }), combined.signal); }
    finally { for (const signal of signals) signal.removeEventListener('abort', cancel); }
  }

  async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>, externalSignal?: AbortSignal): Promise<T> {
    if (disposed) throw new AppError('UNAVAILABLE');
    if (externalSignal?.aborted) throw cancellationError();
    const controller = new AbortController(); controllers.add(controller);
    const cancel = () => controller.abort(); externalSignal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(work(controller.signal)),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(externalSignal?.aborted ? cancellationError() : new AppError('NETWORK', '응답 시간이 길어졌어요. 다시 시도해 주세요.')), { once: true });
          timer = setTimeout(() => controller.abort(), timeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); externalSignal?.removeEventListener('abort', cancel); controllers.delete(controller); }
  }

  function authOperation<T>(work: () => PromiseLike<T>): Promise<T> {
    const previous = authTail;
    let release!: () => void;
    authTail = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(() => {
      let started = false;
      return bounded((signal) => {
        started = true; authSignal = signal;
        // Keep the auth queue and its abort signal until the SDK itself settles,
        // even when the caller has already received a timeout.
        return Promise.resolve().then(work).finally(() => { if (authSignal === signal) authSignal = undefined; release(); });
      }).finally(() => { if (!started) release(); });
    });
  }

  async function rpc<T>(rpcName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const generation = authGeneration;
    const assertSameAccount = () => { if (generation !== authGeneration) throw new AppError('UNAUTHENTICATED'); };
    let lastError: unknown;
    // One retry. Command calls always reuse the same idempotency key and body.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        assertSameAccount();
        const response = await bounded((operationSignal) => sdk.rpc(rpcName, args).abortSignal(operationSignal), signal);
        assertSameAccount();
        if (response.error) throw response.error;
        if (response.data === null || response.data === undefined) throw new AppError('UNAVAILABLE');
        return response.data as T;
      } catch (error) {
        assertSameAccount();
        if (signal?.aborted || isCancellation(error)) throw error;
        lastError = normalizeError(error);
        if (!(lastError as AppError).retryable || attempt === 1 || disposed) throw lastError;
        await new Promise<void>((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async function session(): Promise<Session | null> {
    try { const response = await authOperation(() => sdk.auth.getSession()); if (response.error) throw response.error; return response.data.session; }
    catch (error) { throw normalizeError(error); }
  }
  const stopRealtime = () => {
    realtimeGeneration += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = undefined;
    const old = channel; channel = null;
    if (old) void sdk.removeChannel(old).catch(() => undefined);
    connectionState = 'idle';
  };
  function realtimeFailure(): void {
    connectionState = 'offline'; emit({ scope: 'connection' });
    if (reconnectAttempt < 5 && foreground && listeners.size > 0 && !reconnectTimer && !disposed) {
      const delay = Math.min(30000, 1000 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        // startRealtime schedules a further bounded retry when session recovery
        // fails before a channel even exists, as well as for socket failures.
        void startRealtime().catch(() => undefined);
      }, delay);
    }
  }
  async function startRealtime(): Promise<void> {
    stopRealtime();
    if (disposed || !foreground || listeners.size === 0) return;
    const generation = realtimeGeneration;
    try {
      connectionState = reconnectAttempt ? 'reconnecting' : 'connecting'; emit({ scope: 'connection' });
      const current = await session();
      if (!current || disposed || generation !== realtimeGeneration) { if (!current && generation === realtimeGeneration) connectionState = 'idle'; return; }
    // change_events contains only invalidation metadata. RLS checks account status
    // and user_id on every delivery; message bodies never cross this channel.
    channel = sdk.channel(`interlink:${current.user.id}:${generation}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'change_events', filter: `user_id=eq.${current.user.id}` }, (payload) => {
        const row = payload.new as { scope?: unknown; project_id?: unknown };
        if (typeof row.scope === 'string') emit({ scope: row.scope, ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}) });
      }).subscribe((status) => {
        if (disposed || generation !== realtimeGeneration) return;
        if (status === 'SUBSCRIBED') { connectionState = 'connected'; reconnectAttempt = 0; emit({ scope: '*' }); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') realtimeFailure();
      });
    } catch (error) {
      if (!disposed && generation === realtimeGeneration) realtimeFailure();
      throw error;
    }
  }
  function ensureAuthListener() {
    if (authUnsubscribe) return;
    const result = sdk.auth.onAuthStateChange((event, authSession) => {
      const nextUserId = authSession?.user.id ?? null;
      if (nextUserId !== authenticatedUserId) { authGeneration += 1; pendingMutations.clear(); }
      authenticatedUserId = nextUserId;
      // Never await another SDK auth method inside its own auth lock callback.
      setTimeout(() => {
        if (disposed) return;
        if (event === 'SIGNED_OUT') { stopRealtime(); pendingMutations.clear(); }
        else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') void startRealtime().catch(() => { connectionState = 'offline'; });
        emit({ scope: 'session' });
      }, 0);
    });
    authUnsubscribe = () => result.data.subscription.unsubscribe();
  }

  const client: SupabaseDataClient = {
    mode: 'supabase',
    get connectionState() { return connectionState; },
    query<K extends QueryName>(name: K, input: QueryMap[K]['input'], operationOptions?: { signal?: AbortSignal }) {
      if (name === 'projects.search' || name === 'people.search') {
        const parsed = searchSchema.safeParse(input);
        if (!parsed.success) return Promise.reject(new AppError('VALIDATION'));
      }
      return rpc<QueryMap[K]['output']>('interlink_query', { operation: name, payload: input }, operationOptions?.signal);
    },
    async command<K extends CommandName>(name: K, input: CommandMap[K]['input'], idempotencyKey?: string) {
      const generation = authGeneration;
      const payload = validateCommand(name, input);
      const fingerprint = JSON.stringify({ name, payload });
      const prior = !idempotencyKey ? pendingMutations.get(fingerprint) : undefined;
      if (prior?.inFlight) return prior.inFlight;
      const key = idempotencyKey ?? prior?.key ?? secureId(options.randomUUID);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return Promise.reject(new AppError('VALIDATION', '요청 키가 올바르지 않아요.'));
      const mutation = rpc<MutationResult>('interlink_command', { operation: name, payload, idempotency_key: key }).then((result) => {
        if (!idempotencyKey && generation === authGeneration) pendingMutations.delete(fingerprint);
        emit({ scope: name }); return result;
      }).catch((error: unknown) => {
        // Keep the key for an explicit user retry after an ambiguous network
        // result. A confirmed domain rejection can start a new intent instead.
        if (!idempotencyKey && generation === authGeneration) {
          if (error instanceof AppError && error.retryable) pendingMutations.set(fingerprint, { key });
          else pendingMutations.delete(fingerprint);
        }
        throw error;
      });
      if (!idempotencyKey) pendingMutations.set(fingerprint, { key, inFlight: mutation });
      return mutation;
    },
    subscribe(listener) {
      listeners.add(listener); ensureAuthListener();
      if (listeners.size === 1) void startRealtime().catch(() => { connectionState = 'offline'; emit({ scope: 'connection' }); });
      return () => { listeners.delete(listener); if (listeners.size === 0) stopRealtime(); };
    },
    dispose() { disposed = true; stopRealtime(); authUnsubscribe?.(); listeners.clear(); pendingMutations.clear(); for (const controller of controllers) controller.abort(); controllers.clear(); if (!options.supabase) sdk.auth.stopAutoRefresh(); },
    async requestOtp(email) {
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new AppError('VALIDATION', '이메일 형식을 확인해 주세요.');
      if (otpPending || Date.now() - lastOtpAt < 60000) throw new AppError('RATE_LIMITED');
      otpPending = true;
      try { const result = await authOperation(() => sdk.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true } })); if (result.error) throw result.error; lastOtpAt = Date.now(); }
      catch (error) { throw normalizeError(error); }
      finally { otpPending = false; }
    },
    async verifyOtp(email, token) {
      // Supabase OTP length is configurable (6–10 digits); server remains authoritative.
      if (!/^\d{6,10}$/.test(token.trim())) throw new AppError('VALIDATION', '메일에 안내된 인증코드를 입력해 주세요.');
      try { const result = await authOperation(() => sdk.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' })); if (result.error) throw result.error; if (!result.data.session) throw new AppError('UNAUTHENTICATED'); emit({ scope: 'session' }); return result.data.session; }
      catch (error) { throw normalizeError(error); }
    },
    getSession: session,
    async refreshSession() {
      try { const result = await authOperation(() => sdk.auth.refreshSession()); if (result.error) throw result.error; return result.data.session; }
      catch (error) { throw normalizeError(error); }
    },
    async signOut(deviceToken) {
      // Unregister before destroying authentication. Failure stays visible so a
      // device cannot silently retain delivery permission after a claimed logout.
      if (deviceToken) await client.command('device.unregister', { token: deviceToken });
      try { const result = await authOperation(() => sdk.auth.signOut({ scope: 'local' })); if (result.error) throw result.error; stopRealtime(); pendingMutations.clear(); emit({ scope: 'session' }); }
      catch (error) { throw normalizeError(error); }
    },
    onAuthStateChange(listener) { ensureAuthListener(); const result = sdk.auth.onAuthStateChange(listener); return () => result.data.subscription.unsubscribe(); },
    setForeground(active) {
      foreground = active;
      if (active) { sdk.auth.startAutoRefresh(); reconnectAttempt = 0; void startRealtime().catch(() => { connectionState = 'offline'; }); emit({ scope: '*' }); }
      else { sdk.auth.stopAutoRefresh(); stopRealtime(); }
    },
    async reconnect() { reconnectAttempt = 0; await startRealtime(); emit({ scope: '*' }); },
    async uploadAvatar(bytes, contentType, uploadOptions) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) throw new AppError('VALIDATION', '5MB 이하의 JPG, PNG, WebP 이미지를 선택해 주세요.');
      const current = await session(); if (!current) throw new AppError('UNAUTHENTICATED');
      try {
        const response = await bounded((signal) => transport(`${options.url.replace(/\/$/, '')}/functions/v1/image-upload`, { method: 'POST', headers: { Authorization: `Bearer ${current.access_token}`, apikey: options.anonKey, 'Content-Type': contentType }, body: bytes, signal }), uploadOptions?.signal);
        if (!response.ok) throw { status: response.status };
        const result = await response.json() as { path: string; mimeType: string; width: number; height: number };
        if (typeof result.path !== 'string' || !result.path.startsWith(`${current.user.id}/`) || !Number.isInteger(result.width) || !Number.isInteger(result.height)) throw new AppError('UNAVAILABLE');
        return result;
      } catch (error) { if (uploadOptions?.signal?.aborted) throw error; throw normalizeError(error); }
    },
    async getAvatarUrl(path) {
      if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/i.test(path)) throw new AppError('VALIDATION');
      try { const result = await bounded(() => sdk.storage.from('avatars').createSignedUrl(path, 60)); if (result.error) throw result.error; if (!result.data.signedUrl) throw new AppError('UNAVAILABLE'); return result.data.signedUrl; }
      catch (error) { throw normalizeError(error); }
    },
  };
  // Own SDK clients observe identity even without a realtime subscriber. An
  // injected request-scoped SDK may instead use the accessToken option, which
  // deliberately disables its Auth API; its caller owns that identity boundary.
  if (!options.supabase) ensureAuthListener();
  return client;
}
