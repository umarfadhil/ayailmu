// Test-only, in-memory model of the Auth server's password recovery protocol as the maintained @supabase/auth-js SDK
// drives it with PKCE, for disposable .test users seeded here (it neither wraps nor reads fakeAccountApi.ts):
// - POST /recover answers {} for every address; for a known user and an allow-listed redirect_to it records the S256
//   challenge under a one-use code and puts the link (that exact callback with ?code=<uuid>) in the mailbox;
// - POST /token?grant_type=pkce issues a session once per code, only for the verifier whose S256 hash is its challenge;
// - GET and PUT /user serve only a live session's own bearer, and PUT changes only that user's password;
// - POST /logout?scope=local ends only the bearer's own session; any other scope is refused;
// - POST /token?grant_type=password accepts only the current password; refresh_token rotates a live session.
// Anything else, or another origin, fails locally. Calls are noted as method, path, grant and scope only. Sessions are
// SDK-shaped, with a JWT-shaped access string that nothing signs or checks. Nothing is sent or delivered anywhere.
import { createHash, randomBytes, randomUUID } from 'crypto';

/** The fake Auth server's root, the local Auth address the app's configuration uses. */
export const FAKE_RECOVERY_AUTH = 'http://127.0.0.1:54321';

/** A recovery link the server would have mailed: never delivered. */
export interface RecoveryMail {
  to: string;
  callback: string;
}
/** One request the server got, without any body, header or token. */
export interface RecoveryCall {
  method: string;
  path: string;
  grant: string | null;
  scope: string | null;
}

interface User {
  id: string;
  email: string;
  password: string;
  createdAt: string;
}
interface Code {
  userId: string;
  challenge: string;
  expiresAt: number;
  used: boolean;
}
interface Held {
  userId: string;
  refreshToken: string;
  live: boolean;
}

const SYNTHETIC = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function header(init: RequestInit | undefined, name: string): string | null {
  const headers: unknown = init?.headers;
  if (typeof headers !== 'object' || headers === null) return null;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  const entries = (Array.isArray(headers) ? headers : Object.entries(headers as Record<string, string>)) as [string, string][];
  return entries.find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(String(init?.body));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `callbacks`: the redirect allow-list. `now`: the clock codes expire by (sessions expire by Date.now, the SDK's own
 * clock). `codeTtlMs`: how long a code counts, 60 minutes by default.
 */
export function fakeRecoveryApi(options: { callbacks: string[]; now?: () => number; codeTtlMs?: number }) {
  const now = options.now ?? Date.now;
  const codeTtl = options.codeTtlMs ?? 60 * 60_000;
  const users = new Map<string, User>();
  const codes = new Map<string, Code>();
  const sessions = new Map<string, Held>();
  const mailbox: RecoveryMail[] = [];
  const calls: RecoveryCall[] = [];
  const secrets = new Set<string>();

  const reply = (status: number, body: unknown, url: string): Response => {
    const text = body === null ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      url,
      redirected: false,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
    } as unknown as Response;
  };
  const refusal = (status: number, errorCode: string, msg: string, url: string) => reply(status, { code: status, error_code: errorCode, msg }, url);

  const byId = (id: string) => [...users.values()].find((user) => user.id === id) ?? null;
  const userJson = (user: User) => {
    const at = new Date(now()).toISOString();
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: user.createdAt,
      phone: '',
      confirmed_at: user.createdAt,
      last_sign_in_at: at,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: user.createdAt,
      updated_at: at,
      is_anonymous: false,
    };
  };

  /** A new live session for `user`. */
  const issue = (user: User) => {
    const iat = Math.floor(Date.now() / 1000);
    const claims = { sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', iat, exp: iat + 3600, session_id: randomUUID() };
    const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.${randomBytes(16).toString('base64url')}`;
    const refreshToken = randomBytes(12).toString('base64url');
    sessions.set(accessToken, { userId: user.id, refreshToken, live: true });
    secrets.add(accessToken).add(refreshToken);
    return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: iat + 3600, refresh_token: refreshToken, user: userJson(user) };
  };

  /** The live session and user the request's bearer names, or null. */
  const owner = (init: RequestInit | undefined) => {
    const value = header(init, 'authorization') ?? '';
    const held = value.startsWith('Bearer ') ? sessions.get(value.slice('Bearer '.length)) : undefined;
    const user = held?.live ? byId(held.userId) : null;
    return held && user ? { held, user } : null;
  };

  const route = (method: string, path: string, query: URLSearchParams, init: RequestInit | undefined, url: string): Response => {
    const body = bodyOf(init);
    const grant = path === '/token' && method === 'POST' ? query.get('grant_type') : null;
    if (method === 'POST' && path === '/recover') {
      const challenge = body.code_challenge;
      if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || String(body.code_challenge_method).toLowerCase() !== 's256') {
        return refusal(400, 'validation_failed', 'an S256 PKCE challenge is required', url);
      }
      const user = typeof body.email === 'string' ? users.get(body.email.toLowerCase()) : undefined;
      const redirect = query.get('redirect_to') ?? '';
      if (user && options.callbacks.includes(redirect)) {
        const code = randomUUID();
        codes.set(code, { userId: user.id, challenge, expiresAt: now() + codeTtl, used: false });
        secrets.add(code);
        mailbox.push({ to: user.email, callback: `${redirect}?code=${code}` });
      }
      return reply(200, {}, url);
    }
    if (grant === 'pkce') {
      if (typeof body.code_verifier === 'string') secrets.add(body.code_verifier);
      const code = typeof body.auth_code === 'string' ? codes.get(body.auth_code) : undefined;
      if (!code || code.used) return refusal(404, 'flow_state_not_found', 'invalid flow state, no valid flow state found', url);
      code.used = true;
      if (now() > code.expiresAt) return refusal(400, 'flow_state_expired', 'flow state has expired', url);
      if (typeof body.code_verifier !== 'string' || s256(body.code_verifier) !== code.challenge) {
        return refusal(400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier', url);
      }
      const user = byId(code.userId);
      return user ? reply(200, issue(user), url) : refusal(404, 'user_not_found', 'User not found', url);
    }
    if (grant === 'password') {
      const user = typeof body.email === 'string' ? users.get(body.email.toLowerCase()) : undefined;
      if (!user || body.password !== user.password) return refusal(400, 'invalid_credentials', 'Invalid login credentials', url);
      return reply(200, issue(user), url);
    }
    if (grant === 'refresh_token') {
      const held = [...sessions.values()].find((s) => s.live && s.refreshToken === body.refresh_token);
      const user = held ? byId(held.userId) : null;
      if (!held || !user) return refusal(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found', url);
      held.live = false;
      return reply(200, issue(user), url);
    }
    if ((method === 'GET' || method === 'PUT') && path === '/user') {
      const owned = owner(init);
      if (!owned) return refusal(403, 'bad_jwt', 'invalid JWT', url);
      if (method === 'PUT') {
        const others = Object.keys(body).filter((key) => key !== 'password' && !(key.startsWith('code_challenge') && (body[key] === null || body[key] === undefined)));
        if (typeof body.password !== 'string' || others.length > 0) return refusal(422, 'validation_failed', 'only a new password is served here', url);
        if (body.password.length < 6) return refusal(422, 'weak_password', 'Password should be at least 6 characters.', url);
        if (body.password === owned.user.password) return refusal(422, 'same_password', 'New password should be different from the old password.', url);
        secrets.add(body.password);
        owned.user.password = body.password;
      }
      return reply(200, userJson(owned.user), url);
    }
    if (method === 'POST' && path === '/logout') {
      if (query.get('scope') !== 'local' || [...query.keys()].length !== 1) return refusal(400, 'validation_failed', 'only scope=local is served', url);
      const owned = owner(init);
      if (!owned) return refusal(403, 'bad_jwt', 'invalid JWT', url);
      owned.held.live = false;
      return reply(204, null, url);
    }
    throw new TypeError(`fake recovery Auth: ${method} ${path} is not served`);
  };

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith(`${FAKE_RECOVERY_AUTH}/`)) throw new TypeError('fake recovery Auth: not this server');
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, path: pathname, grant: searchParams.get('grant_type'), scope: searchParams.get('scope') });
    return route(method, pathname, searchParams, init, url);
  };

  return {
    fetch: fetchImpl as typeof fetch,
    /** Links the server would have mailed, in order. */
    mailbox: mailbox as readonly RecoveryMail[],
    calls: calls as readonly RecoveryCall[],
    /** Adds a disposable .test user with this password; its canonical ID. */
    seed(email: string, password: string): { id: string } {
      if (!SYNTHETIC.test(email)) throw new Error('fake recovery Auth: only disposable .test addresses');
      const user: User = { id: randomUUID(), email: email.toLowerCase(), password, createdAt: new Date(now()).toISOString() };
      users.set(user.email, user);
      secrets.add(password);
      return { id: user.id };
    },
    /** How many sessions of this user are still live. */
    liveSessions(email: string): number {
      const user = users.get(email.toLowerCase());
      return user ? [...sessions.values()].filter((held) => held.live && held.userId === user.id).length : 0;
    },
    /** Every password, code, verifier and token so far: none may be logged or stored outside. */
    get secrets(): string[] {
      return [...secrets];
    },
  };
}

export type FakeRecoveryApi = ReturnType<typeof fakeRecoveryApi>;
