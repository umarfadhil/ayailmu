// Entry guards of the proposed reauthenticateOwnAccount (account/session.ts), RED (regression-first): the password
// step-up for account A refuses with an AuthError, before signing in or verifying, when the sign-in it starts from is
// not A's own, and refuses before verifying when the password sign-in leaves the old session current. Small typed
// fakes of its two ports settle at once, so a guard that fails cannot hide behind a pending promise; every case first
// asserts that the export is a function. Orchestration only: no Auth server, SDK, API or device runs here.
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
const ID_A: AuthIdentity = { uid: 'uid-A', email: 'learner.a@ayailmu.test', expiresAt: null };
const ID_B: AuthIdentity = { uid: 'uid-B', email: 'learner.b@ayailmu.test', expiresAt: null };
const PASSWORD = 'dummy-password-for-A';
const ACCOUNT_A: VerifiedAccount = { accountId: A, uid: ID_A.uid, profiles: [], namespace: accountNamespace(A) };

/**
 * Typed fakes of the two ports, settling at once. A sign-in succeeds as account A and, as a password sign-in does,
 * makes a new session (8) current, unless `keepSession` leaves the old one; verification answers account A.
 */
function ports(initial: AuthStatus, { keepSession = false } = {}) {
  let status = initial;
  let verifies = 0;
  const signIns: [string, string][] = [];
  const auth: Pick<AccountAuth, 'status' | 'signIn'> = {
    status: () => status,
    async signIn(email, password) {
      signIns.push([email, password]);
      if (!keepSession) status = { state: 'signed-in', identity: ID_A, session: 8 };
      return ID_A;
    },
  };
  const session: Pick<AccountSession, 'verify'> = {
    async verify() {
      verifies += 1;
      return ACCOUNT_A;
    },
  };
  return { auth, session, signIns, verifies: () => verifies };
}

/** Runs the proposed step-up for account A with the dummy password, and gives what it rejected with. */
function refusalOf(p: ReturnType<typeof ports>): Promise<unknown> {
  const reauthenticate = proposed.reauthenticateOwnAccount;
  expect(typeof reauthenticate).toBe('function');
  return reauthenticate!({ auth: p.auth, session: p.session, expected: { accountId: A, uid: ID_A.uid }, password: PASSWORD, isCurrent: () => true }).then(
    () => 'resolved instead of rejecting',
    (error: unknown) => error
  );
}

it.each([
  { name: 'signed out', initial: { state: 'signed-out' } as AuthStatus },
  { name: 'signed in as uid-B', initial: { state: 'signed-in', identity: ID_B, session: 7 } as AuthStatus },
  { name: 'expired as uid-B', initial: { state: 'expired', identity: ID_B } as AuthStatus },
])('refuses before signing in or verifying when the sign-in it starts from is $name', async ({ initial }) => {
  const p = ports(initial);
  expect(await refusalOf(p)).toBeInstanceOf(AuthError);
  expect([p.signIns.length, p.verifies()]).toEqual([0, 0]);
});

it('refuses before verifying when the password sign-in leaves the old session current', async () => {
  const p = ports({ state: 'signed-in', identity: ID_A, session: 7 }, { keepSession: true });
  expect(await refusalOf(p)).toBeInstanceOf(AuthError);
  expect(p.signIns).toEqual([[ID_A.email, PASSWORD]]);
  expect(p.verifies()).toBe(0);
});
