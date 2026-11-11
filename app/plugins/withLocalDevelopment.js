'use strict';
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');
const { readPrivateQaCa, applyPrivateQaResources } = require('./withPrivateQa');
const fail = () => new Error('The local development build configuration was rejected.');
const EXPECTED = {
  EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_LOCAL_DEVELOPMENT: 'on', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off', EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_LEARNING_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email', EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off', EXPO_PUBLIC_API_BASE_URL: 'https://localhost:58444',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://localhost:58445',
};

function resolveLocalDevelopmentBuild(config, env, io) {
  const extra = {...config.extra}; delete extra.ayaLocalDevelopmentTls;
  const clean = {...config,extra};
  if (env.EXPO_PUBLIC_ACCOUNT_ENV !== 'local-development') {
    if (env.EXPO_PUBLIC_LOCAL_DEVELOPMENT === 'on') throw fail();
    return {config:clean,build:null};
  }
  try {
    for (const [key,value] of Object.entries(EXPECTED)) if (env[key] !== value) throw fail();
    const bundleId = env.AYAFASIH_LOCAL_DEVELOPMENT_IOS_BUNDLE_ID;
    if (typeof bundleId !== 'string' || bundleId.length > 155 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(bundleId)) throw fail();
    if (config.ios?.bundleIdentifier !== undefined && config.ios.bundleIdentifier !== bundleId) throw fail();
    const caPath = env.AYA_LOCAL_DEVELOPMENT_CA_PATH, hash = env.AYA_LOCAL_DEVELOPMENT_CA_SHA256;
    if (typeof caPath !== 'string' || !path.isAbsolute(caPath) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw fail();
    const der = readPrivateQaCa(caPath,hash,io);
    delete extra.ayaPrivateQa;
    const build = {apiOrigin:EXPECTED.EXPO_PUBLIC_API_BASE_URL,authOrigin:EXPECTED.EXPO_PUBLIC_SUPABASE_AUTH_URL,caSha256:hash,der};
    return {config:{...clean,ios:{...config.ios,bundleIdentifier:bundleId},extra:{...extra,ayaLocalDevelopmentTls:{caSha256:hash}}},build};
  } catch { throw fail(); }
}

function withLocalDevelopment(config) {
  const {config:next,build}=resolveLocalDevelopmentBuild(config,process.env);
  if (!build) return next;
  let result=next;
  for (const platform of ['ios','android']) result=withDangerousMod(result,[platform,(mod)=>{
    // Register before withPrivateQa: Expo runs the later cleanup action first,
    // then this validated writer supplies the native TLS bundle without QA account flags.
    applyPrivateQaResources(mod.modRequest.projectRoot,build,platform); return mod;
  }]);
  return result;
}
module.exports=withLocalDevelopment;
module.exports.resolveLocalDevelopmentBuild=resolveLocalDevelopmentBuild;
