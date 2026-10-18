/** Only stable codes leave an edge handler. Never log tokens or response bodies. */
export class EdgeError extends Error {
  constructor(public code: string, public status = 500) {
    super(code);
  }
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new EdgeError("CONFIGURATION", 503);
  return value;
}

export function backendUrl(): string {
  const url = new URL(requiredEnv("SUPABASE_URL"));
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "kong", "host.docker.internal"].includes(
        url.hostname,
      ))
  ) {
    throw new EdgeError("CONFIGURATION", 503);
  }
  return url.origin;
}

export async function fetchTimed(
  url: string,
  init: RequestInit = {},
  timeout = 12_000,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new EdgeError("UPSTREAM_UNAVAILABLE", 503);
  }
}

export class Backend {
  readonly url: string;
  readonly serviceKey: string;
  constructor() {
    this.url = backendUrl();
    this.serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  }
  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      ...extra,
    };
  }
  async request(
    path: string,
    init: RequestInit = {},
    accepted: number[] = [],
  ): Promise<Response> {
    const response = await fetchTimed(`${this.url}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
    if (!response.ok && !accepted.includes(response.status)) {
      // SQL exposes stable domain messages only. Never return raw provider/SQL text.
      const statuses: Record<string, number> = {
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        VALIDATION: 422,
        NOT_FOUND: 404,
        RATE_LIMITED: 429,
        CONFLICT: 409,
      };
      let code: unknown;
      try {
        code = (await response.json()).message;
      } catch { /* upstream may return a non-JSON error */ }
      if (typeof code === "string" && statuses[code]) {
        throw new EdgeError(code, statuses[code]);
      }
      throw new EdgeError(`BACKEND_${response.status}`, 503);
    }
    return response;
  }
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return await response.json() as T;
  }
  async user(request: Request): Promise<{ id: string }> {
    const authorization = request.headers.get("authorization");
    if (
      !authorization?.startsWith("Bearer ") || authorization.length > 16_384
    ) throw new EdgeError("UNAUTHENTICATED", 401);
    const response = await fetchTimed(`${this.url}/auth/v1/user`, {
      headers: {
        apikey: requiredEnv("SUPABASE_ANON_KEY"),
        Authorization: authorization,
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new EdgeError("UNAUTHENTICATED", 401);
    }
    if (!response.ok) throw new EdgeError("UNAVAILABLE", 503);
    const user = await response.json();
    if (!isUuid(user.id)) throw new EdgeError("UNAUTHENTICATED", 401);
    return { id: user.id };
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

/** Fixed length digest comparison also prevents secret-length timing leaks. */
export async function constantTimeEqual(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  let difference = 0;
  const x = new Uint8Array(left), y = new Uint8Array(right);
  for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}

export async function authorizeWorker(request: Request): Promise<void> {
  const expected = requiredEnv("INTERLINK_WORKER_SECRET");
  if (expected.length < 32) throw new EdgeError("CONFIGURATION", 503);
  const supplied = request.headers.get("x-interlink-worker-secret") ?? "";
  if (supplied.length > 512 || !(await constantTimeEqual(expected, supplied))) {
    throw new EdgeError("FORBIDDEN", 403);
  }
}

export function json(
  value: unknown,
  status = 200,
  extra: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...Object.fromEntries(new Headers(extra)),
    },
  });
}

export function failure(error: unknown, headers: HeadersInit = {}): Response {
  return error instanceof EdgeError
    ? json({ error: { code: error.code } }, error.status, headers)
    : json({ error: { code: "UNAVAILABLE" } }, 503, headers);
}

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const allowed = (Deno.env.get("EDGE_ALLOWED_ORIGINS") ?? "").split(",").map((
    s,
  ) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) throw new EdgeError("FORBIDDEN", 403);
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
  };
}
