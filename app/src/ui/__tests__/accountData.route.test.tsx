import { render } from '@testing-library/react-native';
import type { AccountContextValue, AccountDeletionModel } from '@/ui/AccountContext';
import AccountData from '@/app/account-data';
let mockAccount: Partial<AccountContextValue>;
jest.mock('@/ui/AccountContext',()=>({useAccount:()=>mockAccount}));
jest.mock('@/ui/Hydration',()=>({HydrationGate:({children}: {children: React.ReactNode})=>children}));
jest.mock('@/ui/BackLink',()=>({BackLink:()=>null}));
jest.mock('expo-router',()=>({router:{push:jest.fn()}}));
jest.mock('@/ui/components',()=>{const actual=jest.requireActual('@/ui/components'); const {View}=jest.requireActual('react-native'); return {...actual,Page:({children}: {children: React.ReactNode})=><View>{children}</View>};});
it('allows own account export with an empty guest and no learner-dependent redirect',async()=>{
 mockAccount={enabled:true,signedIn:true,panel:{account:{key:'A',label:'fixture@example.org'}} as AccountContextValue['panel'],dataControls:{exportData:jest.fn()}};
 const v=await render(<AccountData/>); expect(v.getByText('Data akun')).toBeTruthy(); expect(v.getByTestId('account-data-password')).toBeTruthy();
});
it('keeps pending deletion visible even after signed-out guest has no learner',async()=>{
 const deletion:AccountDeletionModel={key:'A',state:{phase:'pending',local:'erased',busy:false},available:false,remove:jest.fn(),check:jest.fn(),retryIdentity:jest.fn(),retryCleanup:jest.fn()};
 mockAccount={enabled:true,signedIn:false,panel:{account:null} as AccountContextValue['panel'],deletion}; const v=await render(<AccountData/>); expect(v.getByText('Data server sudah dihapus. Penghapusan akun masuk masih tertunda.')).toBeTruthy(); expect(v.queryByTestId('account-data-password')).toBeNull();
});
it('offers sign-in instead of a fictitious guest export when no account is verified',async()=>{
 mockAccount={enabled:true,signedIn:false,panel:{account:null} as AccountContextValue['panel']}; const v=await render(<AccountData/>); expect(v.getByText('Masuk ke akun untuk mengelola data akun.')).toBeTruthy(); expect(v.queryByTestId('account-data-prepare')).toBeNull();
});
