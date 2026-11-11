// Build-time Expo config plugin for the private tester beta, held to plugins/__tests__/withPrivateBeta.test.js.
//
// - Off unless EXPO_PUBLIC_PRIVATE_BETA is exactly "on": the very same config object comes back and nothing else is read.
// - On: the exact flags of src/config/privateBeta.ts (tester mode, staging profile, local-supabase provider, production
//   flag off, private QA flag unset, empty or off), two distinct staging root origins (src/account/staging.ts, restated
//   here, matched whole and never normalized) and the owner-supplied nonsecret AYAFASIH_BETA_IOS_BUNDLE_ID and
//   AYAFASIH_BETA_ANDROID_PACKAGE. Any problem throws a message that names the setting and never a supplied value.
// - Returns a new config that differs only in ios.bundleIdentifier and android.package. An existing, different identifier
//   is refused, never overwritten. No Apple team, Expo owner or project, certificate, credential, CA or trust change.
// - The plugin is synchronous and registers no mods. It reads process.env whole (never process.env.EXPO_PUBLIC_* members,
//   which the Expo Babel preset may inline) and never writes to it.

// Staging root origin: https, lower-case public DNS name of at least two labels, whose last label starts with a letter.
const STAGING_ORIGIN = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const MAX_ORIGIN_LENGTH = 'https://'.length + 253;
const NON_PUBLIC_NAMES = new Set('localhost local test example invalid onion alt arpa internal home lan corp intranet private'.split(' '));

// Reverse DNS identifiers: at least two dot-separated segments, matched whole.
const IOS_BUNDLE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const MAX_IOS_BUNDLE_ID_LENGTH = 155;
const MAX_ANDROID_PACKAGE_LENGTH = 255;

const IOS_SETTING = 'AYAFASIH_BETA_IOS_BUNDLE_ID';
const ANDROID_SETTING = 'AYAFASIH_BETA_ANDROID_PACKAGE';

/** An error naming `setting` and what it must be, never its value. */
const reject = (setting, expected) => new Error(`${setting} must be ${expected} for the private beta build.`);

const isObject = (value) => typeof value === 'object' && value !== null;

function isStagingOrigin(value) {
  if (typeof value !== 'string' || value.length > MAX_ORIGIN_LENGTH) return false;
  const match = STAGING_ORIGIN.exec(value);
  if (match === null) return false;
  const name = match[1];
  return !NON_PUBLIC_NAMES.has(name.slice(name.lastIndexOf('.') + 1));
}

const isIosBundleId = (value) => typeof value === 'string' && value.length <= MAX_IOS_BUNDLE_ID_LENGTH && IOS_BUNDLE_ID.test(value);
const isAndroidPackage = (value) => typeof value === 'string' && value.length <= MAX_ANDROID_PACKAGE_LENGTH && ANDROID_PACKAGE.test(value);

/** Throws, naming only the setting, unless `env` is exactly a private beta build; same order as src/config/privateBeta.ts. */
function checkProfile(env) {
  if (env.EXPO_PUBLIC_APP_MODE !== 'tester') throw reject('EXPO_PUBLIC_APP_MODE', 'exactly "tester"');
  if (env.EXPO_PUBLIC_ACCOUNT_ENV !== 'staging') throw reject('EXPO_PUBLIC_ACCOUNT_ENV', 'exactly "staging"');
  if (env.EXPO_PUBLIC_AUTH_PROVIDER !== 'local-supabase') throw reject('EXPO_PUBLIC_AUTH_PROVIDER', 'exactly "local-supabase"');
  if (env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS !== 'off') throw reject('EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'exactly "off"');
  const privateQa = env.EXPO_PUBLIC_PRIVATE_QA;
  if (privateQa !== undefined && privateQa !== '' && privateQa !== 'off') {
    throw reject('EXPO_PUBLIC_PRIVATE_QA', 'unset or exactly "off"');
  }
  const rule = 'a staging root origin (https, a public DNS name in lower case, no port, nothing after the name)';
  if (!isStagingOrigin(env.EXPO_PUBLIC_API_BASE_URL)) throw reject('EXPO_PUBLIC_API_BASE_URL', rule);
  if (!isStagingOrigin(env.EXPO_PUBLIC_SUPABASE_AUTH_URL) || env.EXPO_PUBLIC_SUPABASE_AUTH_URL === env.EXPO_PUBLIC_API_BASE_URL) {
    throw reject('EXPO_PUBLIC_SUPABASE_AUTH_URL', `${rule}, not the account API's origin`);
  }
}

/** `section` with `key` set to `value`; an existing, different value is refused (naming `label` only). */
function withIdentifier(section, key, value, label) {
  const existing = isObject(section) ? section[key] : undefined;
  if (existing !== undefined && existing !== value) {
    throw new Error(`${label} is already set and differs from the owner-supplied identifier; it is not overwritten.`);
  }
  return { ...section, [key]: value };
}

/**
 * The Expo config plugin: (config) => config.
 * @param {object} config
 * @returns {object} `config` itself when the beta is off; otherwise a copy with only the two identifiers set.
 */
function withPrivateBeta(config) {
  const env = process.env;
  if (env.EXPO_PUBLIC_PRIVATE_BETA !== 'on') return config;

  checkProfile(env);
  const iosBundleId = env[IOS_SETTING];
  const androidPackage = env[ANDROID_SETTING];
  if (!isIosBundleId(iosBundleId)) throw reject(IOS_SETTING, 'a reverse DNS bundle identifier (letters, digits, hyphens, at least two dot-separated segments)');
  if (!isAndroidPackage(androidPackage)) {
    throw reject(ANDROID_SETTING, 'a reverse DNS package name (segments of letters, digits and underscores, each starting with a letter, at least two)');
  }

  return {
    ...config,
    ios: withIdentifier(config.ios, 'bundleIdentifier', iosBundleId, 'ios.bundleIdentifier'),
    android: withIdentifier(config.android, 'package', androidPackage, 'android.package'),
  };
}

module.exports = withPrivateBeta;
