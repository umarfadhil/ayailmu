// Re-authenticating the signed-in account with its password before an export or deletion, RED (regression-first):
// the proposed reauthenticateOwnAccount of account/session.ts, driven through small typed fakes of its two ports with
// controlled timing. It signs in once with the password and the address captured at its start, then verifies once,
// and returns the verified account only while it is still the caller's turn and the fresh sign-in, the current
// session and the verified account are all exactly the expected account's own. Otherwise it refuses with an
// AuthError and sends nothing further; a refused sign-in's own rejection propagates as it is. Every case first asserts
// that the export is a function, so a missing one cannot pass for a refusal. Orchestration only: no Auth server, SDK,
// API or device runs here, and the server's own recent-sign-in check stays authoritative. Deletion reconciliation,
// datasets, sign-out and screens are not covered.
import { accountNamespace } from '@/account/datasets';
import * as sessionModule from '@/account/session';
import { AuthError, type AccountAuth, type AuthIdentity, type AuthStatus } from '@/auth/types';

type VerifiedAccount = sessionModule.VerifiedAccount;
type AccountSession = sessionModule.AccountSession;

/** The proposed export, typed here before session.ts declares it. */
interface ProposedReauth {
  reauthenticateOwnAccount(input: {
    auth: Pick<AccountAuth, 'status' | 'signIn'>;
    session: Pick<AccountSession, 'verify'>;
    expected: Pick<VerifiedAccount, 'accountId' | 'uid'>;
    password: string;
    isCurrent: () => boolean;
  }): Promise<VerifiedAccount>;
}
const proposed = sessionModule as typeof sessionModule & Partial<ProposedReauth>;

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const ID_A: AuthIdentity = { uid: 'uid-A', email: 'learner.a@ayailmu.test', expiresAt: null };
const ID_B: AuthIdentity = { uid: 'uid-B', email: 'learner.b@ayailmu.test', expiresAt: null };
const PASSWORD = 'fixture-password-for-A';
const ACCOUNT_A: VerifiedAccount = { accountId: A, uid: ID_A.uid, profiles: [], namespace: accountNamespace(A) };
const ACCOUNT_B: VerifiedAccount = { accountId: B, uid: ID_B.uid, profiles: [], namespace: accountNamespace(B) };
const signedIn = (identity: AuthIdentity, session: number): AuthStatus => ({ state: 'signed-in', identity, session });
const SIGN_IN = ['signIn', ID_A.email, PASSWORD];
const VERIFY = ['verify'];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}
function deferred<T>(list: Deferred<T>[]): Promise<T> {
  const entry = {} as Deferred<T>;
  entry.promise = new Promise<T>((resolve, reject) => Object.assign(entry, { resolve, reject }));
  list.push(entry);
  return entry.promise;
}

/**
 * Typed fakes of the two ports, logging every call in order; each sign-in and verification settles when the test
 * says. No refresh, sign-out or authorized call is offered: the step-up may use none of them.
 */
function ports(initial: AuthStatus) {
  let status = initial;
  const calls: unknown[][] = [];
  const grants: Deferred<AuthIdentity>[] = [];
  const verifications: Deferred<VerifiedAccount>[] = [];
  const auth: Pick<AccountAuth, 'status' | 'signIn'> = {
    status: () => status,
    signIn(email, password) {
      calls.push(['signIn', email, password]);
      return deferred(grants);
    },
  };
  const session: Pick<AccountSession, 'verify'> = {
    verify() {
      calls.push(['verify']);
      return deferred(verifications);
    },
  };
  return {
    auth,
    session,
    calls,
    grants,
    verifications,
    setStatus(next: AuthStatus) {
      status = next;
    },
    /** The provider grants the pending sign-in: its new session is current before the grant arrives, as AccountAuth does. */
    grant(identity: AuthIdentity, number: number) {
      status = signedIn(identity, number);
      grants[0].resolve(identity);
    },
  };
}
type Ports = ReturnType<typeof ports>;

/** Lets the step-up run up to the next port call it awaits. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Starts the proposed step-up for account A with the fixture password; its outcome is handled at once. */
function start(p: Ports, expected = { accountId: A, uid: ID_A.uid }, isCurrent: () => boolean = () => true) {
  const reauthenticate = proposed.reauthenticateOwnAccount;
  expect(typeof reauthenticate).toBe('function');
  return reauthenticate!({ auth: p.auth, session: p.session, expected, password: PASSWORD, isCurrent }).then(
    (account) => ({ account, error: undefined as unknown }),
    (error: unknown) => ({ account: undefined, error })
  );
}

const LOGS = ['log', 'info', 'warn', 'error', 'debug'] as const;
beforeEach(() => LOGS.forEach((method) => jest.spyOn(console, method)));
afterEach(() => jest.restoreAllMocks());

/** Whether the fixture password shows in `error` or in anything written to the console. */
function leaked(error: unknown): boolean {
  const logged = LOGS.flatMap((method) => (console[method] as unknown as jest.Mock).mock.calls.flat() as unknown[]);
  return [error, ...logged].some((value) =>
    (value instanceof Error ? `${value.message}\n${value.stack ?? ''}` : typeof value === 'string' ? value : (JSON.stringify(value) ?? '')).includes(PASSWORD)
  );
}

it.each([
  { name: 'a signed-in session', initial: signedIn(ID_A, 7) },
  { name: 'an expired session', initial: { state: 'expired', identity: ID_A } as AuthStatus },
])('signs in once with the captured address and password, verifies once and returns its own account, from $name', async ({ initial }) => {
  const p = ports(initial);
  const expected = { accountId: A, uid: ID_A.uid };
  const outcome = start(p, expected);
  // Captured at the start: the caller changing its object afterwards redirects nothing.
  Object.assign(expected, { accountId: B, uid: ID_B.uid });
  await flush();
  expect(p.calls).toEqual([SIGN_IN]);
  p.grant(ID_A, 8); // the fresh password sign-in is a new session: 8, not the 7 it may have started from
  await flush();
  expect(p.calls).toEqual([SIGN_IN, VERIFY]);
  p.verifications[0].resolve(ACCOUNT_A);
  const { account, error } = await outcome;
  expect(error).toBeUndefined();
  expect(account).toEqual(ACCOUNT_A);
  expect(p.calls).toEqual([SIGN_IN, VERIFY]);
  expect(leaked(error)).toBe(false);
});

it.each([
  { name: 'the password sign-in grants another provider account', grantedTo: ID_B, answer: ACCOUNT_B, calls: [SIGN_IN] },
  { name: 'verification answers another account', grantedTo: ID_A, answer: { ...ACCOUNT_A, accountId: B, namespace: accountNamespace(B) }, calls: [SIGN_IN, VERIFY] },
])('refuses, accepting no account, when $name', async ({ grantedTo, answer, calls }) => {
  const p = ports(signedIn(ID_A, 7));
  const outcome = start(p);
  await flush();
  p.grant(grantedTo, 8);
  await flush();
  for (const verification of p.verifications) verification.resolve(answer);
  const { account, error } = await outcome;
  expect(account).toBeUndefined();
  expect(error).toBeInstanceOf(AuthError);
  expect(p.calls).toEqual(calls);
  expect(leaked(error)).toBe(false);
});

it.each([
  { name: 'before it starts', endsAt: 'start', calls: [] },
  { name: 'while the password sign-in is on its way', endsAt: 'grant', calls: [SIGN_IN] },
  { name: 'while verification is on its way', endsAt: 'verify', calls: [SIGN_IN, VERIFY] },
])("refuses once the caller's turn has ended $name, sending nothing after it", async ({ endsAt, calls }) => {
  let current = endsAt !== 'start';
  const p = ports(signedIn(ID_A, 7));
  const outcome = start(p, undefined, () => current);
  await flush();
  if (endsAt === 'grant') current = false;
  if (p.grants.length) p.grant(ID_A, 8);
  await flush();
  if (endsAt === 'verify') current = false;
  for (const verification of p.verifications) verification.resolve(ACCOUNT_A);
  const { account, error } = await outcome;
  expect(account).toBeUndefined();
  expect(error).toBeInstanceOf(AuthError);
  expect(p.calls).toEqual(calls);
  expect(leaked(error)).toBe(false);
});

it.each([
  { name: 'account B signs in', now: signedIn(ID_B, 9) },
  { name: 'a newer sign-in of the same account replaces it', now: signedIn(ID_A, 9) },
])('refuses a verification that arrives after $name, though the caller still says it is current', async ({ now }) => {
  const p = ports(signedIn(ID_A, 7));
  const outcome = start(p);
  await flush();
  p.grant(ID_A, 8);
  await flush();
  expect(p.calls).toEqual([SIGN_IN, VERIFY]);
  p.setStatus(now);
  p.verifications[0].resolve(ACCOUNT_A);
  const { account, error } = await outcome;
  expect(account).toBeUndefined();
  expect(error).toBeInstanceOf(AuthError);
  expect(p.calls).toEqual([SIGN_IN, VERIFY]);
  expect(leaked(error)).toBe(false);
});

it('lets a refused password sign-in reject as it is, without verifying', async () => {
  const p = ports(signedIn(ID_A, 7));
  const outcome = start(p);
  await flush();
  const refusal = new AuthError('invalid_credentials');
  p.grants[0].reject(refusal);
  const { account, error } = await outcome;
  expect(account).toBeUndefined();
  expect(error).toBe(refusal);
  expect(p.calls).toEqual([SIGN_IN]);
  expect(leaked(error)).toBe(false);
});
