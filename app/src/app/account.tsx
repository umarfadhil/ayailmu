import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useAccount } from '@/ui/AccountContext';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { BackLink } from '@/ui/BackLink';
import { Btn, Notice, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';

/** «Akun lokal»: sign-in, the adult profile, the explicit guest copy and manual sync of the local developer pilot. */
function AccountRoute() {
  const account = useAccount();
  const deleting = account.signedIn && account.deletion && ['unknown', 'pending', 'completed'].includes(account.deletion.state.phase);
  return (
    <Page>
      <BackLink />
      {account.enabled ? (
        deleting ? <Notice tone="info">{account.deletion?.state.phase === 'completed' ? 'Akun sudah dihapus. Lihat status di Data akun.' : 'Penghapusan akun sedang ditangani. Periksa status di Data akun.'}</Notice> : <AccountPanel {...account.panel} />
      ) : (
        <Notice tone="info" testID="account-disabled">
          Akun lokal tidak aktif di build ini. Belajar tetap bisa tanpa akun; data tetap di perangkat ini.
        </Notice>
      )}
      {account.dataControls || account.deletion ? <Btn testID="account-data-open" label="Data akun" kind="secondary" onPress={() => router.push('/account-data' as Href)} disabled={account.panel.busy !== null && account.panel.busy !== undefined} /> : null}
    </Page>
  );
}

export default function Account() {
  // A Google callback's query or fragment (its single-use code, or a refusal) never stays in the router's cached params:
  // this route is replaced by its bare self. The Google boundary took the real URL when the app loaded, before the
  // router could change it, and cleans the address bar itself.
  const params = useLocalSearchParams();
  const withParams = Object.keys(params).length > 0;
  useEffect(() => {
    if (withParams) router.replace('/account' as Href);
  }, [withParams]);
  return (
    <HydrationGate>
      <AccountRoute />
    </HydrationGate>
  );
}
