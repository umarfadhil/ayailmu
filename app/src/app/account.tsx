import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';

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
