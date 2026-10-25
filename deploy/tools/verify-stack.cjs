#!/usr/bin/env node
// Real-SDK and API verification of the local synthetic Compose stack, which `aya_stack.py verify` runs after it created
// the prepared .test users through Auth's internal admin API:
//
//   node deploy/tools/verify-stack.cjs <runtime-dir> <report.json>
//
// <runtime-dir>: the stack's private runtime directory (0700, this user's, under .vps-runtime-20261018), read only now:
// manifest.json (the port, the front's names, the issuer), proxy-root.crt (the root of Caddy's local CA, which `up`
// exported) and secrets/ops/users/*.json (the prepared users' email and password). Nothing else is read; the admin
// credential never is. <report.json>: a new file (never overwritten) for the sanitized report: check names, HTTP
// statuses and counts only.
//
// It drives the maintained @supabase/auth-js 2.118.0 installed in the RN app, and the API, through the stack's front
// only: https://<api name>:<port> and https://<auth name>:<port>, connected to 127.0.0.1:<port> by this process itself
// (no DNS or hosts-file change) and trusting the exported root for these requests only (no trust store change).
//   front  health, readiness, HSTS and no-store; the uniform 401; no web origin granted; Auth's admin, sign-up, settings,
//          key set and other routes not served; no certificate for another name; nothing trusted without the root
//   A      SDK password sign-in (issuer, audience, role, ES256, password AMR) -> GET /v1/me creates the account -> guest
//          import of an adult profile with consent and one event (201), replayed (200) -> profile and consent -> settings
//          patch with If-Match -> event upload -> pull -> progress -> SDK refresh (same account, same password sign-in
//          time) -> export (auth_mode local-supabase, the stack's issuer)
//   B      a second user: its own account, and every route on A's profile is the same 404
//   logout A's SDK local sign-out (204) -> both old access tokens get API 401 -> its old refresh token is refused
//   delete each user signs in again (the same account) and deletes its account through the API: server data erased,
//          provider identity deleted with the API's own admin credential -> its token gets 401 -> its password no
//          longer signs in
// Every password and token stays in memory, is scrubbed from the report, and is dropped at the end, pass or fail. The
// console is captured and never printed.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { createRequire } = require('node:module');

const TASK_ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_DIR = path.join(TASK_ROOT, 'ayailmu-rn-ux-20261017', 'app');
const RUNTIME_DIR = path.join(TASK_ROOT, '.vps-runtime-20261018');
const LABEL_PREFIX = 'aya-amar-p8-stack-';
const EXPECTED_AUTH_JS = '2.118.0';
const SDK_PACKAGE = '@supabase/auth-js';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 4 << 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONSENT = { version: 'trial-consent-1', at: '2026-10-15T00:00:00Z' };
const FAMILY = 'expo-trial-arabic';
// صَادِقٌ, assembled from code points so no editor or transport can alter it.
const SADIQUN = String.fromCodePoint(0x0635, 0x064e, 0x0627, 0x062f, 0x0650, 0x0642, 0x064c);

/** A failed check or a refused input. Its message is a fixed check name, never data. */
class VerifyFailure extends Error {
  constructor(check) {
    super(check);
    this.name = 'VerifyFailure';
  }
}

const report = {
  verifier: 'phase8-local-stack-verify',
  startedAt: new Date().toISOString(),
  node: process.version,
  authJs: null,
  stack: null,
  result: 'fail',
  failure: null,
  checks: [],
  statuses: {},
  counts: {},
};

function check(name, ok) {
  report.checks.push({ name, pass: Boolean(ok) });
  if (!ok) throw new VerifyFailure(name);
}

// Every password and token seen, in memory only: no URL, log line or report may carry one.
const secrets = new Set();
const remember = (value) => {
  if (typeof value === 'string' && value.length >= 6) secrets.add(value);
};
const containsSecret = (text) => [...secrets].some((secret) => text.includes(secret));

// The console, captured for the run and never printed.
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const consoleSaved = {};
const consoleEntries = [];
function captureConsole() {
  for (const method of CONSOLE_METHODS) {
    consoleSaved[method] = console[method];
    console[method] = (...args) => consoleEntries.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a))).join(' '));
  }
}
function restoreConsole() {
  for (const method of CONSOLE_METHODS) if (consoleSaved[method]) console[method] = consoleSaved[method];
}
function safeJson(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sameInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b);

/** An owned regular file of mode 0600 or 0400 under dir, read with O_NOFOLLOW: its text. */
function readPrivate(dir, relative, maxBytes) {
  const file = path.join(dir, relative);
  if (path.relative(dir, file).startsWith('..')) throw new VerifyFailure('input_outside_the_runtime_directory');
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new VerifyFailure(`input_unreadable:${path.basename(relative)}`);
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile()) throw new VerifyFailure('input_not_a_regular_file');
    if (info.uid !== process.getuid()) throw new VerifyFailure('input_not_owned_by_this_user');
    if ((info.mode & 0o077) !== 0) throw new VerifyFailure('input_open_to_group_or_others');
    if (info.size > maxBytes) throw new VerifyFailure('input_too_large');
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** The runtime directory: an owned 0700 directory of this helper under .vps-runtime-20261018. */
function readStack(target) {
  if (typeof target !== 'string' || target === '') throw new VerifyFailure('runtime_directory_missing');
  let dir;
  try {
    dir = fs.realpathSync(target);
  } catch {
    throw new VerifyFailure('runtime_directory_missing');
  }
  const runtime = fs.realpathSync(RUNTIME_DIR);
  const info = fs.statSync(dir);
  if (path.dirname(dir) !== runtime || !path.basename(dir).startsWith(LABEL_PREFIX)) throw new VerifyFailure('runtime_directory_not_of_this_helper');
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new VerifyFailure('runtime_directory_not_private');
  const manifest = JSON.parse(readPrivate(dir, 'manifest.json', 1 << 20));
  if (manifest.label !== path.basename(dir)) throw new VerifyFailure('manifest_of_another_stack');
  const port = Number(manifest.port);
  check('input.port_is_a_high_port', Number.isInteger(port) && port >= 1024 && port <= 65535);
  const nameRE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.test$/;
  check('input.front_names_are_test_names', nameRE.test(manifest.api_host) && nameRE.test(manifest.auth_host) && manifest.api_host !== manifest.auth_host);
  check('input.issuer_and_audience_present', typeof manifest.issuer === 'string' && manifest.issuer.startsWith('https://') && manifest.audience === 'authenticated');
  const ca = readPrivate(dir, 'proxy-root.crt', 64 << 10);
  check('input.proxy_root_is_one_pem_certificate', /^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n?$/.test(ca) && ca.split('BEGIN CERTIFICATE').length === 2);
  const usersDir = path.join(dir, 'secrets', 'ops', 'users');
  const names = fs.readdirSync(usersDir).filter((name) => /^user-\d+\.json$/.test(name)).sort();
  check('input.two_prepared_users', names.length >= 2);
  const users = names.slice(0, 2).map((name) => {
    const body = JSON.parse(readPrivate(usersDir, name, 4096));
    remember(body.password);
    check('input.user_is_a_confirmed_synthetic_test_address', /^[a-z0-9.-]+@example\.test$/.test(body.email) && body.email_confirm === true && body.role === 'authenticated');
    return { email: body.email, password: body.password };
  });
  report.stack = { label: manifest.label, port };
  return {
    dir,
    label: manifest.label,
    port,
    apiHost: manifest.api_host,
    authHost: manifest.auth_host,
    appHost: manifest.app_host,
    issuer: manifest.issuer,
    audience: manifest.audience,
    ca: Buffer.from(ca),
    users,
  };
}

/** The report's path: a new file in an existing directory this user owns. */
function prepareReportPath(target) {
  if (typeof target !== 'string' || target === '') throw new VerifyFailure('report_path_missing');
  let parent;
  try {
    parent = fs.realpathSync(path.dirname(path.resolve(target)));
  } catch {
    throw new VerifyFailure('report_directory_missing');
  }
  const info = fs.statSync(parent);
  if (!info.isDirectory() || info.uid !== process.getuid()) throw new VerifyFailure('report_directory_not_owned');
  const file = path.join(parent, path.basename(target));
  if (fs.existsSync(file)) throw new VerifyFailure('report_path_exists');
  return file;
}

/**
 * The wire: every request goes to 127.0.0.1:<port> with the front's name as SNI and Host, trusting only the exported
 * root (or, for one check, nothing extra). Only the two front origins are accepted. Every request is recorded as origin,
 * method, route (path plus grant type or logout scope) and status; tokens a request carries or a grant returns join the
 * scrub list.
 */
function createWire(stack) {
  const records = [];
  const urls = [];
  const origins = new Map([
    [`https://${stack.apiHost}:${stack.port}`, 'api'],
    [`https://${stack.authHost}:${stack.port}`, 'auth'],
  ]);
  const originOf = (url) => {
    for (const [origin, name] of origins) if (url.startsWith(`${origin}/`)) return name;
    return null;
  };
  const routeOf = (parsed) => {
    const grant = parsed.searchParams.get('grant_type');
    const scope = parsed.searchParams.get('scope');
    if (!parsed.search) return parsed.pathname;
    if (grant) return `${parsed.pathname}?grant_type=${grant}`;
    if (scope) return `${parsed.pathname}?scope=${scope}`;
    return `${parsed.pathname}?(query)`;
  };

  function request(url, init = {}, { trustRoot = true, servername } = {}) {
    if (typeof url !== 'string') throw new VerifyFailure('wire_url_not_a_string');
    urls.push(url);
    const origin = originOf(url);
    if (!origin) throw new VerifyFailure('wire_refused_an_unapproved_origin');
    const parsed = new URL(url);
    const headers = new Headers(init.headers ?? {});
    const bearer = headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) remember(bearer.slice('Bearer '.length));
    let body;
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== 'string') throw new VerifyFailure('wire_body_not_a_string');
      body = Buffer.from(init.body, 'utf8');
      headers.set('content-length', String(body.length));
    }
    headers.set('host', parsed.host);
    const record = { origin, method: String(init.method ?? 'GET').toUpperCase(), route: routeOf(parsed), status: 0 };
    records.push(record);
    return new Promise((resolve, reject) => {
      const outgoing = {};
      headers.forEach((value, name) => {
        outgoing[name] = value;
      });
      const req = https.request({
        host: '127.0.0.1',
        port: stack.port,
        servername: servername ?? parsed.hostname,
        method: record.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers: outgoing,
        ca: trustRoot ? [stack.ca] : undefined,
        minVersion: 'TLSv1.2',
        agent: false,
      });
      const fail = (error) => {
        record.error = error?.code ?? 'error';
        reject(error);
      };
      const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), REQUEST_TIMEOUT_MS);
      const signal = init.signal;
      if (signal) {
        if (signal.aborted) req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
        else signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })), { once: true });
      }
      req.on('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      req.on('response', (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_REPLY_BYTES) req.destroy(Object.assign(new Error('reply too large'), { code: 'EFBIG' }));
          else chunks.push(chunk);
        });
        res.on('error', (error) => {
          clearTimeout(timer);
          fail(error);
        });
        res.on('end', () => {
          clearTimeout(timer);
          record.status = res.statusCode;
          const replyHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) replyHeaders.append(name, String(one));
          }
          const buffer = Buffer.concat(chunks);
          const nullBody = res.statusCode === 204 || res.statusCode === 205 || res.statusCode === 304;
          resolve(new Response(nullBody ? null : buffer, { status: res.statusCode, headers: replyHeaders }));
        });
      });
      if (body) req.write(body);
      req.end();
    });
  }

  /** The SDK's fetch: a token grant's tokens join the scrub list. */
  async function sdkFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const reply = await request(url, init);
    if (originOf(url) === 'auth' && reply.ok && new URL(url).pathname === '/token') {
      try {
        const body = await reply.clone().json();
        remember(body?.access_token);
        remember(body?.refresh_token);
      } catch {
        // an unreadable grant fails the SDK call, which the checks see
      }
    }
    return reply;
  }

  return { records, urls, originOf, request, sdkFetch };
}

/** One API call: status, headers and the JSON body (null when there is none). */
async function api(wire, stack, method, route, { token, raw, contentType = 'application/json', headers = {} } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (raw !== undefined) h['Content-Type'] = contentType;
  const reply = await wire.request(`https://${stack.apiHost}:${stack.port}${route}`, { method, headers: h, body: raw });
  const text = await reply.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: reply.status, headers: reply.headers, json };
}

/** One request to the Auth front outside the SDK: its status only. */
async function authStatus(wire, stack, method, route) {
  const reply = await wire.request(`https://${stack.authHost}:${stack.port}${route}`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
  await reply.arrayBuffer().catch(() => undefined);
  return reply.status;
}

/** Whether a TLS connection with these options is refused (a handshake or certificate error). */
async function tlsRefused(wire, stack, options) {
  try {
    const reply = await wire.request(`https://${stack.apiHost}:${stack.port}/v1/healthz`, {}, options);
    await reply.arrayBuffer().catch(() => undefined);
    return false;
  } catch {
    return true;
  }
}

/** The claims and header of a token this stack's Auth issued; only compared, never verified or printed. */
function decodeToken(token) {
  const [header, payload] = token.split('.');
  const decode = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  return { header: decode(header), claims: decode(payload) };
}

const passwordTime = (claims) => {
  const entries = Array.isArray(claims.amr) ? claims.amr.filter((entry) => entry?.method === 'password') : [];
  return entries.length ? Math.max(...entries.map((entry) => entry.timestamp)) : null;
};

/** An Expo v2 four-choice answer envelope exactly in the stored client shape (as harness_test.go's default answer). */
function answerEnvelope({ id, learner, install, at }) {
  const timestamp = at.toISOString();
  const date = timestamp.slice(0, 10);
  const payload =
    `{"answer_id":"${id}","learner_id":"${learner}","item_id":"A3-M01","content_version":"demo-synthetic-0.3",` +
    `"rules_version":"pilot-0.3-local","app_version":"0.3.0","timestamp":"${timestamp}","local_date":"${date}",` +
    `"session_id":"ses-p8-1","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],` +
    `"raw_response":"{\\"kind\\":\\"choice\\",\\"option_id\\":\\"k\\"}","auto_score":{"answer":"correct"},` +
    `"outcome":"correct","error_tags":[],"serious_tag":null,"hint_used":false,"help_lines_shown":[],` +
    `"first_attempt":true,"fresh_evidence":true,"time_on_item_ms":5300,"audio_status":null,"report_flag":false,` +
    `"review_status":"draft","synthetic":true,"answer_schema":2,"evidence_mode":"recognition-4",` +
    `"lineage":"A:word-form:${SADIQUN}","role":"practice","presented_options":[{"id":"d2","text":"sahabat","position":0},` +
    `{"id":"d3","text":"orang yang sakit","position":1},{"id":"k","text":"orang yang jujur","position":2},` +
    `{"id":"d1","text":"orang yang bersedekah","position":3}],"selected_option_id":"k","selected_position":2,"misconceptions":[]}`;
  return (
    `{"envelope_version":1,"event_id":"${id}","kind":"answer","schema":"expo.answer_record","schema_version":2,` +
    `"curriculum":{"family":"${FAMILY}","track":"arab","content_version":"demo-synthetic-0.3","rules_version":"pilot-0.3-local"},` +
    `"source":{"app":"expo","install_id":"${install}","app_version":"0.3.0","local_profile_id":"${learner}"},"payload":${payload}}`
  );
}

function newClient(sdk, stack, wire) {
  return new sdk.AuthClient({
    url: `https://${stack.authHost}:${stack.port}`,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    debug: false,
    fetch: wire.sdkFetch,
    storageKey: `aya-p8-verify-${hex(4)}`,
  });
}

async function signIn(sdk, stack, wire, user, key) {
  const client = newClient(sdk, stack, wire);
  const from = wire.records.length;
  const { data, error } = await client.signInWithPassword({ email: user.email, password: user.password });
  const grants = wire.records.slice(from).filter((r) => r.route === '/token?grant_type=password');
  report.statuses[`${key}_password_grant`] = grants.map((r) => r.status);
  check(`${key}.sdk_password_sign_in`, !error && typeof data?.session?.access_token === 'string' && grants.length === 1 && grants[0].status === 200);
  remember(data.session.access_token);
  remember(data.session.refresh_token);
  return { client, session: data.session };
}

async function runScenarios(state, stack, sdk) {
  const { wire } = state;
  const call = (method, route, options) => api(wire, stack, method, route, options);
  const step = (name) => {
    state.step = name;
  };
  const [userA, userB] = stack.users;
  let r;

  // The front.
  step('front');
  r = await call('GET', '/v1/healthz');
  report.statuses.front_health = r.status;
  check('front.api_health_200_local_compose', r.status === 200 && r.json?.status === 'ok' && r.json?.mode === 'local-compose');
  check('front.api_answers_no_store_nosniff', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');
  const hsts = /^max-age=(\d+)/.exec(r.headers.get('strict-transport-security') ?? '');
  check('front.api_asks_browsers_for_https_at_least_a_day', hsts !== null && Number(hsts[1]) >= 86400);
  r = await call('GET', '/v1/readyz');
  report.statuses.front_readiness = r.status;
  check('front.api_ready', r.status === 200 && r.json?.status === 'ready');
  r = await call('GET', '/v1/me');
  report.statuses.front_me_without_token = r.status;
  check('front.api_no_token_uniform_401', r.status === 401 && r.json?.code === 'unauthenticated');
  r = await call('OPTIONS', '/v1/me', { headers: { Origin: `https://${stack.appHost}`, 'Access-Control-Request-Method': 'GET' } });
  report.statuses.front_preflight = r.status;
  check('front.api_grants_no_web_origin', r.status === 403 && r.json?.code === 'origin_not_allowed' && !r.headers.get('access-control-allow-origin'));
  const blocked = {};
  for (const [method, route] of [
    ['GET', '/admin/users'],
    ['POST', '/admin/users'],
    ['POST', '/signup'],
    ['GET', '/settings'],
    ['GET', '/.well-known/jwks.json'],
    ['GET', '/health'],
    ['POST', '/otp'],
    ['POST', '/recover'],
    ['GET', '/verify'],
    ['POST', '/invite'],
    ['GET', '/token'],
  ]) {
    blocked[`${method} ${route}`] = await authStatus(wire, stack, method, route);
  }
  report.statuses.front_auth_routes_not_served = blocked;
  check('front.auth_serves_only_the_sdk_routes', Object.values(blocked).every((status) => status === 404));
  check('front.no_certificate_for_another_name', await tlsRefused(wire, stack, { servername: `unknown-${hex(3)}.ayailmu-local.test` }));
  check('front.nothing_trusted_without_the_exported_root', await tlsRefused(wire, stack, { trustRoot: false }));

  // A: password sign-in, account, import with consent, profile, patch, upload, pull, progress, refresh, export.
  step('a.sign_in');
  const a = await signIn(sdk, stack, wire, userA, 'a');
  state.clients.push(a.client);
  const tokenA1 = a.session.access_token;
  const refreshA1 = a.session.refresh_token;
  const { header: headerA, claims: claimsA } = decodeToken(tokenA1);
  const audience = Array.isArray(claimsA.aud) ? claimsA.aud : [claimsA.aud];
  check('a.token_names_the_stack_issuer_audience_and_role', claimsA.iss === stack.issuer && audience.includes(stack.audience) && claimsA.role === 'authenticated');
  check('a.token_is_es256_with_a_key_id', headerA.alg === 'ES256' && typeof headerA.kid === 'string' && headerA.kid.length > 0);
  check('a.token_has_a_session_and_a_password_sign_in_time', UUID.test(claimsA.session_id ?? '') && passwordTime(claimsA) !== null && claimsA.is_anonymous === false);
  const userIdA = claimsA.sub;
  check('a.subject_is_a_user_id', UUID.test(userIdA));
  const gotA = await a.client.getUser();
  check('a.sdk_get_user_through_the_front', !gotA.error && gotA.data?.user?.id === userIdA);

  step('a.me');
  r = await call('GET', '/v1/me', { token: tokenA1 });
  report.statuses.a_me = r.status;
  check('a.me_200_a_new_account_without_profiles', r.status === 200 && UUID.test(r.json?.account_id ?? '') && Array.isArray(r.json?.profiles) && r.json.profiles.length === 0);
  const accountA = r.json.account_id;

  step('a.import');
  const source = { app: 'expo', install_id: `inst-p8-${hex(8)}`, local_profile_id: `lrn-p8-${hex(8)}` };
  const at = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
  const firstEvent = `evt-p8-${hex(10)}`;
  const envelope1 = answerEnvelope({ id: firstEvent, learner: source.local_profile_id, install: source.install_id, at });
  const newAdult = `{"new_profile":{"kind":"adult","settings":{"instruction_lang":"id","session_minutes":10,"arabic_scale":1.25},"consent":${JSON.stringify(CONSENT)}}}`;
  const importBody =
    `{"import_id":"imp-p8-${hex(10)}","source":${JSON.stringify(source)},"target":${newAdult},"events":[${envelope1}]}`;
  r = await call('POST', '/v1/imports', { token: tokenA1, raw: importBody });
  report.statuses.a_import = r.status;
  check('a.import_201_new_adult_profile_one_event', r.status === 201 && r.json?.profile_created === true && r.json?.replayed === false && r.json?.stored === 1);
  check('a.import_receipt_checksum_matches', r.json.event_ids_sha256 === sha256(firstEvent));
  const pid = r.json.profile_id;
  check('a.import_profile_is_a_uuid', UUID.test(pid ?? ''));
  r = await call('POST', '/v1/imports', { token: tokenA1, raw: importBody });
  report.statuses.a_import_replay = r.status;
  check('a.import_replay_200_same_receipt', r.status === 200 && r.json?.replayed === true && r.json?.profile_id === pid && r.json?.stored === 1);

  step('a.profile');
  r = await call('GET', `/v1/profiles/${pid}`, { token: tokenA1 });
  report.statuses.a_profile = r.status;
  check('a.profile_is_adult_with_the_consent', r.status === 200 && r.json?.kind === 'adult' && r.json?.consent?.version === CONSENT.version && sameInstant(r.json?.consent?.at, CONSENT.at));
  check('a.profile_links_the_source', Array.isArray(r.json?.sources) && r.json.sources.length === 1 && r.json.sources[0].install_id === source.install_id);
  const etag = r.headers.get('etag');
  check('a.profile_etag_is_revision_1', etag === '"r1"');
  r = await call('PATCH', `/v1/profiles/${pid}`, {
    token: tokenA1,
    raw: '{"settings":{"session_minutes":15}}',
    contentType: 'application/merge-patch+json',
    headers: { 'If-Match': etag },
  });
  report.statuses.a_patch = r.status;
  check('a.settings_patch_200_revision_2', r.status === 200 && r.json?.revision === 2 && r.json?.settings?.session_minutes === 15);

  step('a.events');
  const secondEvent = `evt-p8-${hex(10)}`;
  const envelope2 = answerEnvelope({ id: secondEvent, learner: source.local_profile_id, install: source.install_id, at: new Date(at.getTime() + 60_000) });
  r = await call('POST', `/v1/profiles/${pid}/events`, { token: tokenA1, raw: `{"events":[${envelope2}]}` });
  report.statuses.a_upload = r.status;
  check('a.event_upload_stored', r.status === 200 && r.json?.results?.length === 1 && r.json.results[0].result === 'stored');
  r = await call('GET', `/v1/profiles/${pid}/events?after=0`, { token: tokenA1 });
  report.statuses.a_pull = r.status;
  check('a.pull_returns_both_events_in_order', r.status === 200 && r.json?.events?.length === 2 && r.json.events[0].event_id === firstEvent && r.json.events[1].event_id === secondEvent);
  r = await call('GET', `/v1/profiles/${pid}/progress?family=${FAMILY}`, { token: tokenA1 });
  report.statuses.a_progress = r.status;
  check('a.progress_counts_both_events', r.status === 200 && r.json?.events === 2);

  step('a.refresh');
  let from = wire.records.length;
  const refreshed = await a.client.refreshSession();
  const refreshGrants = wire.records.slice(from).filter((rec) => rec.route === '/token?grant_type=refresh_token');
  report.statuses.a_refresh_grant = refreshGrants.map((rec) => rec.status);
  check('a.sdk_refresh_grant_200', !refreshed.error && refreshGrants.some((rec) => rec.status === 200));
  check('a.refresh_made_no_password_grant', !wire.records.slice(from).some((rec) => rec.route === '/token?grant_type=password'));
  const tokenA2 = refreshed.data.session.access_token;
  remember(tokenA2);
  remember(refreshed.data.session.refresh_token);
  const claimsA2 = decodeToken(tokenA2).claims;
  check('a.refresh_renews_the_token_for_the_same_user_and_session', tokenA2 !== tokenA1 && claimsA2.sub === userIdA && claimsA2.session_id === claimsA.session_id);
  check('a.refresh_keeps_the_password_sign_in_time', passwordTime(claimsA2) === passwordTime(claimsA));
  r = await call('GET', '/v1/me', { token: tokenA2 });
  report.statuses.a_me_after_refresh = r.status;
  check('a.me_after_refresh_same_account_one_profile', r.status === 200 && r.json?.account_id === accountA && r.json?.profiles?.length === 1 && r.json.profiles[0].profile_id === pid);

  step('a.export');
  r = await call('GET', '/v1/me/export', { token: tokenA2 });
  report.statuses.a_export = r.status;
  check('a.export_200', r.status === 200);
  check('a.export_account_is_local_supabase_under_the_stack_issuer', r.json?.account?.account_id === accountA && r.json?.account?.auth_mode === 'local-supabase' && r.json?.account?.issuer === stack.issuer && r.json?.account?.subject === userIdA);
  check('a.export_holds_the_one_profile_and_both_events', r.json?.profiles?.length === 1 && r.json.profiles[0].events?.length === 2 && r.json.profiles[0].consent?.version === CONSENT.version);

  // B: its own account; A's profile is the same 404 on every route.
  step('b.sign_in');
  const b = await signIn(sdk, stack, wire, userB, 'b');
  state.clients.push(b.client);
  const tokenB = b.session.access_token;
  r = await call('GET', '/v1/me', { token: tokenB });
  report.statuses.b_me = r.status;
  check('b.me_200_its_own_account_without_profiles', r.status === 200 && UUID.test(r.json?.account_id ?? '') && r.json.account_id !== accountA && r.json?.profiles?.length === 0);
  const accountB = r.json.account_id;
  step('b.isolation');
  const isolation = {};
  isolation.profile = (await call('GET', `/v1/profiles/${pid}`, { token: tokenB })).status;
  isolation.events = (await call('GET', `/v1/profiles/${pid}/events?after=0`, { token: tokenB })).status;
  isolation.progress = (await call('GET', `/v1/profiles/${pid}/progress?family=${FAMILY}`, { token: tokenB })).status;
  isolation.patch = (await call('PATCH', `/v1/profiles/${pid}`, { token: tokenB, raw: '{"settings":{"session_minutes":20}}', contentType: 'application/merge-patch+json', headers: { 'If-Match': '"r2"' } })).status;
  isolation.upload = (await call('POST', `/v1/profiles/${pid}/events`, { token: tokenB, raw: `{"events":[]}` })).status;
  const sourceB = { app: 'expo', install_id: `inst-p8-${hex(8)}`, local_profile_id: `lrn-p8-${hex(8)}` };
  isolation.import_into = (await call('POST', '/v1/imports', { token: tokenB, raw: `{"import_id":"imp-p8-${hex(10)}","source":${JSON.stringify(sourceB)},"target":{"profile_id":"${pid}"},"events":[]}` })).status;
  report.statuses.b_on_a_profile = isolation;
  check('b.every_route_on_a_profile_is_404', Object.values(isolation).every((status) => status === 404));
  r = await call('GET', `/v1/profiles/${pid}`, { token: tokenA2 });
  check('a.profile_unchanged_by_b', r.status === 200 && r.json?.revision === 2 && r.json?.settings?.session_minutes === 15);

  // A's local logout: the provider revokes the session, so both of its access tokens and its refresh token are dead.
  step('a.logout');
  from = wire.records.length;
  const out = await a.client.signOut({ scope: 'local' });
  const logouts = wire.records.slice(from).filter((rec) => rec.route.startsWith('/logout'));
  report.statuses.a_local_logout = logouts.map((rec) => `${rec.route} ${rec.status}`);
  check('a.local_logout_accepted_by_auth_204', !out.error && logouts.length === 1 && logouts[0].route === '/logout?scope=local' && logouts[0].status === 204);
  const old = [(await call('GET', '/v1/me', { token: tokenA1 })).status, (await call('GET', '/v1/me', { token: tokenA2 })).status];
  report.statuses.a_old_tokens_after_logout = old;
  check('a.old_access_tokens_get_api_401', old[0] === 401 && old[1] === 401);
  from = wire.records.length;
  const stale = await newClient(sdk, stack, wire).refreshSession({ refresh_token: refreshed.data.session.refresh_token });
  const staleGrant = wire.records.slice(from).filter((rec) => rec.route === '/token?grant_type=refresh_token');
  report.statuses.a_old_refresh_after_logout = staleGrant.map((rec) => rec.status);
  check('a.old_refresh_token_refused', Boolean(stale.error) && !stale.data?.session && staleGrant.length >= 1 && staleGrant.every((rec) => rec.status >= 400 && rec.status < 500));
  from = wire.records.length;
  const staler = await newClient(sdk, stack, wire).refreshSession({ refresh_token: refreshA1 });
  report.statuses.a_first_refresh_token_after_logout = wire.records.slice(from).filter((rec) => rec.route === '/token?grant_type=refresh_token').map((rec) => rec.status);
  check('a.first_refresh_token_refused', Boolean(staler.error) && !staler.data?.session);

  // Each user signs in again (the same account) and deletes its account through the API.
  for (const [key, user, account, userId] of [
    ['a', userA, accountA, userIdA],
    ['b', userB, accountB, decodeToken(tokenB).claims.sub],
  ]) {
    step(`${key}.delete`);
    const again = await signIn(sdk, stack, wire, user, `${key}_again`);
    state.clients.push(again.client);
    const token = again.session.access_token;
    r = await call('GET', '/v1/me', { token });
    check(`${key}.signs_in_again_to_the_same_account`, r.status === 200 && r.json?.account_id === account && decodeToken(token).claims.sub === userId);
    r = await call('POST', '/v1/me/deletion', { token, raw: JSON.stringify({ confirm: 'delete-account', account_id: account }) });
    report.statuses[`${key}_deletion`] = r.status;
    check(`${key}.deletion_200_completed`, r.status === 200 && r.json?.status === 'completed' && r.json?.account_id === account);
    check(`${key}.deletion_erased_server_data_and_deleted_the_identity`, r.json?.server_data?.status === 'erased' && r.json?.identity_provider?.status === 'deleted');
    r = await call('GET', '/v1/me', { token });
    report.statuses[`${key}_token_after_deletion`] = r.status;
    check(`${key}.token_after_deletion_gets_api_401`, r.status === 401 && r.json?.code === 'unauthenticated');
    from = wire.records.length;
    const denied = await newClient(sdk, stack, wire).signInWithPassword({ email: user.email, password: user.password });
    const grants = wire.records.slice(from).filter((rec) => rec.route === '/token?grant_type=password');
    report.statuses[`${key}_password_after_deletion`] = grants.map((rec) => rec.status);
    check(`${key}.password_no_longer_signs_in`, Boolean(denied.error) && !denied.data?.session && grants.length === 1 && grants[0].status >= 400 && grants[0].status < 500);
    state.deleted.push(key);
  }
}

function finalChecks(state) {
  const { wire } = state;
  check('wire.only_the_two_front_origins', wire.urls.every((url) => wire.originOf(url) !== null));
  check('wire.no_password_or_token_in_any_url', !wire.urls.some(containsSecret));
  check('wire.never_a_global_logout', !wire.records.some((rec) => rec.route.startsWith('/logout') && rec.route !== '/logout?scope=local'));
  check('console.nothing_secret_logged', !consoleEntries.some(containsSecret));
  check('process.no_unhandled_rejection', (report.counts.unhandledRejections ?? 0) === 0);
}

function summarize(state) {
  const { wire } = state;
  if (wire) {
    const byRoute = {};
    for (const rec of wire.records) {
      const key = `${rec.origin} ${rec.method} ${rec.route} ${rec.status || rec.error || 'none'}`;
      byRoute[key] = (byRoute[key] ?? 0) + 1;
    }
    Object.assign(report.counts, {
      requests: wire.records.length,
      authRequests: wire.records.filter((rec) => rec.origin === 'auth').length,
      apiRequests: wire.records.filter((rec) => rec.origin === 'api').length,
      byRoute,
      urlsCarryingASecret: wire.urls.filter(containsSecret).length,
    });
  }
  report.counts.consoleEntries = consoleEntries.length;
  report.counts.consoleEntriesCarryingASecret = consoleEntries.filter(containsSecret).length;
  report.counts.secretsTracked = secrets.size;
  report.counts.usersDeletedThroughTheApi = state.deleted.length;
  report.checksPassed = report.checks.filter((c) => c.pass).length;
  report.checksTotal = report.checks.length;
}

/** Ends what the run still holds, on this device only: every SDK client that still has a session signs out locally. */
async function cleanup(state) {
  const done = { localSignOuts: 0, failures: 0 };
  for (const client of state.clients) {
    try {
      const { data } = await client.getSession();
      if (data?.session) {
        const { error } = await client.signOut({ scope: 'local' });
        if (error) done.failures += 1;
        else done.localSignOuts += 1;
      }
    } catch {
      done.failures += 1;
    }
  }
  return done;
}

function describeFailure(error, step) {
  if (error instanceof VerifyFailure) return { check: error.message, step };
  // No message: it could quote a reply.
  return { unexpected: typeof error?.code === 'string' ? error.code : typeof error?.name === 'string' ? error.name : typeof error, step };
}

async function main() {
  const [runtimeArg, reportArg] = process.argv.slice(2);
  let reportPath;
  try {
    reportPath = prepareReportPath(reportArg);
  } catch (error) {
    const why = error instanceof VerifyFailure ? error.message : 'report_path_unusable';
    process.stdout.write(`verify-stack: FAIL before running (${why}); nothing was read or contacted\n`);
    process.exitCode = 2;
    return;
  }
  const state = { step: 'start', wire: null, clients: [], deleted: [] };
  process.on('unhandledRejection', () => {
    report.counts.unhandledRejections = (report.counts.unhandledRejections ?? 0) + 1;
  });
  captureConsole();
  let stack = null;
  try {
    state.step = 'load_sdk';
    const appRequire = createRequire(path.join(APP_DIR, 'package.json'));
    const sdkDir = fs.realpathSync(path.join(APP_DIR, 'node_modules', '@supabase', 'auth-js'));
    if (!fs.realpathSync(appRequire.resolve(SDK_PACKAGE)).startsWith(`${sdkDir}${path.sep}`)) throw new VerifyFailure('sdk_outside_the_app');
    report.authJs = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8')).version;
    check('sdk.is_the_installed_auth_js_2.118.0', report.authJs === EXPECTED_AUTH_JS);
    const sdk = appRequire(SDK_PACKAGE);
    state.step = 'read_stack';
    stack = readStack(runtimeArg);
    state.wire = createWire(stack);
    await runScenarios(state, stack, sdk);
    state.step = 'final_checks';
    finalChecks(state);
    report.result = 'pass';
  } catch (error) {
    report.failure = describeFailure(error, state.step);
  } finally {
    report.cleanup = await cleanup(state);
    if (report.cleanup.failures > 0) {
      report.result = 'fail';
      report.failure ??= { check: 'cleanup_incomplete', step: 'cleanup' };
    }
    restoreConsole();
    summarize(state);
    report.finishedAt = new Date().toISOString();
    let json = JSON.stringify(report, null, 2);
    if (containsSecret(json)) {
      report.result = 'fail';
      report.failure = { check: 'report_would_have_carried_a_secret', step: 'report' };
      json = JSON.stringify(report, null, 2);
      for (const secret of secrets) json = json.split(secret).join('[redacted]');
    }
    secrets.clear();
    if (stack) stack.users.length = 0;
    if (state.wire) state.wire.urls.length = 0;
    consoleEntries.length = 0;
    try {
      fs.writeFileSync(reportPath, `${json}\n`, { flag: 'wx', mode: 0o600 });
    } catch {
      report.result = 'fail';
      reportPath = null;
    }
    const where = report.failure ? ` at ${report.failure.check ?? report.failure.unexpected} (${report.failure.step})` : '';
    process.stdout.write(
      `verify-stack: ${report.result === 'pass' ? 'PASS' : 'FAIL'}${where}; ${report.checksPassed}/${report.checksTotal} checks passed; ` +
        `${reportPath ? `report: ${reportPath}` : 'the report could not be written'}\n`
    );
    process.exitCode = report.result === 'pass' ? 0 : 1;
  }
}

main().catch(() => {
  process.stdout.write('verify-stack: FAIL (internal error)\n');
  process.exitCode = 3;
});
