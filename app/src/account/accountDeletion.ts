import { ApiError } from '@/api/client';
import { AuthError } from '@/auth/types';
import { reauthenticateOwnAccount } from './session';
import type { AccountControls, AccountDeletion } from '@/api/client';
import type { AccountAuth } from '@/auth/types';
import type { AccountSession, VerifiedAccount } from './session';
export type DeletionPhase = 'idle' | 'failed' | 'unknown' | 'pending' | 'completed';
export interface AccountDeletionState { phase: DeletionPhase; local: 'kept' | 'erased' | 'failed'; busy: boolean; proof?: AccountDeletion; issue?: 'credentials' | 'unavailable'; }
export interface AccountDeletionOptions {
 initialProof?: AccountDeletion;
 auth: AccountAuth; session: Pick<AccountSession, 'verify'>; expected: Pick<VerifiedAccount, 'accountId' | 'uid'>;
 controls: Pick<AccountControls, 'deleteAccount' | 'deletionStatus'>; quiesce(): Promise<void>; erase(): Promise<void>;
 isCurrent(): boolean; onState(state: AccountDeletionState): void;
}
export interface AccountDeletionController {
 state(): AccountDeletionState; remove(password: string, confirmed: boolean): Promise<void>; check(): Promise<void>;
 retryIdentity(password: string, confirmed: boolean): Promise<void>; retryCleanup(): Promise<void>;
}
/** In-run own-account deletion. No credentials or completion guesses are persisted. */
export function createAccountDeletionController(options: AccountDeletionOptions): AccountDeletionController {
 const { auth, session, controls, quiesce, erase, isCurrent, onState } = options;
 const expected = { ...options.expected };
 if (options.initialProof && options.initialProof.account_id !== expected.accountId) throw new Error('Not an own deletion proof');
 let view: AccountDeletionState = { phase: options.initialProof ? (options.initialProof.status === 'completed' ? 'completed' : 'pending') : 'idle', local: 'kept', busy: false, ...(options.initialProof ? { proof: options.initialProof } : {}) };
 let working = false;
 const fence = () => { if (!isCurrent()) throw new AuthError('superseded'); };
 const own = () => { fence(); const now = auth.status(); if (now.state === 'signed-out' || now.identity.uid !== expected.uid) throw new AuthError('signed_out'); return now; };
 const emit = (patch: Partial<AccountDeletionState>) => { fence(); view = { ...view, ...patch }; onState({ ...view }); };
 async function cleanup() {
  fence();
  if (!view.proof || view.proof.account_id !== expected.accountId || view.local === 'erased') return;
  try { await erase(); fence(); emit({ local: 'erased' }); }
  catch { fence(); emit({ local: 'failed' }); }
 }
 async function accept(proof: AccountDeletion) {
  own(); if (proof.account_id !== expected.accountId) throw new ApiError(200, 'bad_response');
  emit({ proof, phase: proof.status === 'completed' ? 'completed' : 'pending', issue: undefined });
  await cleanup();
 }
 async function run(job: () => Promise<void>) {
  if (working) throw new Error('Account operation already running');
  own(); working = true; emit({ busy: true, issue: undefined });
  try { await job(); }
  catch (error) {
   fence();
   emit({ phase: view.phase === 'idle' ? 'failed' : view.phase, issue: error instanceof AuthError && error.code === 'invalid_credentials' ? 'credentials' : 'unavailable' });
  } finally { working = false; if (isCurrent()) emit({ busy: false }); }
 }
 async function post() {
  own();
  // Mark before sending: a lost reply must never authorize a repeat or local erasure.
  const earlierProof = view.proof;
  emit({ phase: 'unknown' });
  try { await accept(await auth.authorized((token, signal) => controls.deleteAccount(token, signal))); }
  catch (error) {
   fence();
   if (earlierProof) emit({ phase: earlierProof.status === 'completed' ? 'completed' : 'pending' });
   else if (error instanceof ApiError && error.status === 503 && error.code === 'account_deletion_failed') emit({ phase: 'failed' });
   throw error;
  }
 }
 async function directProof() {
  const start = own();
  if (start.state === 'expired') { await auth.refresh(); own(); }
  const proof = await auth.authorized((token, signal) => controls.deletionStatus(token, signal));
  own();
  if (!proof) { emit({ phase: 'unknown', issue: 'unavailable' }); return null; }
  if (proof.account_id !== expected.accountId) throw new ApiError(200, 'bad_response');
  return proof;
 }
 return {
  state: () => ({ ...view }),
  async remove(password, confirmed) {
   if (!confirmed || !password || !['idle', 'failed'].includes(view.phase)) throw new Error('Explicit initial confirmation required');
   await run(async () => {
    await reauthenticateOwnAccount({ auth, session, expected, password, isCurrent }); own();
    await quiesce(); own(); await post();
   });
  },
  async check() {
   if (view.phase === 'idle' || view.phase === 'failed') throw new Error('No deletion request to reconcile');
   await run(async () => { const proof = await directProof(); if (proof) await accept(proof); });
  },
  async retryIdentity(password, confirmed) {
   if (!confirmed || !password || view.phase !== 'pending') throw new Error('Explicit pending-deletion retry required');
   await run(async () => {
    const start = own(); const oldSession = start.state === 'signed-in' ? start.session : null;
    const granted = await auth.signIn(start.identity.email, password); const fresh = own();
    if (granted.uid !== expected.uid || fresh.state !== 'signed-in' || fresh.session === oldSession) throw new AuthError('superseded');
    // /me is410 after erasure; only the same owner's deletion route can prove a retry's scope.
    const proof = await directProof(); if (!proof) return;
    const now = own(); if (now.state !== 'signed-in' || now.session !== fresh.session) throw new AuthError('superseded');
    if (proof.status === 'completed') await accept(proof); else await post();
   });
  },
  async retryCleanup() {
   if (!view.proof || view.local === 'erased') throw new Error('No proven cleanup to retry');
   await run(cleanup);
  },
 };
}
