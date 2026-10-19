// Test-only model of the local account API (backend/docs/Backend_Local_Contract.md §3 to §8), of the local GoTrue as
// the maintained @supabase/auth-js SDK calls it (password and refresh grants, logout; sign-up is off, as at the
// prepared server) and of the legacy Auth emulator's password sign-in, behind one injected fetch. Receipts, checksums
// and semantic hashes come from referenceCjson (Node's crypto, independent of the app's canonicalizer); payloads are
// stored and pulled back as the exact text received. Hooks let a test lose a response after the server committed, hold
// a request, rewrite a receipt or upload results, corrupt a pull page or take the network away, and steer the GoTrue
// (an outage, a held or refused logout, sessions revoked elsewhere). Request records never keep the Authorization
// header or a GoTrue request's body: they carry tokens and passwords.
import { createHash, randomBytes, randomUUID } from 'crypto';

import { arrayElements, objectMembers } from '../src/storage/rawRecords';
import { referenceIdsChecksum, referenceSemanticSha256, sha256 } from './referenceCjson';

export const FAKE_API = 'http://127.0.0.1:8092';
export const FAKE_EMULATOR = 'http://127.0.0.1:9099';
/** The fake local GoTrue's root: its endpoints are at the root of its own loopback port, as the real one's. */
export const FAKE_GOTRUE = 'http://127.0.0.1:54321';
/** The issuer the fake GoTrue names in its tokens: a logical name, never a transport address. */
export const FAKE_GOTRUE_ISSUER = 'https://auth.ayailmu-local.test/auth/v1';
/** How long the fake GoTrue's access tokens live, in seconds (GoTrue's default). */
export const FAKE_GOTRUE_TOKEN_SECONDS = 3600;

/** The app's explicit local-supabase build variables for this fake deployment (the account API stays at FAKE_API). */
export const FAKE_LOCAL_SUPABASE_ENV = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE } as const;

// Each test of a suite that imports this fixture (at its top) runs with FAKE_LOCAL_SUPABASE_ENV, restored after the
// test, so it never reaches another test or suite. A suite that builds the app's default account services (the
// AccountProvider) thereby reaches this fake GoTrue through the maintained SDK; suites that build their own auth (the
// emulator pilot's) never read it, and the app itself never falls back to the legacy emulator variables.
const suiteEnv: [string, string | undefined][] = [];
beforeEach(() => {
  suiteEnv.length = 0;
  for (const [name, value] of Object.entries(FAKE_LOCAL_SUPABASE_ENV)) {
    suiteEnv.push([name, process.env[name]]);
    process.env[name] = value;
  }
});
afterEach(() => {
  for (const [name, value] of suiteEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

export interface FakeUser {
  email: string;
  password: string;
  /** The legacy emulator's local ID (any string). The fake GoTrue gives the user providerUserId(user) instead. */
  uid: string;
  /** The legacy emulator's ID token. */
  token: string;
  accountId: string;
}

/** The canonical user ID (a UUID) the fake GoTrue gives a user: derived from its legacy uid, but never that uid. */
export function providerUserId(user: FakeUser): string {
  const h = createHash('sha256').update(`fake-gotrue-user ${user.uid}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** One request as the wire saw it, in order across the fake servers: never a body, a token or any other header. */
export interface WireRecord {
  server: 'api' | 'auth' | 'emulator' | 'elsewhere';
  method: string;
  path: string;
  /** The query string, without its "?". */
  query: string;
}

export interface SentRequest {
  method: string;
  path: string;
  /** The query string, without its "?". */
  query: string;
  /** Request headers in lower case, except Authorization. */
  headers: Record<string, string>;
  /** Whether a bearer token was sent. */
  bearer: boolean;
  body: string;
}

export type FakeRoute = 'me' | 'import' | 'events' | 'pull' | 'profile' | 'patch' | 'progress';

type Json = Record<string, unknown>;

interface Envelope {
  event_id: string;
  schema: string;
  schema_version: number;
  curriculum: Record<string, string>;
  source: Record<string, string>;
}

export interface StoredEvent {
  seq: number;
  eventId: string;
  family: string;
  installId: string;
  envelope: Envelope;
  payload: string;
  hash: string;
}

export interface FakeProfile {
  profileId: string;
  accountId: string;
  revision: number;
  settings: Json;
  consent: { version: string; at: string };
  /** Linked sources, as "app install local". */
  sources: Set<string>;
  events: StoredEvent[];
}

interface FetchInit {
  method?: string;
  headers?: unknown;
  body?: unknown;
}

function headerMap(headers: unknown): Record<string, string> {
  const pairs: [string, string][] = [];
  if (Array.isArray(headers)) pairs.push(...(headers as [string, string][]));
  else if (headers && typeof (headers as Headers).forEach === 'function') (headers as Headers).forEach((value, name) => pairs.push([name, value]));
  else if (headers) pairs.push(...Object.entries(headers as Record<string, string>));
  return Object.fromEntries(pairs.map(([name, value]) => [name.toLowerCase(), String(value)]));
}

const RECEIVED_AT = '2026-10-18T03:00:00Z';
const USER_CREATED_AT = '2026-10-18T00:00:00Z';

/** A session of the fake GoTrue: its user, its current refresh token, and every access token issued to it. */
interface GoTrueSession {
  id: string;
  user: FakeUser;
  refreshToken: string;
  /** Access token → its expiry (ms since the epoch). */
  accessTokens: Map<string, number>;
  live: boolean;
  signedInAt: number;
}

/** What a held logout does when released: revoke the session (204), refuse (403, nothing revoked), or never answer. */
export type LogoutOutcome = 'accept' | 'refuse' | 'lost';

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A JWT-shaped access token (header.claims.signature), as GoTrue issues them. The signature is random: nothing checks it. */
const fakeAccessToken = (claims: Json) =>
  `${base64url({ alg: 'ES256', kid: 'fake-gotrue', typ: 'JWT' })}.${base64url(claims)}.${randomBytes(32).toString('base64url')}`;

/** GoTrue's user document of a prepared user: a confirmed email, no metadata. */
const gotrueUser = (user: FakeUser): Json => ({
  id: providerUserId(user),
  aud: 'authenticated',
  role: 'authenticated',
  email: user.email,
  email_confirmed_at: USER_CREATED_AT,
  phone: '',
  confirmed_at: USER_CREATED_AT,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: USER_CREATED_AT,
  updated_at: USER_CREATED_AT,
  is_anonymous: false,
});

const bodyOf = (body: unknown): Json => {
  try {
    const value: unknown = JSON.parse(String(body));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
  } catch {
    return {};
  }
};

const bearerOf = (authorization: string | undefined) => (authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '');

function routeOf(method: string, path: string): FakeRoute | null {
  if (path === '/v1/me' && method === 'GET') return 'me';
  if (path === '/v1/imports' && method === 'POST') return 'import';
  const m = /^\/v1\/profiles\/[^/]+(\/events|\/progress)?$/.exec(path);
  if (!m) return null;
  if (m[1] === '/events') return method === 'POST' ? 'events' : 'pull';
  if (m[1] === '/progress') return 'progress';
  return method === 'PATCH' ? 'patch' : 'profile';
}

export function fakeAccountApi(users: FakeUser[], options: { pageSize?: number } = {}) {
  const sent: SentRequest[] = [];
  const profiles: FakeProfile[] = [];
  /** "account app install local" → profile ID. */
  const links = new Map<string, string>();
  /** "account importID" → the request's hash and its receipt. */
  const imports = new Map<string, { hash: string; receipt: Json }>();
  const lose = new Set<FakeRoute>();
  const holds = new Map<FakeRoute, Promise<void>>();
  let offline = false;
  let receiptRewrite: ((receipt: Json) => Json) | null = null;
  let resultsRewrite: ((results: Json[]) => Json[]) | null = null;
  let corruptPage = 0;
  const hooks: { beforeImport: ((body: string) => void) | null } = { beforeImport: null };
  /** Every request in order, across the API, the GoTrue, the emulator and anywhere else. */
  const wire: WireRecord[] = [];
  const authSent: SentRequest[] = [];
  const authSessions: GoTrueSession[] = [];
  const issued: string[] = [];
  const logoutOutcomes: Promise<LogoutOutcome>[] = [];
  const authOutage: { on: boolean; onAttempt: (() => void) | null } = { on: false, onAttempt: null };
  /** The fake servers' clock: the test's Date.now, read at each request. */
  const now = () => Date.now();

  const respond = (status: number, body: unknown, url: string, extra: Record<string, string> = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', ...extra };
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      redirected: false,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
    };
  };
  const problem = (status: number, code: string, url: string, extra: Json = {}) =>
    respond(status, { type: `urn:ayailmu:problem:${code}`, title: code, status, code, detail: 'refused by the fake API', ...extra }, url);
  const sourceKey = (s: Record<string, string>) => `${s.app} ${s.install_id} ${s.local_profile_id}`;
  const profileDoc = (p: FakeProfile) => ({
    profile_id: p.profileId,
    kind: 'adult',
    revision: p.revision,
    high_seq: p.events.length,
    settings: p.settings,
    consent: p.consent,
    sources: [...p.sources].map((s) => {
      const [app, install_id, local_profile_id] = s.split(' ');
      return { app, install_id, local_profile_id };
    }),
  });
  const parseEnvelope = (text: string) => {
    const env = JSON.parse(text) as Envelope;
    const payload = objectMembers(text).get('payload') ?? '';
    return { env, payload, learner: (JSON.parse(payload) as { learner_id?: unknown }).learner_id, hash: referenceSemanticSha256(text) };
  };
  type Parsed = ReturnType<typeof parseEnvelope>;
  const store = (p: FakeProfile, e: Parsed): StoredEvent => {
    const s: StoredEvent = { seq: p.events.length + 1, eventId: e.env.event_id, family: e.env.curriculum.family, installId: e.env.source.install_id, envelope: e.env, payload: e.payload, hash: e.hash };
    p.events.push(s);
    return s;
  };
  const sameSettings = (a: Json, b: Json) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const profileById = (id: string) => {
    const p = profiles.find((x) => x.profileId === id);
    if (!p) throw new Error('fake API: no such profile');
    return p;
  };

  function receiptReply(status: number, receipt: Json, url: string) {
    const out = receiptRewrite ? receiptRewrite(receipt) : receipt;
    receiptRewrite = null;
    return respond(status, out, url);
  }

  function postImport(account: string, bodyText: string, url: string) {
    let body: {
      import_id: string;
      source: Record<string, string>;
      target: { profile_id?: string; new_profile?: { kind?: string; settings?: Json; consent?: { version: string; at: string } } };
    };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return problem(400, 'invalid_json', url);
    }
    // Retries are sent byte for byte, so this model hashes the exact text (stricter than the server's canonical hash).
    const hash = sha256(bodyText);
    const key = `${account} ${body.import_id}`;
    const prior = imports.get(key);
    if (prior) return prior.hash === hash ? receiptReply(200, { ...prior.receipt, replayed: true }, url) : problem(409, 'import_id_reused', url);
    const events = arrayElements(objectMembers(bodyText).get('events') ?? '[]').map(parseEnvelope);
    for (const e of events) {
      if (e.env.source.local_profile_id !== e.learner) {
        return problem(422, 'import_rejected', url, { results: [{ event_id: e.env.event_id, result: 'invalid', status: 422, code: 'learner_mismatch' }] });
      }
      if (sourceKey(e.env.source) !== sourceKey(body.source)) {
        return problem(409, 'import_rejected', url, { results: [{ event_id: e.env.event_id, result: 'unlinked', status: 409, code: 'source_not_linked' }] });
      }
    }
    const linkKey = `${account} ${sourceKey(body.source)}`;
    const mapped = links.get(linkKey);
    let profile: FakeProfile | undefined;
    let created = false;
    if (mapped) {
      if (body.target.profile_id && body.target.profile_id !== mapped) return problem(409, 'source_already_linked', url);
      profile = profiles.find((p) => p.profileId === mapped);
    } else if (body.target.profile_id) {
      profile = profiles.find((p) => p.profileId === body.target.profile_id && p.accountId === account);
    } else if (body.target.new_profile?.kind === 'adult' && body.target.new_profile.consent) {
      const np = body.target.new_profile;
      profile = { profileId: randomUUID(), accountId: account, revision: 1, settings: { ...(np.settings ?? {}) }, consent: np.consent!, sources: new Set(), events: [] };
      created = true;
    } else {
      return problem(422, 'invalid_import', url);
    }
    if (!profile) return problem(404, 'not_found', url);
    for (const e of events) {
      const held = profile.events.find((s) => s.eventId === e.env.event_id);
      if (held && held.hash !== e.hash) return problem(409, 'import_rejected', url, { results: [{ event_id: e.env.event_id, result: 'conflict', status: 409, code: 'event_conflict' }] });
    }
    // All or nothing: profile, link, events and import record together.
    if (created) profiles.push(profile);
    profile.sources.add(sourceKey(body.source));
    links.set(linkKey, profile.profileId);
    let stored = 0;
    let identical = 0;
    for (const e of events) {
      if (profile.events.some((s) => s.eventId === e.env.event_id)) identical += 1;
      else {
        store(profile, e);
        stored += 1;
      }
    }
    const receipt = {
      import_id: body.import_id,
      profile_id: profile.profileId,
      profile_created: created,
      replayed: false,
      stored,
      identical,
      high_seq: profile.events.length,
      event_ids_sha256: referenceIdsChecksum(events.map((e) => e.env.event_id)),
      committed_at: RECEIVED_AT,
    };
    imports.set(key, { hash, receipt });
    return receiptReply(201, receipt, url);
  }

  function postEvents(p: FakeProfile, bodyText: string, url: string) {
    const events = arrayElements(objectMembers(bodyText).get('events') ?? '[]').map(parseEnvelope);
    if (events.length === 0) return problem(400, 'invalid_request', url);
    if (events.length > 500) return problem(413, 'batch_too_large', url);
    if (events.some((e) => !p.sources.has(sourceKey(e.env.source)))) return problem(409, 'source_not_linked', url);
    const results: Json[] = events.map((e, index) => {
      const base = { index, event_id: e.env.event_id };
      if (e.env.source.local_profile_id !== e.learner) return { ...base, result: 'invalid', status: 422, code: 'learner_mismatch', detail: 'refused by the fake API' };
      const held = p.events.find((s) => s.eventId === e.env.event_id);
      if (held) {
        return held.hash === e.hash
          ? { ...base, result: 'identical', status: 200, seq: held.seq, received_at: RECEIVED_AT, semantic_sha256: held.hash, curriculum_status: 'registered', clock_flags: [] }
          : { ...base, result: 'conflict', status: 409, code: 'event_conflict', seq: held.seq, stored_sha256: held.hash, received_sha256: e.hash };
      }
      const s = store(p, e);
      return { ...base, result: 'stored', status: 201, seq: s.seq, received_at: RECEIVED_AT, semantic_sha256: s.hash, curriculum_status: 'registered', clock_flags: [] };
    });
    const out = resultsRewrite ? resultsRewrite(results) : results;
    resultsRewrite = null;
    return respond(200, { results: out, high_seq: p.events.length }, url);
  }

  function pull(p: FakeProfile, query: string, url: string) {
    const q = new URLSearchParams(query);
    const after = Number(q.get('after') ?? '0');
    const limit = Math.min(Number(q.get('limit') ?? '100'), options.pageSize ?? 500);
    const family = q.get('family');
    const matching = p.events.filter((e) => e.seq > after && (family === null || e.family === family));
    const page = matching.slice(0, limit);
    let nextAfter = page.length ? page[page.length - 1].seq : after;
    if (corruptPage > 0) {
      corruptPage -= 1;
      if (corruptPage === 0) nextAfter = p.events.length; // claims high_seq: never a valid cursor for a family page
    }
    const events = page.map(
      (e) =>
        `{"seq":${e.seq},"event_id":${JSON.stringify(e.eventId)},"kind":"answer","schema":${JSON.stringify(e.envelope.schema)},` +
        `"schema_version":${e.envelope.schema_version},"curriculum":${JSON.stringify(e.envelope.curriculum)},"curriculum_status":"registered",` +
        `"source":${JSON.stringify(e.envelope.source)},"semantic_sha256":"${e.hash}","clock_flags":[],"received_at":"${RECEIVED_AT}","payload":${e.payload}}`
    );
    return respond(200, `{"events":[${events.join(',')}],"next_after":${nextAfter},"high_seq":${p.events.length},"has_more":${matching.length > page.length}}`, url);
  }

  function patch(p: FakeProfile, headers: Record<string, string>, bodyText: string, url: string) {
    const etag = `"r${p.revision}"`;
    if (headers['content-type'] !== 'application/merge-patch+json') return problem(415, 'unsupported_media_type', url);
    const tags = (headers['if-match'] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tags.length) return problem(428, 'precondition_required', url);
    if (!tags.includes(etag)) {
      return respond(412, { type: 'urn:ayailmu:problem:revision_conflict', title: 'revision_conflict', status: 412, code: 'revision_conflict', detail: 'stale', current: profileDoc(p) }, url, { etag });
    }
    const body = JSON.parse(bodyText) as { settings?: Json | null };
    const next: Json = { ...p.settings };
    for (const [k, v] of Object.entries(body.settings ?? {})) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if (!sameSettings(next, p.settings)) {
      p.settings = next;
      p.revision += 1;
    }
    return respond(200, profileDoc(p), url, { etag: `"r${p.revision}"` });
  }

  function progress(p: FakeProfile, query: string, url: string) {
    const family = new URLSearchParams(query).get('family');
    if (family !== 'expo-trial-arabic' && family !== 'android-catalog') return problem(400, 'invalid_query', url);
    const mine = p.events.filter((e) => e.family === family);
    const payloads = mine.map((e) => JSON.parse(e.payload) as Json);
    const truth = (key: string) => {
      const c = { true: 0, false: 0, absent: 0, unknown: 0 };
      for (const e of payloads) {
        if (!(key in e)) c.absent += 1;
        else if (e[key] === true) c.true += 1;
        else if (e[key] === false) c.false += 1;
        else c.unknown += 1;
      }
      return c;
    };
    return respond(
      200,
      {
        profile_id: p.profileId,
        family,
        as_of_seq: p.events.length,
        derivation: 'factual-counts-v1',
        learned: { status: 'not_assessed_by_server' },
        retention: { status: 'not_assessed_by_server' },
        events: payloads.length,
        excluded_unregistered: 0,
        clock_flagged: 0,
        source_installs: new Set(mine.map((e) => e.installId)).size,
        skills: [],
        versions: [],
        provenance: {
          synthetic: truth('synthetic'),
          feedback_deferred: truth('feedback_deferred'),
          hint_used: truth('hint_used'),
          retention_valid_false: payloads.filter((e) => e.retention_valid === false).length,
        },
      },
      url
    );
  }

  function handle(route: FakeRoute | null, account: string, pathname: string, query: string, headers: Record<string, string>, body: string, url: string) {
    if (route === 'me') {
      const own = profiles.filter((p) => p.accountId === account).map((p) => ({ profile_id: p.profileId, revision: p.revision, high_seq: p.events.length }));
      return respond(200, { account_id: account, profiles: own }, url);
    }
    if (route === 'import') return postImport(account, body, url);
    const id = /^\/v1\/profiles\/([^/]+)/.exec(pathname)?.[1];
    const p = profiles.find((x) => x.profileId === id && x.accountId === account);
    if (!route || !p) return problem(404, 'not_found', url);
    switch (route) {
      case 'events':
        return postEvents(p, body, url);
      case 'pull':
        return pull(p, query, url);
      case 'progress':
        return progress(p, query, url);
      case 'patch':
        return patch(p, headers, body, url);
      default:
        return respond(200, profileDoc(p), url, { etag: `"r${p.revision}"` });
    }
  }

  const authReply = (status: number, body: unknown, url: string) =>
    respond(status, body, url, { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' });
  const authRefusal = (status: number, errorCode: string, msg: string, url: string) => authReply(status, { code: status, error_code: errorCode, msg }, url);

  /** A grant's reply: a new access token, and the refresh token rotated (the previous one stops working). */
  const issue = (session: GoTrueSession) => {
    const iat = Math.floor(now() / 1000);
    const exp = iat + FAKE_GOTRUE_TOKEN_SECONDS;
    const accessToken = fakeAccessToken({
      aud: 'authenticated',
      exp,
      iat,
      iss: FAKE_GOTRUE_ISSUER,
      sub: providerUserId(session.user),
      email: session.user.email,
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: session.signedInAt }],
      session_id: session.id,
      is_anonymous: false,
    });
    session.refreshToken = randomBytes(12).toString('base64url');
    session.accessTokens.set(accessToken, exp * 1000);
    issued.push(accessToken, session.refreshToken);
    return { access_token: accessToken, token_type: 'bearer', expires_in: FAKE_GOTRUE_TOKEN_SECONDS, expires_at: exp, refresh_token: session.refreshToken, user: gotrueUser(session.user) };
  };

  /** The session of an access token while the token has not expired (live or not). */
  const sessionOf = (authorization: string | undefined) => {
    const token = bearerOf(authorization);
    const session = authSessions.find((s) => s.accessTokens.has(token));
    return session && now() < (session.accessTokens.get(token) ?? 0) ? session : null;
  };

  /** The account a bearer token signs in: a legacy emulator ID token, or an unexpired access token of a live GoTrue session. */
  const accountOf = (authorization: string | undefined) => {
    const legacy = users.find((u) => authorization === `Bearer ${u.token}`);
    if (legacy) return legacy.accountId;
    const session = sessionOf(authorization);
    return session?.live ? session.user.accountId : undefined;
  };

  async function gotrue(url: string, init: FetchInit) {
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const all = headerMap(init.headers);
    const query = search.replace(/^\?/, '');
    authSent.push({ method, path: pathname, query, headers: Object.fromEntries(Object.entries(all).filter(([name]) => name !== 'authorization')), bearer: all.authorization !== undefined, body: '' });
    wire.push({ server: 'auth', method, path: pathname, query });
    if (authOutage.on) {
      authOutage.onAttempt?.();
      throw new TypeError('Network request failed');
    }
    const params = new URLSearchParams(query);
    if (method === 'POST' && pathname === '/token') {
      const body = bodyOf(init.body);
      if (params.get('grant_type') === 'password') {
        const email = typeof body.email === 'string' ? body.email.toLowerCase() : null;
        const user = users.find((u) => u.email.toLowerCase() === email && u.password === body.password);
        if (!user) return authRefusal(400, 'invalid_credentials', 'Invalid login credentials', url);
        const session: GoTrueSession = { id: randomUUID(), user, refreshToken: '', accessTokens: new Map(), live: true, signedInAt: Math.floor(now() / 1000) };
        authSessions.push(session);
        return authReply(200, issue(session), url);
      }
      if (params.get('grant_type') === 'refresh_token') {
        const session = authSessions.find((s) => s.live && s.refreshToken !== '' && s.refreshToken === body.refresh_token);
        return session ? authReply(200, issue(session), url) : authRefusal(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found', url);
      }
      return authRefusal(400, 'validation_failed', 'Unsupported grant type', url);
    }
    if (method === 'POST' && pathname === '/logout') {
      const outcome = await (logoutOutcomes.shift() ?? 'accept');
      if (outcome === 'lost') throw new TypeError('Network request failed');
      if (outcome === 'refuse') return authRefusal(403, 'forbidden', 'Refused by the fake Auth server', url);
      const session = sessionOf(all.authorization);
      if (!session) return authRefusal(403, 'bad_jwt', 'invalid JWT', url);
      if (!session.live) return authRefusal(403, 'session_not_found', 'Session from session_id claim in JWT does not exist', url);
      const scope = params.get('scope') ?? 'global';
      for (const s of authSessions) {
        if (s.user === session.user && (scope === 'local' ? s === session : scope === 'others' ? s !== session : true)) s.live = false;
      }
      return authReply(204, '', url);
    }
    // Sign-up is off at the prepared local GoTrue.
    if (method === 'POST' && pathname === '/signup') return authRefusal(422, 'signup_disabled', 'Signups not allowed for this instance', url);
    return authRefusal(404, 'not_found', 'Not found', url);
  }

  function emulator(url: string, init: FetchInit) {
    if (!url.startsWith(`${FAKE_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?`)) return Promise.reject(new TypeError('Network request failed'));
    const body = JSON.parse(String(init.body)) as { email?: string; password?: string };
    const user = users.find((u) => u.email === body.email && u.password === body.password);
    return Promise.resolve(
      user
        ? respond(200, { kind: 'identitytoolkit#VerifyPasswordResponse', localId: user.uid, email: user.email, idToken: user.token, refreshToken: `refresh-${user.uid}`, expiresIn: '3600', registered: true }, url)
        : respond(400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, url)
    );
  }

  const fetchImpl = async (input: unknown, init: FetchInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${FAKE_GOTRUE}/`)) return gotrue(url, init);
    if (url.startsWith(`${FAKE_EMULATOR}/`)) {
      const { pathname, search } = new URL(url);
      wire.push({ server: 'emulator', method: init.method ?? 'GET', path: pathname, query: search.replace(/^\?/, '') });
      return emulator(url, init);
    }
    if (!url.startsWith(`${FAKE_API}/`)) {
      wire.push({ server: 'elsewhere', method: init.method ?? 'GET', path: '', query: '' });
      throw new TypeError('Network request failed');
    }
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const all = headerMap(init.headers);
    const headers = Object.fromEntries(Object.entries(all).filter(([name]) => name !== 'authorization'));
    const body = typeof init.body === 'string' ? init.body : '';
    const query = search.replace(/^\?/, '');
    sent.push({ method, path: pathname, query, headers, bearer: all.authorization !== undefined, body });
    wire.push({ server: 'api', method, path: pathname, query });
    if (offline) throw new TypeError('Network request failed');
    const route = routeOf(method, pathname);
    if (route === 'import') hooks.beforeImport?.(body);
    const gate = route ? holds.get(route) : undefined;
    if (route && gate) {
      holds.delete(route);
      await gate;
    }
    const account = accountOf(all.authorization);
    if (!account) return problem(401, 'unauthenticated', url);
    const response = handle(route, account, pathname, query, headers, body, url);
    if (route && lose.delete(route)) throw new TypeError('Network request failed'); // committed, but the response is lost
    return response;
  };

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    sent,
    wire,
    profiles,
    hooks,
    /** The fake local GoTrue at FAKE_GOTRUE: what reached it (never a body or a token) and how a test steers it. */
    auth: {
      sent: authSent,
      /** While on, every request fails as a lost connection, after `onAttempt` (where a test moves its clock on). */
      setOffline(on: boolean, onAttempt?: () => void) {
        authOutage.on = on;
        authOutage.onAttempt = on ? (onAttempt ?? null) : null;
      },
      /** The next logout waits until released: accepted (that session is revoked), refused (403, nothing revoked) or lost. */
      holdNextLogout() {
        let release: (outcome: LogoutOutcome) => void = () => undefined;
        logoutOutcomes.push(new Promise<LogoutOutcome>((resolve) => (release = resolve)));
        return { release: (outcome: LogoutOutcome = 'accept') => release(outcome) };
      },
      /** The user's sessions end at the server, as when they sign out elsewhere. */
      revokeAll(email: string) {
        for (const s of authSessions) if (s.user.email === email) s.live = false;
      },
      /** How many of the user's sessions the server still accepts. */
      liveSessions(email: string) {
        return authSessions.filter((s) => s.live && s.user.email === email).length;
      },
      /** Every access and refresh token issued so far, so a test can show none was stored. */
      issued: () => [...issued],
    },
    /** The server commits the next request of this route; then its response is lost. */
    loseNext(route: FakeRoute) {
      lose.add(route);
    },
    /** Holds the next request of this route (after it is recorded) until released. */
    hold(route: FakeRoute) {
      let release: () => void = () => undefined;
      holds.set(route, new Promise<void>((r) => (release = r)));
      return { release: () => release() };
    },
    rewriteNextReceipt(fn: (receipt: Json) => Json) {
      receiptRewrite = fn;
    },
    rewriteNextResults(fn: (results: Json[]) => Json[]) {
      resultsRewrite = fn;
    },
    /** The nth pull page from now claims next_after = high_seq. */
    corruptPullPage(n: number) {
      corruptPage = n;
    },
    setOffline(on: boolean) {
      offline = on;
    },
    profileOf(accountId: string): FakeProfile | null {
      return profiles.find((p) => p.accountId === accountId) ?? null;
    },
    committedImports(accountId: string) {
      return [...imports.keys()].filter((k) => k.startsWith(`${accountId} `)).length;
    },
    /** Another device's answer (or another family's), stored as if its source were linked. Returns its seq. */
    seedEvent(profileId: string, envelope: string) {
      return store(profileById(profileId), parseEnvelope(envelope)).seq;
    },
    /** Another device changes the profile's settings: a new revision. */
    patchFromOtherDevice(profileId: string, settings: Json) {
      const p = profileById(profileId);
      p.settings = { ...p.settings, ...settings };
      p.revision += 1;
    },
  };
}

export type FakeAccountApi = ReturnType<typeof fakeAccountApi>;
