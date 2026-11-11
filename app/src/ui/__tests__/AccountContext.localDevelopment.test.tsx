import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AppProvider, useApp } from '@/ui/AppContext';
import type { SupabaseConfig } from '@/account/supabaseConfig';
import type { PrivateQaNetwork } from '@/auth/privateQaNetwork';

const mockNetwork=jest.fn<PrivateQaNetwork,[SupabaseConfig]>();
jest.mock('@/auth/localDevelopmentNetwork',()=>({deviceLocalDevelopmentNetwork:(c:SupabaseConfig)=>mockNetwork(c)}));
jest.mock('@/storage/openStore',()=>({STORAGE_KIND:'test-memory',openStore:async()=>{throw Error('Test supplies its store');}}));
const mockAuth=jest.fn(),mockApi=jest.fn(),mockRegistration=jest.fn();
jest.mock('@/auth/supabaseAuth',()=>{const real=jest.requireActual('@/auth/supabaseAuth');return {...real,createSupabaseAuth:(o:unknown)=>(mockAuth(o),real.createSupabaseAuth(o))};});
jest.mock('@/api/client',()=>{const real=jest.requireActual('@/api/client');return {...real,createApiClient:(o:unknown)=>(mockApi(o),real.createApiClient(o))};});
jest.mock('@/auth/registration',()=>{const real=jest.requireActual('@/auth/registration');return {...real,createRegistration:(o:unknown)=>(mockRegistration(o),real.createRegistration(o))};});

const BUILD={EXPO_PUBLIC_APP_MODE:'tester',EXPO_PUBLIC_AUTH_PROVIDER:'local-supabase',EXPO_PUBLIC_ACCOUNT_ENV:'local-development',
  EXPO_PUBLIC_LOCAL_DEVELOPMENT:'on',EXPO_PUBLIC_PRODUCTION_ACCOUNTS:'off',EXPO_PUBLIC_PRIVATE_QA:'off',EXPO_PUBLIC_PRIVATE_BETA:'off',
  EXPO_PUBLIC_LEARNING_BETA:'off',EXPO_PUBLIC_GOOGLE_SIGN_IN:'off',EXPO_PUBLIC_PASSWORD_RECOVERY:'off',EXPO_PUBLIC_REMEMBER_DEVICE:'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION:'confirmed-email',EXPO_PUBLIC_NORMAL_USER_STARTER:'on',EXPO_PUBLIC_API_BASE_URL:'https://localhost:58444',EXPO_PUBLIC_SUPABASE_AUTH_URL:'https://localhost:58445'};
const baseline=Object.keys(BUILD).map(k=>[k,process.env[k]] as const);
const globalFetch=globalThis.fetch;
let latest:AccountContextValue|undefined, app:ReturnType<typeof useApp>|undefined;
const locks:LockManagerLike={request:(_n,_o,cb)=>Promise.resolve(cb({}))};
function Probe(){const a=useAccount(),s=useApp();useEffect(()=>{latest=a;app=s;},[a,s]);return <AccountPanel {...a.panel}/>;}
async function mount(){
  const kv=memoryKv();const guest=new KvStore(kv);await guest.init();
  const open=(namespace:Namespace)=>openKvDataset({kv,locks,namespace});
  const view=await render(<AppProvider storeFactory={async()=>guest}><AccountProvider openDataset={open}><Probe/></AccountProvider></AppProvider>);
  await waitFor(()=>expect(app?.ready).toBe(true));await act(()=>new Promise<void>(r=>setTimeout(r,0)));return view;
}
beforeEach(()=>{Object.assign(process.env,BUILD);latest=undefined;app=undefined;mockAuth.mockClear();mockApi.mockClear();mockRegistration.mockClear();mockNetwork.mockReset();});
afterEach(()=>{for(const[k,v]of baseline){if(v===undefined)delete process.env[k];else process.env[k]=v;}globalThis.fetch=globalFetch;});

it('wires ordinary email policy to the pinned fetch without projecting any private QA capability',async()=>{
  const bound=jest.fn(()=>Promise.reject(Error('No request expected'))) as unknown as typeof fetch;
  const fallback=jest.fn(()=>Promise.reject(Error('No fallback allowed')));globalThis.fetch=fallback as unknown as typeof fetch;
  mockNetwork.mockReturnValue({state:'ready',fetch:bound});
  const view=await mount();try{
    expect(latest?.enabled).toBe(true);expect(latest?.privateQa).toBeUndefined();
    expect(latest?.panel.environment).toBe('local-development');
    expect(latest?.panel.registration?.emailPolicy).toBe('confirmed-email');
    expect(view.getByText(/^Daftar akun/)).toBeTruthy();
    expect(view.queryAllByText(/\.test\b|bukan pendaftaran sungguhan/)).toEqual([]);
    for(const[o]of mockAuth.mock.calls)expect(o.fetch).toBe(bound);
    expect(mockApi).toHaveBeenCalledWith(expect.objectContaining({localDevelopment:true,fetch:bound}));
    for(const[o]of mockApi.mock.calls)expect(o.privateQa).toBeUndefined();
    expect(mockRegistration).toHaveBeenCalledWith(expect.objectContaining({emailPolicy:'confirmed-email',fetch:bound}));
    expect(bound).not.toHaveBeenCalled();expect(fallback).not.toHaveBeenCalled();
  }finally{view.unmount();}
});

it('builds no account clients when its native certificate transport is unavailable',async()=>{
  mockNetwork.mockReturnValue({state:'unavailable',reason:'certificate'});
  const view=await mount();try{
    expect(latest?.enabled).toBe(false);expect(latest?.privateQa).toBeUndefined();
    expect(mockAuth).not.toHaveBeenCalled();expect(mockApi).not.toHaveBeenCalled();expect(mockRegistration).not.toHaveBeenCalled();
  }finally{view.unmount();}
});
