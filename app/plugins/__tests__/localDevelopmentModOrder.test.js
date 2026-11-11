// Exercises Expo's real composed dangerous-mod chain against a disposable owned
// filesystem. Only CA parsing is a fixture; this proves packaging order, not TLS.
const {it,expect,jest}=require('@jest/globals');
const {Buffer}=require('buffer');
const fs=require('fs'),path=require('path'),crypto=require('crypto'),process=require('process');
jest.mock('../withPrivateQa',()=>{
  const actual=jest.requireActual('../withPrivateQa');
  const {Buffer}=require('buffer');
  return Object.assign((config)=>actual(config),{...actual,readPrivateQaCa:()=>Buffer.from('fixture-mod-order-public-ca')});
});
const DER=Buffer.from('fixture-mod-order-public-ca'),HASH=crypto.createHash('sha256').update(DER).digest('hex');
const LOCAL={EXPO_PUBLIC_ACCOUNT_ENV:'local-development',EXPO_PUBLIC_LOCAL_DEVELOPMENT:'on',EXPO_PUBLIC_APP_MODE:'tester',
  EXPO_PUBLIC_AUTH_PROVIDER:'local-supabase',EXPO_PUBLIC_PRODUCTION_ACCOUNTS:'off',EXPO_PUBLIC_PRIVATE_QA:'off',
  EXPO_PUBLIC_PRIVATE_BETA:'off',EXPO_PUBLIC_LEARNING_BETA:'off',EXPO_PUBLIC_ACCOUNT_REGISTRATION:'confirmed-email',
  EXPO_PUBLIC_GOOGLE_SIGN_IN:'off',EXPO_PUBLIC_PASSWORD_RECOVERY:'off',EXPO_PUBLIC_API_BASE_URL:'https://localhost:58444',
  EXPO_PUBLIC_SUPABASE_AUTH_URL:'https://localhost:58445',AYA_LOCAL_DEVELOPMENT_CA_PATH:'/fixture/public-ca.pem',
  AYA_LOCAL_DEVELOPMENT_CA_SHA256:HASH,AYAFASIH_LOCAL_DEVELOPMENT_IOS_BUNDLE_ID:'id.fixture.localdevelopment'};

async function fixture(env,run){
  const baseline=new Map(Object.keys(LOCAL).map(k=>[k,process.env[k]]));
  const root=fs.mkdtempSync(path.join(process.cwd(),'plugins/__tests__/mod-order-fixture-'));
  const resources=path.join(root,'modules/aya-private-qa-transport/ios/Resources');fs.mkdirSync(resources,{recursive:true});
  fs.writeFileSync(path.join(resources,'aya-private-qa-ca.der'),'stale-ca');
  fs.writeFileSync(path.join(resources,'aya-private-qa-binding.json'),'stale-binding');
  fs.writeFileSync(path.join(resources,'unrelated.txt'),'preserve');
  try{for(const key of Object.keys(LOCAL)){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}await run(root,resources);}
  finally{for(const[k,v]of baseline){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true,force:true});}
}
function compose(){
  const order=require('../../app.json').expo.plugins.filter(p=>typeof p==='string'&&['./plugins/withPrivateQa','./plugins/withLocalDevelopment'].includes(p));
  let config={name:'Fixture',slug:'fixture'};
  for(const plugin of order)config=require(path.join(process.cwd(),plugin))(config);
  return config;
}
async function execute(config,root){return config.mods.ios.dangerous({...config,modResults:{},modRequest:{projectRoot:root,platformProjectRoot:path.join(root,'ios'),platform:'ios',modName:'dangerous',introspect:false}});}

it('leaves the validated local CA/binding after the real declared Expo mod chain, preserving unrelated files',async()=>{
  await fixture(LOCAL,async(root,resources)=>{
    await execute(compose(),root);
    expect(fs.readFileSync(path.join(resources,'aya-private-qa-ca.der'))).toEqual(DER);
    expect(JSON.parse(fs.readFileSync(path.join(resources,'aya-private-qa-binding.json'),'utf8'))).toEqual({enabled:true,apiOrigin:LOCAL.EXPO_PUBLIC_API_BASE_URL,authOrigin:LOCAL.EXPO_PUBLIC_SUPABASE_AUTH_URL,caSha256:HASH});
    expect(fs.readFileSync(path.join(resources,'unrelated.txt'),'utf8')).toBe('preserve');
  });
});
it('still removes stale CA resources in ordinary production while preserving unrelated files',async()=>{
  await fixture({EXPO_PUBLIC_ACCOUNT_ENV:'production'},async(root,resources)=>{
    await execute(compose(),root);
    expect(fs.existsSync(path.join(resources,'aya-private-qa-ca.der'))).toBe(false);
    expect(fs.existsSync(path.join(resources,'aya-private-qa-binding.json'))).toBe(false);
    expect(fs.readFileSync(path.join(resources,'unrelated.txt'),'utf8')).toBe('preserve');
  });
});
it('invalid local settings fail during config resolution before any dangerous mod can write',async()=>{
  await fixture({...LOCAL,EXPO_PUBLIC_PRODUCTION_ACCOUNTS:'on'},async(_root,resources)=>{
    expect(compose).toThrow();
    expect(fs.readFileSync(path.join(resources,'aya-private-qa-ca.der'),'utf8')).toBe('stale-ca');
  });
});
