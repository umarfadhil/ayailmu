// Build-time Expo config plugin for the private native QA profile, held to plugins/__tests__/withPrivateQa.test.js.
//
// - An ordinary build (EXPO_PUBLIC_ACCOUNT_ENV anything but exactly "private-qa") drops only extra.ayaPrivateQa and its
//   own two generated files for the current platform; it never reads a CA, whatever the private variables say.
// - A private QA build repeats the runtime's exact private profile rules (account/supabaseConfig.ts), then reads exactly
//   the nonpublic AYA_PRIVATE_QA_CA_PATH, requires one PEM CA certificate, currently valid, whose DER SHA-256 equals
//   AYA_PRIVATE_QA_CA_SHA256, and publishes only extra.ayaPrivateQa.caSha256. No network, global trust or ATS change.
//   Any failure throws one fixed message: never the CA path, certificate bytes or a parser's message, and no fallback.
// - withPrivateQa passes process.env whole (never process.env.EXPO_PUBLIC_* members, which the Expo Babel preset may
//   inline) and registers only the ios and android dangerous mods, which call applyPrivateQaResources.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const PRIVATE_QA_FAILURE = 'The private QA build configuration was rejected.';

// The exact private profile (account/privateQa.ts, account/supabaseConfig.ts), restated for the build.
const PRIVATE_QA = 'private-qa';
const PRIVATE_QA_PROVIDER = 'local-supabase';
const PRIVATE_QA_API_ORIGIN = 'https://localhost:58444';
const PRIVATE_QA_AUTH_ORIGIN = 'https://localhost:58445';
const PRODUCTION_OFF = new Set([undefined, '', 'off']);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_PEM_BYTES = 128 * 1024;
const MAX_DER_BYTES = 65536;
// Exactly one CERTIFICATE block and nothing else: no leading or trailing text, no second block, no key.
const PEM_CERTIFICATE = /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]{1,76}\r?\n)+-----END CERTIFICATE-----\r?\n?$/;

// The plugin's own generated files, relative to the app directory: nothing else is ever written or removed.
const MODULE_DIR = path.join('modules', 'aya-private-qa-transport');
const RESOURCE_DIRS = Object.freeze({ ios: path.join('ios', 'Resources'), android: path.join('android', 'src', 'main', 'assets') });
const DER_FILE = 'aya-private-qa-ca.der';
const BINDING_FILE = 'aya-private-qa-binding.json';

const fail = () => new Error(PRIVATE_QA_FAILURE);
const isObject = (value) => typeof value === 'object' && value !== null;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const isDer = (value) => Buffer.isBuffer(value) && value.length >= 1 && value.length <= MAX_DER_BYTES;

/** Reads at most MAX_PEM_BYTES + 1 bytes of `file`, so an oversized file is rejected without loading it whole. */
function readBounded(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_PEM_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

function parseX509(bytes) {
  const certificate = new crypto.X509Certificate(bytes);
  return { ca: certificate.ca, validFrom: certificate.validFrom, validTo: certificate.validTo, raw: certificate.raw };
}

/** Creates `file` afresh: an existing entry is refused, and so (where the platform has O_NOFOLLOW) is a symlink. */
function writeOwnedFile(file, data) {
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW = 0 } = fs.constants;
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The owned resource directory `parts` under the canonical `projectRoot`, after checking every existing component from
 * the root down: each must be a real directory, never a symlink, and each existing generated file a regular file. Only
 * projectRoot itself is canonicalised (a /var -> /private/var parent is fine); nothing inside the owned tree is followed.
 * Missing components are normal unless `requireDir`. Throws (with any message) otherwise.
 */
function ownedDir(projectRoot, parts, requireDir) {
  const root = fs.realpathSync(projectRoot);
  if (!fs.lstatSync(root).isDirectory()) throw fail();
  const expected = path.join(root, ...parts);
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (stat === undefined && !requireDir) return expected;
    if (stat === undefined || !stat.isDirectory()) throw fail();
  }
  for (const leaf of [DER_FILE, BINDING_FILE]) {
    const stat = fs.lstatSync(path.join(dir, leaf), { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isFile()) throw fail();
  }
  if (fs.realpathSync(dir) !== expected) throw fail();
  return expected;
}

const DEFAULT_RESOLVE_IO = Object.freeze({ readFileSync: readBounded, parseCertificate: parseX509, now: () => new Date() });
const DEFAULT_APPLY_IO = Object.freeze({
  mkdirSync: (dir, options) => fs.mkdirSync(dir, options),
  writeFileSync: writeOwnedFile,
  rmSync: (file, options) => fs.rmSync(file, options),
});
const APPLY_MUTATORS = Object.freeze(Object.keys(DEFAULT_APPLY_IO));

/** `config` with only extra.ayaPrivateQa replaced by `privateQa` (or dropped when undefined); `config` is not mutated. */
function withExtra(config, privateQa) {
  const extra = { ...config.extra };
  delete extra.ayaPrivateQa;
  return { ...config, extra: privateQa === undefined ? extra : { ...extra, ayaPrivateQa: privateQa } };
}

/** Whether `env` is exactly the private profile, by the runtime's rules. */
function isPrivateProfile(env) {
  return (
    env.EXPO_PUBLIC_AUTH_PROVIDER === PRIVATE_QA_PROVIDER &&
    env.EXPO_PUBLIC_PRIVATE_QA === 'on' &&
    PRODUCTION_OFF.has(env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS) &&
    env.EXPO_PUBLIC_API_BASE_URL === PRIVATE_QA_API_ORIGIN &&
    env.EXPO_PUBLIC_SUPABASE_AUTH_URL === PRIVATE_QA_AUTH_ORIGIN
  );
}

/** The verified DER of the CA at `caPath` whose DER SHA-256 is `caSha256`; throws (with any message) otherwise. */
function readPrivateQaCa(caPath, caSha256, io) {
  const bytes = io.readFileSync(caPath);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PEM_BYTES) throw fail();
  const text = bytes.toString('latin1');
  if (!PEM_CERTIFICATE.test(text) || text.includes('PRIVATE KEY')) throw fail();

  const parsed = io.parseCertificate(Buffer.from(bytes));
  if (!isObject(parsed) || parsed.ca !== true) throw fail();
  const { validFrom, validTo, raw } = parsed;
  const from = typeof validFrom === 'string' ? Date.parse(validFrom) : NaN;
  const to = typeof validTo === 'string' ? Date.parse(validTo) : NaN;
  const now = io.now();
  const at = now instanceof Date ? now.getTime() : NaN;
  if (![from, to, at].every(Number.isFinite) || from > at || at > to) throw fail();

  if (!isDer(raw)) throw fail();
  const der = Buffer.from(raw);
  if (sha256(der) !== caSha256) throw fail();
  return der;
}

/**
 * The build decision, without mutating `config`.
 * @param {object} config Expo config.
 * @param {Record<string, string | undefined>} env The build environment (process.env in the plugin).
 * @param {{
 *   readFileSync?: (file: string) => Buffer,
 *   parseCertificate?: (bytes: Buffer) => { ca: boolean, validFrom: string, validTo: string, raw: Buffer },
 *   now?: () => Date,
 * }} [io] Test seam; defaults to node fs, crypto.X509Certificate and the clock.
 * @returns {Readonly<{
 *   config: object,
 *   build: null | Readonly<{ apiOrigin: string, authOrigin: string, caSha256: string, der: Buffer }>,
 * }>}
 */
function resolvePrivateQaBuild(config, env, io) {
  if (!isObject(config) || !isObject(env)) throw fail();
  if (env.EXPO_PUBLIC_ACCOUNT_ENV !== PRIVATE_QA) return Object.freeze({ config: withExtra(config), build: null });

  const { readFileSync, parseCertificate, now } = { ...DEFAULT_RESOLVE_IO, ...io };
  try {
    if (!isPrivateProfile(env)) throw fail();
    // The CA source stays nonpublic: an EXPO_PUBLIC_ spelling would be inlined into the bundle, so it is refused outright.
    const publicCa = Object.keys(env).filter((key) => key.startsWith('EXPO_PUBLIC_AYA_PRIVATE_QA_CA'));
    if (publicCa.some((key) => env[key] !== undefined)) throw fail();
    const caPath = env.AYA_PRIVATE_QA_CA_PATH;
    const caSha256 = env.AYA_PRIVATE_QA_CA_SHA256;
    if (typeof caPath !== 'string' || caPath === '' || !path.isAbsolute(caPath)) throw fail();
    if (typeof caSha256 !== 'string' || !SHA256_HEX.test(caSha256)) throw fail();

    const der = readPrivateQaCa(caPath, caSha256, { readFileSync, parseCertificate, now });
    const build = Object.freeze({ apiOrigin: PRIVATE_QA_API_ORIGIN, authOrigin: PRIVATE_QA_AUTH_ORIGIN, caSha256, der });
    return Object.freeze({ config: withExtra(config, { caSha256 }), build });
  } catch {
    // One fixed message whatever failed, so no path, certificate byte or parser detail reaches a build log.
    throw fail();
  }
}

/**
 * Writes (private build) or removes (ordinary build, `build` null) only this plugin's two generated files for `platform`.
 * @param {string} projectRoot The Expo project root (the app directory).
 * @param {null | { apiOrigin: string, authOrigin: string, caSha256: string, der: Buffer }} build
 * @param {'ios' | 'android'} platform
 * @param {{
 *   mkdirSync?: (dir: string, options: { recursive: true }) => void,
 *   writeFileSync?: (file: string, data: Buffer | string) => void,
 *   rmSync?: (file: string, options: { force: true }) => void,
 * }} [io] Test seam; defaults to node fs. Only all three injected together form an in-memory tree with no symlink graph;
 *   otherwise some real mutator runs, so every operation is held to the real filesystem ownership checks.
 * @returns {void}
 */
function applyPrivateQaResources(projectRoot, build, platform, io) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw fail();
  if (platform !== 'ios' && platform !== 'android') throw fail();
  const virtual = isObject(io) && APPLY_MUTATORS.every((name) => typeof io[name] === 'function');
  const { mkdirSync, writeFileSync, rmSync } = virtual ? io : { ...DEFAULT_APPLY_IO, ...io };
  const parts = [MODULE_DIR, RESOURCE_DIRS[platform]].flatMap((rel) => rel.split(path.sep));
  // The owned paths, checked afresh on the real filesystem before each use.
  const owned = (requireDir) => {
    const dir = virtual ? path.join(projectRoot, ...parts) : ownedDir(projectRoot, parts, requireDir);
    return { dir, derFile: path.join(dir, DER_FILE), bindingFile: path.join(dir, BINDING_FILE) };
  };

  if (build === null) {
    // Clear any stale trust from an earlier private build: only these two files, never recursively.
    try {
      const { derFile, bindingFile } = owned(false);
      rmSync(derFile, { force: true });
      rmSync(bindingFile, { force: true });
    } catch {
      throw fail();
    }
    return;
  }

  // Validate a copy of everything before the first write, so a caller cannot change what was checked.
  if (!isObject(build)) throw fail();
  const { apiOrigin, authOrigin, caSha256, der: givenDer } = build;
  if (apiOrigin !== PRIVATE_QA_API_ORIGIN || authOrigin !== PRIVATE_QA_AUTH_ORIGIN) throw fail();
  if (typeof caSha256 !== 'string' || !SHA256_HEX.test(caSha256) || !isDer(givenDer)) throw fail();
  const der = Buffer.from(givenDer);
  if (sha256(der) !== caSha256) throw fail();
  const binding = `${JSON.stringify({ enabled: true, apiOrigin, authOrigin, caSha256 }, null, 2)}\n`;

  try {
    mkdirSync(owned(false).dir, { recursive: true });
    const { derFile, bindingFile } = owned(true);
    // The binding goes last, so it never names a CA that is not written yet. Both are created afresh, never through
    // whatever entry stood there before.
    rmSync(bindingFile, { force: true });
    rmSync(derFile, { force: true });
    writeFileSync(derFile, der);
    writeFileSync(bindingFile, binding);
  } catch {
    throw fail();
  }
}

/**
 * The Expo config plugin: (config) => config.
 * @param {object} config
 * @returns {object}
 */
function withPrivateQa(config) {
  // process.env whole: a process.env.EXPO_PUBLIC_* member could be inlined by the Expo Babel preset.
  const { config: resolved, build } = resolvePrivateQaBuild(config, process.env);
  let next = resolved;
  for (const platform of ['ios', 'android']) {
    next = withDangerousMod(next, [
      platform,
      (modConfig) => {
        applyPrivateQaResources(modConfig.modRequest.projectRoot, build, platform);
        return modConfig;
      },
    ]);
  }
  return next;
}

module.exports = withPrivateQa;
module.exports.resolvePrivateQaBuild = resolvePrivateQaBuild;
module.exports.applyPrivateQaResources = applyPrivateQaResources;
