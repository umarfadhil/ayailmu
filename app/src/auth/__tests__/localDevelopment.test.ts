// Protocol/transport boundary tests only: every exchange is an in-memory fixture,
// never a real registration, inbox, TLS connection, or account.
import { prepareLocalDevelopmentNetwork } from '@/auth/localDevelopmentNetwork';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { createRegistration, type RegistrationSdkClient } from '@/auth/registration';
import { createApiClient } from '@/api/client';
import { fakeAccountApi, FAKE_API, FAKE_GOTRUE, providerUserId, type FakeUser } from '../../../test/fakeAccountApi';

const API='https://localhost:58444', AUTH='https://localhost:58445', HASH='a'.repeat(64);
const CONFIG: EnabledSupabaseConfig={enabled:true,provider:'local-supabase',environment:'local-development',localDevelopment:true,apiBaseUrl:API,authUrl:AUTH};
const BINDING={enabled:true as const,apiOrigin:API,authOrigin:AUTH,caSha256:HASH};
const USER={id:'6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',email:'learner@example.org'};
const SESSION={access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:USER};

function bridge() { return {binding:jest.fn(()=>BINDING),request:jest.fn(async (r:{url:string})=>({status:200,body:'{}',headers:{},url:r.url})),cancel:jest.fn()}; }

describe('local development keeps CA transport distinct from account policy',()=>{
  it('requires native platform, explicit profile, configured pin and matching bridge binding without global fallback',async()=>{
    const native=bridge(), loadBridge=jest.fn(()=>native);
    const opts={platform:'ios',expectedCaSha256:HASH,loadBridge};
    expect(prepareLocalDevelopmentNetwork(CONFIG,{...opts,platform:'web'})).toEqual({state:'unavailable',reason:'platform'});
    expect(prepareLocalDevelopmentNetwork(CONFIG,{...opts,expectedCaSha256:undefined})).toEqual({state:'unavailable',reason:'certificate'});
    expect(loadBridge).not.toHaveBeenCalled();
    expect(prepareLocalDevelopmentNetwork({...CONFIG,privateQa:true},opts)).toEqual({state:'unavailable',reason:'configuration'});
    const ready=prepareLocalDevelopmentNetwork(CONFIG,opts);expect(ready.state).toBe('ready');
    if(ready.state!=='ready')throw Error('transport unavailable');
    await ready.fetch(AUTH+'/settings',{credentials:'omit'});expect(native.request).toHaveBeenCalledTimes(1);
    for(const url of ['http://localhost:58445/settings','https://127.0.0.1:58445/settings',AUTH+'.evil.org/settings',API+':999/v1/me']) {
      await expect(ready.fetch(url)).rejects.toMatchObject({code:'request'});
    }
    native.binding.mockReturnValue({...BINDING,caSha256:'b'.repeat(64)});
    await expect(ready.fetch(AUTH+'/settings')).rejects.toMatchObject({code:'binding'});
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(prepareLocalDevelopmentNetwork(CONFIG,opts)).toEqual({state:'unavailable',reason:'binding'});
  });

  it('refuses API/Auth/registration construction without an injected native transport',()=>{
    expect(()=>createApiClient({baseUrl:API,environment:'local-development',localDevelopment:true})).toThrow();
    expect(()=>createSupabaseAuth({config:CONFIG})).toThrow();
    expect(()=>createRegistration({config:CONFIG,emailPolicy:'confirmed-email'})).toThrow();
  });

  it('uses ordinary signup, confirmation-required and code confirmation policies for distinct conventional users',async()=>{
    const sdk={signUp:jest.fn(async ({email}:{email:string})=>({data:{user:{...USER,email},session:null},error:null})),
      verifyOtp:jest.fn(async()=>({data:{user:USER,session:SESSION},error:null})),resend:jest.fn(async()=>({data:{user:null,session:null},error:null})),
      signOut:jest.fn(async()=>({error:null})),stopAutoRefresh:jest.fn()};
    const blocked=jest.fn(()=>{throw Error('No actual network permitted')}) as unknown as typeof fetch;
    const registration=createRegistration({config:CONFIG,emailPolicy:'confirmed-email',fetch:blocked,createClient:()=>sdk as unknown as RegistrationSdkClient});
    try {
      for(const email of ['learner@example.org','another@example.net']) {
        await expect(registration.register(email,'Strong-fixture-password-2026')).resolves.toEqual({status:'confirmation_required'});
      }
      await expect(registration.confirm(USER.email,'482913')).resolves.toEqual({status:'confirmed',signInRequired:true});
      expect(sdk.verifyOtp).toHaveBeenCalledWith({email:USER.email,token:'482913',type:'signup'});
      expect(sdk.signOut).toHaveBeenCalledWith({scope:'local'});
      expect(blocked).not.toHaveBeenCalled();
    } finally { await registration.dispose(); }
  });

  it('signs in a conventional user, verifies its own API account and revokes through the captured loopback fetch',async()=>{
    const learner:FakeUser={email:'learner@example.org',password:'fixture-password-only',uid:'uid-local-development',token:'fixture-access',accountId:'6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6'};
    const fake=fakeAccountApi([learner]);const requests:string[]=[];
    const fetchFixture=(async(input,init)=>{
      const url=String(input);requests.push(`${init?.method??'GET'} ${url}`);
      const mapped=url.startsWith(API+'/')?FAKE_API+url.slice(API.length):url.startsWith(AUTH+'/')?FAKE_GOTRUE+url.slice(AUTH.length):null;
      if(!mapped)throw Error('Unexpected test origin');
      const response=await fake.fetch(mapped,init);return {...response,url} as unknown as Response;
    }) as typeof fetch;
    const auth=createSupabaseAuth({config:CONFIG,fetch:fetchFixture});
    const api=createApiClient({baseUrl:API,environment:'local-development',localDevelopment:true,fetch:fetchFixture});
    try {
      await expect(auth.signIn(learner.email,learner.password)).resolves.toMatchObject({uid:providerUserId(learner),email:learner.email});
      await expect(auth.authorized((token,signal)=>api.me(token,signal))).resolves.toMatchObject({accountId:learner.accountId});
      await expect(auth.signOut()).resolves.toEqual({revoked:true});
      expect(requests).toEqual([`POST ${AUTH}/token?grant_type=password`,`GET ${API}/v1/me`,`POST ${AUTH}/logout?scope=local`]);
    } finally { if(auth.status().state!=='signed-out')await auth.signOut(); }
  });
});
