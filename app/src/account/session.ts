// The verified server account of the current sign-in (GET /v1/me), kept apart from the local learner: a
// learner ID is never replaced by, or derived from, an account or profile ID. Local account datasets are
// named by the verified account ID (see datasets.ts), never by an address or an earlier session.
import { accountNamespace, type Namespace } from '@/account/datasets';
import type { AccountControls, ApiClient, ProfileSummary } from '@/api/client';
import { AuthError, type AccountAuth, type AuthStatus, type SessionAuth } from '@/auth/types';

export interface VerifiedAccount {
  accountId: string;
  uid: string;
  profiles: ProfileSummary[];
  /** The local dataset of this account: accountNamespace(accountId). */
  namespace: Namespace;
}

export interface AccountSession {
  /** Verifies the current sign-in with GET /v1/me. A result for an ended or replaced session is dropped. */
  verify(): Promise<VerifiedAccount>;
  /** The verified account of the current sign-in, or null after sign-out, a newer sign-in or expiry. */
  current(): VerifiedAccount | null;
}

type SignedIn = Extract<AuthStatus, { state: 'signed-in' }>;

const copyOf = (account: VerifiedAccount): VerifiedAccount => ({
  accountId: account.accountId,
  uid: account.uid,
  profiles: account.profiles.map((p) => ({ ...p })),
  namespace: { ...account.namespace },
});

export function createAccountSession({ auth, api }: { auth: SessionAuth; api: ApiClient }): AccountSession {
  /** The verified account and the sign-in (session number) it belongs to; visible only while that sign-in is current. */
  let verified: { session: number; account: VerifiedAccount } | null = null;

  const signedIn = (): SignedIn | null => {
    const status = auth.status();
    return status.state === 'signed-in' ? status : null;
  };

  return {
    async verify() {
      const started = signedIn();
      // authorized() drops the reply of a session that ends or is replaced while /v1/me is on its way.
      const me = await auth.authorized((token, signal) => api.me(token, signal));
      // And nothing may have changed between that reply and now: the account is published for this sign-in only.
      const now = signedIn();
      if (!started || !now || now.session !== started.session) throw new AuthError(now ? 'superseded' : 'signed_out');
      const account: VerifiedAccount = {
        accountId: me.accountId,
        uid: now.identity.uid,
        profiles: me.profiles.map((p) => ({ ...p })),
        namespace: accountNamespace(me.accountId),
      };
      verified = { session: now.session, account };
      return copyOf(account);
    },

    current() {
      const now = signedIn();
      if (!verified || !now || now.session !== verified.session) {
        verified = null; // signed out, replaced or expired: nothing stale stays behind
        return null;
      }
      return copyOf(verified.account);
    },
  };
}

/**
 * The initial password step-up before an export or deletion of the signed-in account's data, as orchestration only:
 * one password sign-in under the address of the sign-in it starts from, then one verification. It returns the
 * verified account only while it is still the caller's turn (`isCurrent`, which the caller owns and ends when it
 * abandons the request) and the fresh sign-in, the current session and the verified account are all exactly
 * `expected`'s own; otherwise it refuses with an AuthError and sends nothing further. A refused sign-in rejects as the
 * adapter rejected it. The server's recent-password check stays authoritative: this only obtains a fresh password
 * sign-in and binds it to its owner and turn. That sign-in replaces the session, and whatever the adapter remembers of
 * it changes with it; nothing earlier is restored. A pending or unknown deletion must not be reconciled through this:
 * once the server has erased the account, /v1/me answers 410, so that needs its own proof from the own-deletion route.
 * Wiring it into a controller or Settings is still to come.
 */
export async function reauthenticateOwnAccount({
  auth,
  session,
  expected,
  password,
  isCurrent,
}: {
  auth: Pick<AccountAuth, 'status' | 'signIn'>;
  session: Pick<AccountSession, 'verify'>;
  expected: Pick<VerifiedAccount, 'accountId' | 'uid'>;
  password: string;
  isCurrent: () => boolean;
}): Promise<VerifiedAccount> {
  // Bound before anything is awaited: the caller changing `expected` afterwards redirects nothing.
  const { accountId, uid } = expected;
  const start = auth.status();
  const refusal = (status: AuthStatus) => new AuthError(status.state === 'signed-out' ? 'signed_out' : 'superseded');
  if (start.state === 'signed-out' || start.identity.uid !== uid || !isCurrent()) throw refusal(start);
  const startedSession = start.state === 'signed-in' ? start.session : null;

  const granted = await auth.signIn(start.identity.email, password);
  // The caller's turn still, and a sign-in of the expected provider account, current in a new session.
  const fresh = auth.status();
  if (!isCurrent() || granted.uid !== uid || fresh.state !== 'signed-in' || fresh.identity.uid !== uid || fresh.session === startedSession) {
    throw refusal(fresh);
  }

  const account = await session.verify();
  // Still the caller's turn and that same fresh session, verified as the expected account's own.
  const now = auth.status();
  if (
    !isCurrent() ||
    now.state !== 'signed-in' ||
    now.session !== fresh.session ||
    now.identity.uid !== uid ||
    account.uid !== uid ||
    account.accountId !== accountId
  ) {
    throw refusal(now);
  }
  return account;
}

/**
 * The initial export action for the signed-in account's server data, as orchestration only: reauthenticateOwnAccount's
 * password step-up once, then GET /v1/me/export once through one authorized call. It returns the export, the server's
 * exact text, only while it is still the caller's turn (`isCurrent`, owned by the caller), the session the export was
 * asked in is still current and the reply is `expected`'s own; otherwise it refuses with an AuthError. A failed step-up
 * or export rejects unchanged. The server's authorization and recent-password check stay authoritative, and the result
 * is the server's copy only: guest data and unsent records stay on the device. No deletion is reconciled through this
 * or /v1/me. Settings, delivering the file and a controller are still to come.
 */
export async function exportOwnAccountData({
  auth,
  session,
  expected,
  controls,
  password,
  isCurrent,
}: {
  auth: Pick<AccountAuth, 'status' | 'signIn' | 'authorized'>;
  session: Pick<AccountSession, 'verify'>;
  expected: Pick<VerifiedAccount, 'accountId' | 'uid'>;
  controls: Pick<AccountControls, 'exportData'>;
  password: string;
  isCurrent: () => boolean;
}): Promise<{ accountId: string; json: string }> {
  // Bound before anything is awaited: the caller changing `expected` afterwards redirects nothing.
  const { accountId, uid } = expected;
  const refusal = (status: AuthStatus) => new AuthError(status.state === 'signed-out' ? 'signed_out' : 'superseded');
  await reauthenticateOwnAccount({ auth, session, expected: { accountId, uid }, password, isCurrent });

  // Still the caller's turn and the expected account's sign-in: the export belongs to this session only.
  const started = auth.status();
  if (!isCurrent() || started.state !== 'signed-in' || started.identity.uid !== uid) throw refusal(started);

  const reply = await auth.authorized((token, signal) => controls.exportData(token, signal));
  // Still the caller's turn in that same session, and the expected account's own export.
  const now = auth.status();
  if (!isCurrent() || now.state !== 'signed-in' || now.session !== started.session || now.identity.uid !== uid || reply.accountId !== accountId) {
    throw refusal(now);
  }
  // The server's own text, never parsed or re-serialized.
  return { accountId, json: reply.json };
}
