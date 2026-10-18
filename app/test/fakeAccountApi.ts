// Test-only model of the local account API (backend/docs/Backend_Local_Contract.md §3 to §8) and of the Auth
// emulator's password sign-in, behind one injected fetch. Receipts, checksums and semantic hashes come from
// referenceCjson (Node's crypto, independent of the app's canonicalizer); payloads are stored and pulled back as the
// exact text received. Hooks let a test lose a response after the server committed, hold a request, rewrite a receipt
// or upload results, corrupt a pull page or take the network away. Request records never keep the Authorization
// header: it carries the token.
import { randomUUID } from 'crypto';

import { arrayElements, objectMembers } from '../src/storage/rawRecords';
import { referenceIdsChecksum, referenceSemanticSha256, sha256 } from './referenceCjson';

export const FAKE_API = 'http://127.0.0.1:8092';
export const FAKE_EMULATOR = 'http://127.0.0.1:9099';

export interface FakeUser {
  email: string;
  password: string;
  uid: string;
  token: string;
  accountId: string;
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
    if (url.startsWith(`${FAKE_EMULATOR}/`)) return emulator(url, init);
    if (!url.startsWith(`${FAKE_API}/`)) throw new TypeError('Network request failed');
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const all = headerMap(init.headers);
    const headers = Object.fromEntries(Object.entries(all).filter(([name]) => name !== 'authorization'));
    const body = typeof init.body === 'string' ? init.body : '';
    const query = search.replace(/^\?/, '');
    sent.push({ method, path: pathname, query, headers, bearer: all.authorization !== undefined, body });
    if (offline) throw new TypeError('Network request failed');
    const route = routeOf(method, pathname);
    if (route === 'import') hooks.beforeImport?.(body);
    const gate = route ? holds.get(route) : undefined;
    if (route && gate) {
      holds.delete(route);
      await gate;
    }
    const account = users.find((u) => all.authorization === `Bearer ${u.token}`)?.accountId;
    if (!account) return problem(401, 'unauthenticated', url);
    const response = handle(route, account, pathname, query, headers, body, url);
    if (route && lose.delete(route)) throw new TypeError('Network request failed'); // committed, but the response is lost
    return response;
  };

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    sent,
    profiles,
    hooks,
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
