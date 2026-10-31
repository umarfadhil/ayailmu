import { accountNamespace } from '../datasets';
import { createAccountDeletionController, type AccountDeletionState } from '../accountDeletion';
import { type AccountDeletion } from '@/api/client';
import { type AccountAuth, type AuthStatus } from '@/auth/types';
const ID = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const pending: AccountDeletion = { deletion_id: '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687', account_id: ID, requested_at: '2026-10-23T02:00:00Z', server_data: { status: 'erased', erased_at: '2026-10-23T02:00:00Z', profiles: 1, device_links: 1, events: 2, imports: 0 }, status: 'identity_deletion_pending', identity_provider: { status: 'pending', attempts: 1 }, not_deleted: [{ what: 'deletion_record', why: 'retained' }, { what: 'device_data', why: 'other devices' }] };
function setup(initialProof?: AccountDeletion) {
 const identity = { uid: 'owner-uid', email: 'owner@example.org', expiresAt: null }; let status: AuthStatus = { state: 'signed-in', identity, session: 1 }; let current = true; let seq = 1; const trace: string[] = []; const states: AccountDeletionState[] = [];
 const auth: AccountAuth = { status: () => status, signIn: jest.fn(async () => { trace.push('password'); status = { state: 'signed-in', identity, session: ++seq }; return identity; }), refresh: jest.fn(async () => { status = { state: 'signed-in', identity, session: seq }; return identity; }), signOut: jest.fn(async () => { status = { state: 'signed-out' }; return { revoked: true }; }), authorized: async (call) => call('fixture-token', new AbortController().signal) };
 const session = { verify: jest.fn(async () => { trace.push('verify'); return { accountId: ID, uid: identity.uid, profiles: [], namespace: accountNamespace(ID) }; }) };
 const controls = { deleteAccount: jest.fn(async () => { trace.push('delete'); return pending; }), deletionStatus: jest.fn(async (): Promise<AccountDeletion | null> => pending) };
 const quiesce = jest.fn(async () => { trace.push('guest'); }); const erase = jest.fn(async () => { trace.push('erase'); });
 const c = createAccountDeletionController({ initialProof, auth, session, expected: { accountId: ID, uid: identity.uid }, controls, quiesce, erase, isCurrent: () => current, onState: (s) => states.push(s) });
 return { c, auth, session, controls, quiesce, erase, trace, states, expire: () => { status = { state: 'expired', identity }; }, replace: () => { current = false; status = { state: 'signed-in', identity: { ...identity, uid: 'B-uid' }, session: ++seq }; } };
}

it('adopts a freshly authenticated own proof after restart and cleans only after explicit continuation, without another POST or /me',async()=>{const x=setup(pending); expect(x.c.state()).toMatchObject({phase:'pending',local:'kept'}); expect(x.erase).not.toHaveBeenCalled(); await x.c.retryCleanup(); expect(x.c.state()).toMatchObject({phase:'pending',local:'erased'}); expect(x.erase).toHaveBeenCalledTimes(1); expect(x.session.verify).not.toHaveBeenCalled(); expect(x.controls.deleteAccount).not.toHaveBeenCalled();});
it('refuses another account initial proof before cleanup or status calls',()=>{expect(()=>setup({...pending,account_id:'5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687'})).toThrow();});
