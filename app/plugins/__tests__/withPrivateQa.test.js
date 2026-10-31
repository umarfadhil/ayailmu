// Regression contract for the private native QA build plugin (plugins/withPrivateQa.js), frozen before its
// implementation. Everything runs in memory: the filesystem and the certificate parser are injected `io` seams, so no
// certificate or key is generated, no real secret or CA file is read, nothing is prebuilt and nothing native runs.
//
// MOCK PLANNING PROOF ONLY: every accepted case feeds bytes that are not a certificate to a parser stub that claims a
// CA. It proves the plugin's decisions given a parser verdict; it is not real TLS, a real CA or a generated build.
//
// Reversible interface choices, explicit so they can be revisited before freezing:
// - resolvePrivateQaBuild(config, env, io?) never mutates `config` and returns a frozen { config, build }: build is null
//   for every ordinary profile, or a frozen { apiOrigin, authOrigin, caSha256, der } for the private one.
// - Only EXPO_PUBLIC_ACCOUNT_ENV exactly "private-qa" selects the private build; with anything else off it throws rather
//   than falling back to an ordinary build. Messages mention "private QA" and never the CA path, certificate bytes or
//   a parser's message; their wording is not frozen.
// - Resolve io: { readFileSync(file) -> Buffer, parseCertificate(bytes) -> { ca, validFrom, validTo, raw }, now() -> Date },
//   shaped like node's crypto.X509Certificate (validFrom/validTo strings, raw DER Buffer). The plugin hashes raw itself.
// - The CA file must be PEM with exactly one CERTIFICATE block and no PRIVATE KEY block, checked before parsing.
// - Apply io: { mkdirSync, writeFileSync, rmSync } with node fs semantics; paths are joined onto projectRoot (app/).
//   An ordinary build removes its own two files for the platform with rmSync(file, { force: true }), never recursively.
// - withPrivateQa reads process.env whole and registers only the ios and android dangerous mods.
const crypto = require('crypto');
const path = require('path');

const withPrivateQa = require('../withPrivateQa');
const { applyPrivateQaResources, resolvePrivateQaBuild } = require('../withPrivateQa');

// The exact private profile (account/privateQa.ts, account/supabaseConfig.ts), restated so the contract is explicit.
const API = 'https://localhost:58444';
const AUTH = 'https://localhost:58445';
const PROJECT_ROOT = '/mock/checkout/app';
const CA_PATH = '/mock/outside/mock-planning-ca.pem';

// Mock planning bytes, not a certificate: the parser stub decides what they "are".
const MOCK_PEM_BODY = Buffer.from('mock-planning-pem-not-a-certificate').toString('base64');
const pemBlock = (label, body = MOCK_PEM_BODY) => `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
const MOCK_PEM = pemBlock('CERTIFICATE');
const MOCK_DER = Buffer.from('mock-planning-der-not-a-certificate');
const MOCK_SHA = crypto.createHash('sha256').update(MOCK_DER).digest('hex');
const NOW = new Date('2026-10-26T00:00:00Z');
const MOCK_CA = Object.freeze({ ca: true, validFrom: 'Oct  1 00:00:00 2026 GMT', validTo: 'Oct  1 00:00:00 2027 GMT', raw: MOCK_DER });

const PRIVATE_ENV = Object.freeze({
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
  AYA_PRIVATE_QA_CA_PATH: CA_PATH,
  AYA_PRIVATE_QA_CA_SHA256: MOCK_SHA,
});
const CA_ENV = { AYA_PRIVATE_QA_CA_PATH: CA_PATH, AYA_PRIVATE_QA_CA_SHA256: MOCK_SHA };

// The plugin's own generated files, relative to the app directory.
const MODULE = 'modules/aya-private-qa-transport';
const owned = (dir) => ['aya-private-qa-ca.der', 'aya-private-qa-binding.json'].map((name) => path.join(PROJECT_ROOT, MODULE, dir, name));
const OWNED = { ios: owned('ios/Resources'), android: owned('android/src/main/assets') };
const UNRELATED = [
  'expo-module.config.json',
  'index.ts',
  'ios/AyaPrivateQaTransport.swift',
  'ios/Resources/unrelated.txt',
  'android/build.gradle',
  'android/src/main/assets/unrelated.txt',
].map((rel) => path.join(PROJECT_ROOT, MODULE, rel));

const MOCK_BUILD = Object.freeze({ apiOrigin: API, authOrigin: AUTH, caSha256: MOCK_SHA, der: MOCK_DER });
const LEAKS = [CA_PATH, path.basename(CA_PATH), MOCK_PEM_BODY, MOCK_DER.toString('hex'), MOCK_DER.toString('base64'), 'parser-detail'];

const clone = (value) => JSON.parse(JSON.stringify(value));

function baseConfig() {
  return {
    name: 'MockApp',
    slug: 'mock-app',
    extra: { appMode: 'tester', router: { origin: false }, ayaPrivateQa: { caSha256: 'stale', caPath: '/stale/ca.pem' } },
    ios: { bundleIdentifier: 'test.mock.app', infoPlist: { ITSAppUsesNonExemptEncryption: false } },
    android: { package: 'test.mock.app', blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'] },
  };
}

/** `config` with only extra.ayaPrivateQa replaced by `privateQa` (or dropped when undefined). */
function expectedConfig(config, privateQa) {
  const extra = { ...config.extra };
  delete extra.ayaPrivateQa;
  return { ...config, extra: privateQa === undefined ? extra : { ...extra, ayaPrivateQa: privateQa } };
}

/** An in-memory CA source: only CA_PATH exists, holding `text`; the parser stub returns `parsed` (or throws it). */
function caIo({ text = MOCK_PEM, parsed = MOCK_CA } = {}) {
  return {
    readFileSync: jest.fn((file) => {
      if (file !== CA_PATH) throw new Error('ENOENT (mock)');
      return Buffer.from(text);
    }),
    parseCertificate: jest.fn(() => {
      if (parsed instanceof Error) throw parsed;
      return parsed;
    }),
    now: jest.fn(() => new Date(NOW)),
  };
}

/** An in-memory module tree: unrelated module files, plus stale generated files for both platforms. */
function memoryFs() {
  const files = new Map(UNRELATED.map((file) => [file, Buffer.from(`keep ${file}`)]));
  for (const file of [...OWNED.ios, ...OWNED.android]) files.set(file, Buffer.from('stale'));
  return {
    files,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn((file, data) => files.set(file, Buffer.from(data))),
    rmSync: jest.fn((file) => files.delete(file)),
  };
}

function expectGenericFailure(run) {
  let failure;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toMatch(/private QA/i);
  for (const leak of LEAKS) expect(failure.message).not.toContain(leak);
}

const expectNoCaRead = (io) => {
  expect(io.readFileSync).not.toHaveBeenCalled();
  expect(io.parseCertificate).not.toHaveBeenCalled();
};

describe('resolvePrivateQaBuild: ordinary builds', () => {
  test.each([
    ['local default', { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' }],
    ['staging', { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'staging' }],
    // As in loadSupabaseConfig, the private flag changes nothing outside the exact private profile.
    ['production with the private flag on', { ...PRIVATE_ENV, EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' }],
    ['the private flag without the private profile', { ...PRIVATE_ENV, EXPO_PUBLIC_ACCOUNT_ENV: undefined }],
  ])('%s: drops only extra.ayaPrivateQa, keeps every other field and never reads a CA', (_, env) => {
    const io = caIo();
    const input = baseConfig();
    const snapshot = clone(input);

    const result = resolvePrivateQaBuild(input, { ...env, ...CA_ENV }, io);

    expect(Object.isFrozen(result)).toBe(true);
    expect(result.build).toBeNull();
    expect(result.config).toStrictEqual(expectedConfig(snapshot));
    expect(input).toStrictEqual(snapshot);
    expectNoCaRead(io);
  });
});

describe('resolvePrivateQaBuild: the exact private profile (mock planning proof, not real TLS/CA)', () => {
  test.each([
    ['provider unset', { EXPO_PUBLIC_AUTH_PROVIDER: undefined }],
    ['another provider', { EXPO_PUBLIC_AUTH_PROVIDER: 'supabase' }],
    ['private flag unset', { EXPO_PUBLIC_PRIVATE_QA: undefined }],
    ['private flag not exactly on', { EXPO_PUBLIC_PRIVATE_QA: 'true' }],
    ['production flag on', { EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' }],
    ['API with a trailing slash', { EXPO_PUBLIC_API_BASE_URL: `${API}/` }],
    ['API on another host spelling', { EXPO_PUBLIC_API_BASE_URL: 'https://127.0.0.1:58444' }],
    ['Auth over http', { EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://localhost:58445' }],
    ['Auth on the API root', { EXPO_PUBLIC_SUPABASE_AUTH_URL: API }],
  ])('%s: rejected generically before any CA read', (_, drift) => {
    const io = caIo();
    expectGenericFailure(() => resolvePrivateQaBuild(baseConfig(), { ...PRIVATE_ENV, ...drift }, io));
    expectNoCaRead(io);
  });

  test.each([
    ['absent', undefined],
    ['empty', ''],
    ['exactly off', 'off'],
  ])('production flag %s is accepted', (_, flag) => {
    const { build } = resolvePrivateQaBuild(baseConfig(), { ...PRIVATE_ENV, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: flag }, caIo());
    expect(build).toMatchObject({ apiOrigin: API, authOrigin: AUTH, caSha256: MOCK_SHA });
  });

  test.each([
    ['CA path unset', { AYA_PRIVATE_QA_CA_PATH: undefined }],
    ['CA path empty', { AYA_PRIVATE_QA_CA_PATH: '' }],
    ['fingerprint unset', { AYA_PRIVATE_QA_CA_SHA256: undefined }],
    ['fingerprint uppercase', { AYA_PRIVATE_QA_CA_SHA256: MOCK_SHA.toUpperCase() }],
    ['fingerprint 63 digits', { AYA_PRIVATE_QA_CA_SHA256: MOCK_SHA.slice(1) }],
    ['fingerprint with a prefix', { AYA_PRIVATE_QA_CA_SHA256: `sha256:${MOCK_SHA}` }],
    [
      'only EXPO_PUBLIC_-prefixed CA variables',
      {
        AYA_PRIVATE_QA_CA_PATH: undefined,
        AYA_PRIVATE_QA_CA_SHA256: undefined,
        EXPO_PUBLIC_AYA_PRIVATE_QA_CA_PATH: CA_PATH,
        EXPO_PUBLIC_AYA_PRIVATE_QA_CA_SHA256: MOCK_SHA,
      },
    ],
  ])('%s: rejected generically without reading the CA', (_, ca) => {
    const io = caIo();
    expectGenericFailure(() => resolvePrivateQaBuild(baseConfig(), { ...PRIVATE_ENV, ...ca }, io));
    expectNoCaRead(io);
  });

  test('a stub-parsed CA yields a frozen build and publishes only extra.ayaPrivateQa.caSha256', () => {
    const io = caIo();
    const input = baseConfig();
    const snapshot = clone(input);

    const result = resolvePrivateQaBuild(input, PRIVATE_ENV, io);

    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(io.readFileSync.mock.calls[0][0]).toBe(CA_PATH);
    expect(io.parseCertificate).toHaveBeenCalledTimes(1);
    expect(Buffer.from(io.parseCertificate.mock.calls[0][0]).toString('utf8')).toBe(MOCK_PEM);

    expect(Object.isFrozen(result)).toBe(true);
    const { build, config } = result;
    expect(Object.isFrozen(build)).toBe(true);
    expect(Object.keys(build).sort()).toEqual(['apiOrigin', 'authOrigin', 'caSha256', 'der']);
    expect(build).toMatchObject({ apiOrigin: API, authOrigin: AUTH, caSha256: MOCK_SHA });
    expect(Buffer.isBuffer(build.der) && build.der.equals(MOCK_DER)).toBe(true);

    // ios and android stay exactly as given: no ATS exception, network security config or permission change.
    expect(config).toStrictEqual(expectedConfig(snapshot, { caSha256: MOCK_SHA }));
    expect(input).toStrictEqual(snapshot);
    const published = JSON.stringify(config);
    for (const leak of LEAKS) expect(published).not.toContain(leak);
  });

  test.each([
    ['two certificates', MOCK_PEM + MOCK_PEM],
    ['a certificate with a private key', MOCK_PEM + pemBlock('PRIVATE KEY')],
    ['an EC private key alone', pemBlock('EC PRIVATE KEY')],
    ['no PEM certificate', 'mock-planning-not-pem'],
    ['an empty file', ''],
  ])('%s: rejected generically before parsing', (_, text) => {
    const io = caIo({ text });
    expectGenericFailure(() => resolvePrivateQaBuild(baseConfig(), PRIVATE_ENV, io));
    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(io.parseCertificate).not.toHaveBeenCalled();
  });

  test.each([
    ['an unparseable certificate', { parsed: new Error(`parser-detail ${MOCK_PEM_BODY}`) }],
    ['a non-CA certificate', { parsed: { ...MOCK_CA, ca: false } }],
    ['an expired certificate', { parsed: { ...MOCK_CA, validTo: 'Oct 25 00:00:00 2026 GMT' } }],
    ['a not-yet-valid certificate', { parsed: { ...MOCK_CA, validFrom: 'Oct 27 00:00:00 2026 GMT' } }],
    ['unreadable validity dates', { parsed: { ...MOCK_CA, validFrom: 'not a date' } }],
    ['no DER bytes', { parsed: { ...MOCK_CA, raw: undefined } }],
    ['a DER fingerprint mismatch', { parsed: MOCK_CA, sha: 'a'.repeat(64) }],
  ])('%s: rejected generically', (_, { parsed, sha = MOCK_SHA }) => {
    const io = caIo({ parsed });
    expectGenericFailure(() => resolvePrivateQaBuild(baseConfig(), { ...PRIVATE_ENV, AYA_PRIVATE_QA_CA_SHA256: sha }, io));
  });
});

describe('applyPrivateQaResources (in-memory filesystem)', () => {
  test.each(['ios', 'android'])('private build writes only its own %s CA and binding (mock planning proof)', (platform) => {
    const fs = memoryFs();
    const before = new Map(fs.files);
    const [derFile, bindingFile] = OWNED[platform];

    applyPrivateQaResources(PROJECT_ROOT, MOCK_BUILD, platform, fs);

    expect(fs.files.get(derFile).equals(MOCK_DER)).toBe(true);
    expect(JSON.parse(fs.files.get(bindingFile).toString('utf8'))).toStrictEqual({
      enabled: true,
      apiOrigin: API,
      authOrigin: AUTH,
      caSha256: MOCK_SHA,
    });
    const touched = [...fs.writeFileSync.mock.calls, ...fs.rmSync.mock.calls].map(([file]) => file);
    expect(touched.filter((file) => !OWNED[platform].includes(file))).toEqual([]);
    expect(fs.mkdirSync.mock.calls.filter(([dir]) => dir !== path.dirname(derFile))).toEqual([]);
    for (const [file, data] of before) if (!OWNED[platform].includes(file)) expect(fs.files.get(file)).toEqual(data);
  });

  test.each(['ios', 'android'])('ordinary build removes only its own two %s files, never recursively', (platform) => {
    const fs = memoryFs();
    const before = new Map(fs.files);

    applyPrivateQaResources(PROJECT_ROOT, null, platform, fs);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.rmSync.mock.calls.map(([file]) => file).sort()).toEqual([...OWNED[platform]].sort());
    expect(fs.rmSync.mock.calls.filter(([, options]) => options?.recursive)).toEqual([]);
    for (const file of OWNED[platform]) expect(fs.files.has(file)).toBe(false);
    for (const [file, data] of before) if (!OWNED[platform].includes(file)) expect(fs.files.get(file)).toEqual(data);
  });

  test.each([
    ['an API origin drift', { ...MOCK_BUILD, apiOrigin: `${API}/` }, 'ios'],
    ['an Auth origin drift', { ...MOCK_BUILD, authOrigin: API }, 'android'],
    ['a fingerprint that is not the DER hash', { ...MOCK_BUILD, caSha256: 'f'.repeat(64) }, 'ios'],
    ['no DER bytes', { ...MOCK_BUILD, der: Buffer.alloc(0) }, 'android'],
    ['an unknown platform', MOCK_BUILD, 'web'],
    ['an unknown platform for an ordinary build', null, 'web'],
  ])('%s: rejected generically before touching any file', (_, build, platform) => {
    const fs = memoryFs();
    expectGenericFailure(() => applyPrivateQaResources(PROJECT_ROOT, build, platform, fs));
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });
});

describe('withPrivateQa', () => {
  const ENV_KEYS = [...new Set([...Object.keys(PRIVATE_ENV), 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS'])];

  test('in an ordinary env drops extra.ayaPrivateQa and registers only the ios and android dangerous mods', () => {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    try {
      // Keys are set through a computed object, never as process.env.EXPO_PUBLIC_* members the Babel preset may inline.
      for (const key of ENV_KEYS) delete process.env[key];
      Object.assign(process.env, { ...PRIVATE_ENV, EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' });

      const config = withPrivateQa(baseConfig());

      const { mods, ...rest } = config;
      expect(rest).toStrictEqual(expectedConfig(baseConfig()));
      expect(Object.keys(mods).sort()).toEqual(['android', 'ios']);
      expect(Object.keys(mods.ios)).toEqual(['dangerous']);
      expect(Object.keys(mods.android)).toEqual(['dangerous']);
      expect(typeof mods.ios.dangerous).toBe('function');
      expect(typeof mods.android.dangerous).toBe('function');
    } finally {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
