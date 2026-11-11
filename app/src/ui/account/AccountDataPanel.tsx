import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthError } from '@/auth/types';
import { Btn } from '@/ui/components';
import { colors, fonts, radius } from '@/ui/theme';
export type AccountExportSnapshot = { accountId: string; json: string };
export type AccountExportDelivery = 'download-started' | 'share-opened' | 'cancelled';
export interface AccountDataPanelProps {
  accountKey: string;
  onExport(password: string): Promise<AccountExportSnapshot>;
  onDeliver(snapshot: AccountExportSnapshot): Promise<AccountExportDelivery>;
  deliveryLabel: string;
  rememberChoice?: boolean;
}
/** A new owner gets a new form; an earlier owner's asynchronous work cannot publish into it. */
export function AccountDataPanel(props: AccountDataPanelProps) { return <ExportForm key={props.accountKey} {...props} />; }
function ExportForm({ onExport, onDeliver, deliveryLabel, rememberChoice }: AccountDataPanelProps) {
 const [password, setPassword] = useState(''); const [snapshot, setSnapshot] = useState<AccountExportSnapshot | null>(null);
 const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
 const active = useRef(false); const working = useRef(false);
 useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
 async function prepare() {
  if (working.current) return;
  if (!password) { setStatus('Masukkan kata sandi.'); return; }
  const entered = password; setPassword(''); working.current = true; setBusy(true); setStatus('Menyiapkan salinan…');
  try { const result = await onExport(entered); if (active.current) { setSnapshot(result); setStatus('Salinan siap.'); } }
  catch (e) { if (active.current) setStatus(e instanceof AuthError && e.code === 'invalid_credentials' ? 'Kata sandi tidak cocok.' : 'Salinan belum bisa disiapkan. Coba lagi.'); }
  finally { working.current = false; if (active.current) setBusy(false); }
 }
 async function deliver() {
  if (working.current || !snapshot) return;
  working.current = true; setBusy(true);
  try { const outcome = await onDeliver(snapshot); if (active.current) setStatus(outcome === 'download-started' ? 'Unduhan dimulai.' : outcome === 'share-opened' ? 'Menu berbagi dibuka.' : 'Berbagi dibatalkan.'); }
  catch { if (active.current) setStatus('Salinan belum bisa dibagikan. Coba lagi.'); }
  finally { working.current = false; if (active.current) setBusy(false); }
 }
 return <View style={styles.card}>
  <Text accessibilityRole="header" style={styles.heading}>Salinan data akun</Text>
  <Text style={styles.text}>Data tamu dan jawaban belum tersinkron tidak ikut.</Text>
  {rememberChoice ? <Text style={styles.text}>Setelah verifikasi, masuk lagi saat aplikasi dibuka.</Text> : null}
  {snapshot ? <Btn testID="account-data-deliver" label={deliveryLabel} onPress={() => void deliver()} disabled={busy} /> : <>
   <Text style={styles.label}>Kata sandi</Text>
   <TextInput testID="account-data-password" accessibilityLabel="Kata sandi" secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} editable={!busy} style={styles.input} />
   <Btn testID="account-data-prepare" label="Siapkan salinan" onPress={() => void prepare()} disabled={busy} />
  </>}
  {status ? <Text testID="account-data-status" accessibilityLiveRegion="polite" style={styles.text}>{status}</Text> : null}
 </View>;
}
const styles = StyleSheet.create({
 card: { gap: 12, padding: 16, minWidth: 0, borderRadius: radius.card, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
 heading: { fontFamily: fonts.extrabold, color: colors.ink, fontSize: 21, lineHeight: 29, textAlign: 'left', writingDirection: 'ltr' },
 text: { fontFamily: fonts.regular, color: colors.text, fontSize: 14, lineHeight: 21, textAlign: 'left', writingDirection: 'ltr' },
 label: { fontFamily: fonts.bold, color: colors.ink, fontSize: 15, lineHeight: 22 },
 input: { minHeight: 48, minWidth: 0, borderWidth: 1, borderColor: colors.controlLine, borderRadius: radius.input, padding: 12, fontFamily: fonts.regular, color: colors.ink, fontSize: 16, lineHeight: 24, textAlign: 'left', writingDirection: 'ltr' },
});
