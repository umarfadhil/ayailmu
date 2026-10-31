'use strict';

// General-user build gate. Off by default: unless AYAFASIH_GENERAL_USER is
// exactly "on", the config is returned untouched before any other field is read.
// When on, this is validation only. It never rewrites process.env or config and
// adds no mods, files, native ids, credentials, network calls, secret checks or
// certificate changes. Runtime behavior is unchanged (normal production accounts
// with confirmed-email signup); this grants no production activation or approval.
//
// Google sign-in and password recovery are optional capability REQUESTS, so each
// is accepted as exactly "on" or "off" (missing, empty or any other value still
// fails). "on" only requests the capability: whether the platform, config, crypto
// and store can actually deliver it is decided by the account layer at runtime,
// and an unavailable capability never blocks email/code study. This plugin does
// not inspect the Google callback or any other optional-capability config.

const SWITCH = 'AYAFASIH_GENERAL_USER';

const EXACT_SETTINGS = [
  ['EXPO_PUBLIC_APP_MODE', 'tester'],
  ['EXPO_PUBLIC_AUTH_PROVIDER', 'local-supabase'],
  ['EXPO_PUBLIC_ACCOUNT_ENV', 'production'],
  ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'on'],
  ['EXPO_PUBLIC_ACCOUNT_REGISTRATION', 'confirmed-email'],
  ['EXPO_PUBLIC_PRIVATE_QA', 'off'],
  ['EXPO_PUBLIC_PRIVATE_BETA', 'off'],
  ['EXPO_PUBLIC_LEARNING_BETA', 'off'],
];
// Requested independently; each must be exactly "on" or "off".
const OPTIONAL_CAPABILITY_REQUESTS = [
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
];
const REMEMBER_DEVICE = 'EXPO_PUBLIC_REMEMBER_DEVICE';
const API_ROOT = 'EXPO_PUBLIC_API_BASE_URL';
const AUTH_ROOT = 'EXPO_PUBLIC_SUPABASE_AUTH_URL';

// Same root-origin rule as withLearningBeta.js and src/account/staging.ts.
const ROOT_ORIGIN =
  /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const MAX_ROOT_LENGTH = 'https://'.length + 253;
const RESERVED_LAST_LABELS = new Set(
  'localhost local test example invalid onion alt arpa internal home lan corp intranet private'.split(' '),
);

function fail(setting, expected) {
  // Never include the supplied value in the message.
  throw new Error(`${setting} must be ${expected} for the general-user build.`);
}

function isPublicRoot(value) {
  if (typeof value !== 'string' || value.length > MAX_ROOT_LENGTH) return false;
  const match = ROOT_ORIGIN.exec(value);
  if (!match) return false;
  return !RESERVED_LAST_LABELS.has(match[1].split('.').pop());
}

function requireRoot(env, setting) {
  if (!isPublicRoot(env[setting])) {
    fail(
      setting,
      'a lowercase public https root origin on a normal DNS name (no port, path, query, fragment, userinfo, IP or reserved suffix)',
    );
  }
  return env[setting];
}

function withGeneralUser(config) {
  if (process.env[SWITCH] !== 'on') return config;

  const env = process.env;
  for (const [setting, expected] of EXACT_SETTINGS) {
    if (env[setting] !== expected) fail(setting, `exactly "${expected}"`);
  }
  for (const setting of [...OPTIONAL_CAPABILITY_REQUESTS, REMEMBER_DEVICE]) {
    if (env[setting] !== 'on' && env[setting] !== 'off') {
      fail(setting, 'exactly "on" or "off"');
    }
  }

  const apiRoot = requireRoot(env, API_ROOT);
  const authRoot = requireRoot(env, AUTH_ROOT);
  if (authRoot === apiRoot) fail(AUTH_ROOT, `a root distinct from ${API_ROOT}`);

  return config;
}

module.exports = withGeneralUser;
