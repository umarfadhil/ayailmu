import { useAccount } from '@/ui/AccountContext';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { BackLink } from '@/ui/BackLink';
import { Notice, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';

/** «Akun lokal»: sign-in, the adult profile, the explicit guest copy and manual sync of the local developer pilot. */
function AccountRoute() {
  const account = useAccount();
  return (
    <Page>
      <BackLink />
      {account.enabled ? (
        <AccountPanel {...account.panel} />
      ) : (
        <Notice tone="info" testID="account-disabled">
          Akun lokal tidak aktif di build ini. Belajar tetap bisa tanpa akun; data tetap di perangkat ini.
        </Notice>
      )}
    </Page>
  );
}

export default function Account() {
  return (
    <HydrationGate>
      <AccountRoute />
    </HydrationGate>
  );
}
