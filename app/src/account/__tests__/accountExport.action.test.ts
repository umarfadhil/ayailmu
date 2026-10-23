// Exporting the signed-in account's server data after a password step-up, RED (regression-first), three cases only:
// the proposed exportOwnAccountData of account/session.ts, over small typed fakes of its ports, with the real
// reauthenticateOwnAccount inside it. It signs in once with the password, verifies once, then asks for the export once
// through an authorized call, and returns the server's text exactly, only while it is still the caller's turn and the
// reply is the expected account's own. Every case first asserts that the export exists, so a missing one cannot pass
// for a refusal. Orchestration only: no Auth server, API, network or device runs here, the server's recent-password
// check stays authoritative, and the result is the server's copy only. Deletion, its reconciliation and screens are
// not covered.
import { accountNamespace } from '@/account/datasets';
import * as sessionModule from '@/account/session';
import type { AccountControls } from '@/api/client';
import type { AccountAuth, AuthIdentity, AuthStatus } from '@/auth/types';

type VerifiedAccount = sessionModule.VerifiedAccount;
type AccountSession = sessionModule.AccountSession;
type ExportResult = Awaited<ReturnType<AccountControls['exportData']>>;

/** The proposed export, typed here before session.ts declares it. */
interface ProposedExport {
  exportOwnAccountData(input: {
    auth: Pick<AccountAuth, 'status' | 'signIn' | 'authorized'>;
    session: Pick<AccountSession, 'verify'>;
    expected: Pick<VerifiedAccount, 'accountId' | 'uid'>;
    controls: Pick<AccountControls, 'exportData'>;
    password: string;
    isCurrent: () => boolean;
  }): Promise<ExportResult>;
}
const proposed = sessionModule as typeof sessionModule & Partial<ProposedExport>;

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const ID_A: AuthIdentity = { uid: 'uid-A', email: 'learner.a@ayailmu.test', expiresAt: null };
const PASSWORD = 'dummy-password-for-A';
const TOKEN = 'fixture-access-token';
const ACCOUNT_A: VerifiedAccount = { accountId: A, uid: ID_A.uid, profiles: [], namespace: accountNamespace(A) };
/** The server's export text, spacing and all: only an exact copy keeps it. */
const EXPORT_A = `{\n  "account_id" : "${A}",\n\t"profiles": [ ],  "exported_at": "2026-10-23T01:00:00.000Z" }\n`;
const EXPORT_B = `{ "account_id": "${B}", "profiles": [] }`;
const SIGN_IN = ['signIn', ID_A.email, PASSWORD];
const VERIFY = ['verify'];
const AUTHORIZED = ['authorized'];
/** The export asked for with the fixture token and the very signal authorized() issued for it. */
const EXPORT = ['exportData', TOKEN, true];

/**
 * Typed fakes of the three ports, logging every call in order. The password sign-in makes account A's new session (8)
 * current in place of session 7, as a password sign-in does; verification answers account A; authorized() hands its
 * call the fixture token and a fresh signal. The export answers with `exportReply`. No refresh, sign-out or other
 * port is offered.
 */
function ports(exportReply: () => Promise<ExportResult>) {
  let status: AuthStatus = { state: 'signed-in', identity: ID_A, session: 7 };
  let issued: AbortSignal | undefined;
  const calls: unknown[][] = [];
  const auth: Pick<AccountAuth, 'status' | 'signIn' | 'authorized'> = {
    status: () => status,
    async signIn(email, password) {
      calls.push(['signIn', email, password]);
      status = { state: 'signed-in', identity: ID_A, session: 8 };
      return ID_A;
    },
    authorized<T>(call: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
      calls.push(['authorized']);
      issued = new AbortController().signal;
      return call(TOKEN, issued);
    },
  };
  const session: Pick<AccountSession, 'verify'> = {
    async verify() {
      calls.push(['verify']);
      return ACCOUNT_A;
    },
  };
  const controls: Pick<AccountControls, 'exportData'> = {
    exportData(token, signal) {
      calls.push(['exportData', token, signal !== undefined && signal === issued]);
      return exportReply();
    },
  };
  return { auth, session, controls, calls };
}
type Ports = ReturnType<typeof ports>;

/** A promise and the function that resolves it. */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value: T) => settle(value) };
}

/** Starts the proposed export for account A with the dummy password; its outcome is handled at once. */
function start(p: Ports, isCurrent: () => boolean) {
  const exportOwn = proposed.exportOwnAccountData;
  expect(typeof exportOwn).toBe('function');
  return exportOwn!({ auth: p.auth, session: p.session, expected: { accountId: A, uid: ID_A.uid }, controls: p.controls, password: PASSWORD, isCurrent }).then(
    (result) => ({ result, error: undefined as unknown }),
    (error: unknown) => ({ result: undefined, error })
  );
}

it('exports account A after one password sign-in and one verification, through one authorized call, keeping the server text exactly', async () => {
  const p = ports(async () => ({ accountId: A, json: EXPORT_A }));
  const { result, error } = await start(p, () => true);
  expect(error).toBeUndefined();
  // The reply's own text, whitespace included: never re-serialized.
  expect(result).toEqual({ accountId: A, json: EXPORT_A });
  expect(p.calls).toEqual([SIGN_IN, VERIFY, AUTHORIZED, EXPORT]);
});

it("drops an export reply that arrives after the caller's turn has ended, without retrying", async () => {
  let current = true;
  const reached = deferred<void>();
  const reply = deferred<ExportResult>();
  const p = ports(() => {
    reached.resolve();
    return reply.promise;
  });
  const outcome = start(p, () => current);
  // Held at the server's reply. An implementation that never asks for the export settles first instead of hanging.
  await Promise.race([reached.promise, outcome]);
  current = false;
  reply.resolve({ accountId: A, json: EXPORT_A });
  const { result, error } = await outcome;
  expect(result).toBeUndefined();
  expect(error).toBeInstanceOf(Error);
  expect(p.calls).toEqual([SIGN_IN, VERIFY, AUTHORIZED, EXPORT]);
});

it('refuses an export that answers for another account', async () => {
  const p = ports(async () => ({ accountId: B, json: EXPORT_B }));
  const { result, error } = await start(p, () => true);
  expect(result).toBeUndefined();
  expect(error).toBeInstanceOf(Error);
  expect(p.calls).toEqual([SIGN_IN, VERIFY, AUTHORIZED, EXPORT]);
});
