// The verified server account of the current sign-in (GET /v1/me), kept apart from the local learner: a
// learner ID is never replaced by, or derived from, an account or profile ID. Local account datasets are
// named by the verified account ID (see datasets.ts), never by an address or an earlier session.
import { accountNamespace, type Namespace } from '@/account/datasets';
import type { ApiClient, ProfileSummary } from '@/api/client';
import { AuthError, type AuthStatus, type SessionAuth } from '@/auth/types';

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
