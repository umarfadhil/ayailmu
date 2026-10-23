import { router, type Href } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useAccount } from '@/ui/AccountContext';
import { AccountDataPanel } from '@/ui/account/AccountDataPanel';
import { AccountDeletionPanel } from '@/ui/account/AccountDeletionPanel';
import { accountExportDeliveryLabel, deliverAccountExport } from '@/ui/account/accountExportDelivery';
import { BackLink } from '@/ui/BackLink';
import { Btn, Notice, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';
import { colors, fonts } from '@/ui/theme';
/** No learner-only guard: deletion returns learning to guest, which can be empty. */
function DataRoute() {
 const account = useAccount(); const deletion = account.deletion;
 const exportReady = account.dataControls && account.panel.account && !deletion?.state.busy;
 return <Page>
  <BackLink />
  <Text accessibilityRole="header" style={styles.title}>Data akun</Text>
  {exportReady ? <AccountDataPanel accountKey={account.panel.account!.key} onExport={account.dataControls!.exportData} onDeliver={deliverAccountExport} deliveryLabel={accountExportDeliveryLabel} rememberChoice={account.panel.rememberChoice} /> : null}
  {deletion ? <AccountDeletionPanel model={deletion} rememberChoice={account.panel.rememberChoice} /> : null}
  {!account.signedIn ? <>
   <Notice tone="info">Masuk ke akun untuk mengelola data akun.</Notice>
   <Btn label="Masuk ke akun" kind="secondary" onPress={() => router.push('/account' as Href)} />
  </> : null}
  {account.signedIn && !deletion ? <Notice tone="info">Penghapusan memerlukan akses tulis ke salinan akun di perangkat ini. Tutup tab lain yang memakai akun, lalu masuk lagi.</Notice> : null}
  {account.signedIn ? <Btn testID="account-data-signout" label="Keluar dari akun" kind="secondary" onPress={account.panel.onSignOut} disabled={account.panel.busy === 'signout'} /> : null}
 </Page>;
}
const styles = StyleSheet.create({ title: { fontFamily: fonts.extrabold, color: colors.ink, fontSize: 28, lineHeight: 36, textAlign: 'left', writingDirection: 'ltr' } });
export default function AccountData() { return <HydrationGate><DataRoute /></HydrationGate>; }
