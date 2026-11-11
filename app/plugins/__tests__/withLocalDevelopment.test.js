const {it,expect,jest}=require('@jest/globals');
const {Buffer}=require('buffer');
// Decision/byte-binding tests, not TLS proof: certificate parser verdict is an
// injected fixture. No credential/certificate is generated and no file is written.
const crypto=require('crypto');
const {resolveLocalDevelopmentBuild}=require('../withLocalDevelopment');
const DER=Buffer.from('fixture-public-ca-bytes-only');
const HASH=crypto.createHash('sha256').update(DER).digest('hex');
const PEM='-----BEGIN CERTIFICATE-----\n'+DER.toString('base64')+'\n-----END CERTIFICATE-----\n';
const env={AYAFASIH_LOCAL_DEVELOPMENT_IOS_BUNDLE_ID:'id.fixture.localdevelopment',EXPO_PUBLIC_ACCOUNT_ENV:'local-development',EXPO_PUBLIC_LOCAL_DEVELOPMENT:'on',EXPO_PUBLIC_APP_MODE:'tester',
  EXPO_PUBLIC_AUTH_PROVIDER:'local-supabase',EXPO_PUBLIC_PRODUCTION_ACCOUNTS:'off',EXPO_PUBLIC_PRIVATE_QA:'off',
  EXPO_PUBLIC_PRIVATE_BETA:'off',EXPO_PUBLIC_LEARNING_BETA:'off',EXPO_PUBLIC_ACCOUNT_REGISTRATION:'confirmed-email',
  EXPO_PUBLIC_GOOGLE_SIGN_IN:'off',EXPO_PUBLIC_PASSWORD_RECOVERY:'off',EXPO_PUBLIC_API_BASE_URL:'https://localhost:58444',
  EXPO_PUBLIC_SUPABASE_AUTH_URL:'https://localhost:58445',AYA_LOCAL_DEVELOPMENT_CA_PATH:'/fixture/public-ca.pem',AYA_LOCAL_DEVELOPMENT_CA_SHA256:HASH};
function io(){return {readFileSync:jest.fn(()=>Buffer.from(PEM)),parseCertificate:jest.fn(()=>({ca:true,validFrom:'2026-01-01T00:00:00Z',validTo:'2027-01-01T00:00:00Z',raw:DER})),now:()=>new Date('2026-11-03T00:00:00Z')};}

it('binds the shared native TLS payload to the exact roots/pin without private QA account metadata',()=>{
  const source={name:'Fixture',extra:{keep:true,ayaPrivateQa:{caSha256:'stale'}}};const before=JSON.stringify(source);
  const result=resolveLocalDevelopmentBuild(source,env,io());
  expect(result.build).toEqual({apiOrigin:env.EXPO_PUBLIC_API_BASE_URL,authOrigin:env.EXPO_PUBLIC_SUPABASE_AUTH_URL,caSha256:HASH,der:DER});
  expect(result.config.ios.bundleIdentifier).toBe('id.fixture.localdevelopment');
  expect(result.config.extra).toEqual({keep:true,ayaLocalDevelopmentTls:{caSha256:HASH}});
  expect(JSON.stringify(source)).toBe(before);
});

it.each(['EXPO_PUBLIC_PRIVATE_QA','EXPO_PUBLIC_PRODUCTION_ACCOUNTS','EXPO_PUBLIC_API_BASE_URL','EXPO_PUBLIC_SUPABASE_AUTH_URL','EXPO_PUBLIC_LOCAL_DEVELOPMENT'])('refuses drift in %s',key=>{
  expect(()=>resolveLocalDevelopmentBuild({}, {...env,[key]:'drift'},io())).toThrow('local development');
});

it('rejects a different CA digest, non-CA, expired CA and any private-key input without disclosing details',()=>{
  const cases=[
    [{...env,AYA_LOCAL_DEVELOPMENT_CA_SHA256:'b'.repeat(64)},io()],
    [env,{...io(),parseCertificate:()=>({ca:false,raw:DER})}],
    [env,{...io(),parseCertificate:()=>({ca:true,validFrom:'2020-01-01',validTo:'2021-01-01',raw:DER})}],
    [env,{...io(),readFileSync:()=>Buffer.from(PEM+'-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n')}],
  ];
  for(const[e,port]of cases){
    try{resolveLocalDevelopmentBuild({},e,port);throw Error('accepted bad CA');}
    catch(error){expect(error.message).toBe('The local development build configuration was rejected.');expect(error.message).not.toContain(e.AYA_LOCAL_DEVELOPMENT_CA_PATH);}
  }
});

it('leaves existing production/private profiles inactive and reads no CA when local development is off',()=>{
  const port=io();expect(resolveLocalDevelopmentBuild({extra:{keep:true}}, {EXPO_PUBLIC_ACCOUNT_ENV:'production'},port)).toEqual({config:{extra:{keep:true}},build:null});
  expect(port.readFileSync).not.toHaveBeenCalled();
  expect(()=>resolveLocalDevelopmentBuild({}, {...env,EXPO_PUBLIC_ACCOUNT_ENV:'production'},port)).toThrow();
});

it('refuses a missing or conflicting native identifier instead of replacing it',()=>{
  expect(()=>resolveLocalDevelopmentBuild({}, {...env,AYAFASIH_LOCAL_DEVELOPMENT_IOS_BUNDLE_ID:undefined},io())).toThrow();
  expect(()=>resolveLocalDevelopmentBuild({ios:{bundleIdentifier:'id.other.existing'}},env,io())).toThrow();
});
