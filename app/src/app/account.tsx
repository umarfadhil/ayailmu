import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, type EffectCallback } from 'react';

import { useAccount } from '@/ui/AccountContext';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { BackLink } from '@/ui/BackLink';
import { Btn, Notice, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';

/** For a mocked or embedded host without a focus API: the route's own lifetime stands in for its focus. */
function useMountEffect(effect: EffectCallback) {
  useEffect(effect, [effect]);
}
// Chosen once per module, never per render or per registration: Expo Router's own focus effect wherever it has one.
const useRouteFocusEffect: (effect: EffectCallback) => void = typeof useFocusEffect === 'function' ? useFocusEffect : useMountEffect;

/** «Akun lokal»: sign-in, the adult profile, the explicit guest copy and manual sync of the local developer pilot. */
function AccountRoute() {
  const account = useAccount();
  // Leaving the route (blur or unmount) ends the registration it shows, through that registration's own cancel; an
  // ordinary stage or busy rerender keeps the same onCancel, so it neither cancels nor resubscribes.
  const cancel = account.panel.registration?.onCancel;
  const endRegistration = useCallback(() => () => cancel?.(), [cancel]);
  useRouteFocusEffect(endRegistration);
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
