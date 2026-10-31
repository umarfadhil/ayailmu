import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { AccountDeletionModel } from '@/ui/AccountContext';
import { Btn } from '@/ui/components';
import { colors, fonts, radius } from '@/ui/theme';
type Props = { model: AccountDeletionModel; rememberChoice?: boolean };
export function AccountDeletionPanel(props: Props) { return <DeletionForm key={props.model.key} {...props} />; }
function DeletionForm({ model, rememberChoice }: Props) {
 const [form, setForm] = useState<'initial' | 'retry' | null>(null);
 const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
 const [details, setDetails] = useState(false);
 const [message, setMessage] = useState(''); const [localBusy, setLocalBusy] = useState(false);
 const active = useRef(false); const working = useRef(false);
 useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
 const { state } = model; const busy = state.busy || localBusy; const disabled = busy || !model.available;
 function cancel() { setPassword(''); setConfirmation(''); setForm(null); }
 async function run(job: () => Promise<void>) {
  if (working.current || state.busy || !model.available) return;
  working.current = true; setLocalBusy(true); setMessage('');
  try { await job(); } catch { if (active.current) setMessage('Permintaan belum bisa diselesaikan. Periksa status sebelum mencoba lagi.'); }
  finally { working.current = false; if (active.current) setLocalBusy(false); }
 }
 function submit() {
  if (disabled || confirmation !== 'HAPUS' || !password || !form) return;
  const entered = password; const method = form; cancel();
  void run(() => method === 'initial' ? model.remove(entered,true) : model.retryIdentity(entered,true));
 }
 const initial = state.phase === 'idle' || state.phase === 'failed';
 const status = state.phase === 'unknown' ? 'Hasil permintaan belum diketahui. Periksa status sebelum mencoba lagi.' : state.phase === 'pending' ? 'Data server sudah dihapus. Penghapusan akun masuk masih tertunda.' : state.phase === 'completed' ? 'Akun sudah dihapus.' : state.phase === 'failed' ? 'Penghapusan belum dimulai atau tidak berhasil. Data di perangkat ini tetap ada.' : '';
 return <View style={styles.card}>
  <Text accessibilityRole="header" style={styles.heading}>Hapus akun</Text>
  {initial ? <Text style={styles.text}>Data akun di server dan salinan akun di perangkat ini akan dihapus. Data tamu tetap ada. Tindakan ini tidak dapat dibatalkan.</Text> : null}
  {status ? <Text testID="deletion-status" accessibilityLiveRegion="polite" style={styles.text}>{status}</Text> : null}
  {state.local === 'erased' ? <Text style={styles.text}>Salinan akun di perangkat ini sudah dihapus. Data tamu tetap ada.</Text> : state.local === 'failed' ? <Text style={styles.text}>Salinan akun di perangkat ini belum berhasil dihapus.</Text> : !initial ? <Text style={styles.text}>Salinan akun di perangkat ini belum dihapus.</Text> : null}
  {state.proof ? <>
   <Text style={styles.text}>Layanan menyimpan catatan penghapusan. Salinan di perangkat lain perlu dihapus di sana.</Text>
   <Btn testID="deletion-retention" label={details ? 'Tutup rincian data yang disimpan' : 'Rincian data yang disimpan'} kind="quiet" onPress={() => setDetails(value => !value)} />
   {details ? state.proof.not_deleted.map((entry, index) => <Text key={`${entry.what}-${index}`} style={styles.text}>{entry.what === 'deletion_record' ? 'Catatan penghapusan' : entry.what === 'device_data' ? 'Salinan perangkat' : `Data lain (${entry.what})`}: {entry.why}</Text>) : null}
  </> : null}
  {!model.available ? <Text style={styles.text}>Gagal masuk bukan bukti akun sudah dihapus.</Text> : null}
  {state.issue === 'credentials' ? <Text style={styles.text}>Kata sandi tidak cocok.</Text> : state.issue ? <Text style={styles.text}>Status terbaru belum bisa dipastikan. Coba periksa lagi.</Text> : null}
  {form ? <>
   <Text style={styles.text}>{form === 'retry' ? 'Coba lagi penghapusan akun masuk. Data server sudah dihapus.' : 'Konfirmasi penghapusan akun ini.'}</Text>
   {rememberChoice ? <Text style={styles.text}>Setelah verifikasi, masuk lagi saat aplikasi dibuka.</Text> : null}
   <Text style={styles.label}>Kata sandi</Text>
   <TextInput testID="deletion-password" accessibilityLabel="Kata sandi untuk penghapusan" secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} editable={!disabled} style={styles.input} />
   <Text style={styles.label}>Ketik HAPUS untuk mengonfirmasi</Text>
   <TextInput testID="deletion-confirm" accessibilityLabel="Ketik HAPUS untuk mengonfirmasi" autoCapitalize="characters" autoCorrect={false} value={confirmation} onChangeText={setConfirmation} editable={!disabled} style={styles.input} />
   <Btn testID="deletion-submit" label={form === 'retry' ? 'Verifikasi dan coba lagi' : 'Verifikasi dan hapus akun'} disabled={disabled || confirmation !== 'HAPUS' || !password} onPress={submit} />
   <Btn testID="deletion-cancel" label="Batalkan" kind="secondary" onPress={cancel} disabled={busy} />
  </> : <>
   {initial ? <Btn testID="deletion-start" label="Mulai penghapusan" kind="secondary" disabled={disabled} onPress={() => setForm('initial')} /> : null}
   {!initial ? <Btn testID="deletion-check" label="Periksa status" kind="secondary" disabled={disabled} onPress={() => void run(model.check)} /> : null}
   {state.phase === 'pending' ? <Btn testID="deletion-retry" label="Coba hapus akun masuk" kind="secondary" disabled={disabled} onPress={() => setForm('retry')} /> : null}
   {state.local === 'failed' ? <Btn testID="deletion-cleanup" label="Hapus salinan perangkat ini" kind="secondary" disabled={disabled} onPress={() => void run(model.retryCleanup)} /> : null}
  </>}
  {busy ? <Text accessibilityLiveRegion="polite" style={styles.text}>Memproses permintaan…</Text> : null}
  {message ? <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text> : null}
 </View>;
}
const styles = StyleSheet.create({
 card: { gap: 12, padding: 16, minWidth: 0, borderRadius: radius.card, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
 heading: { fontFamily: fonts.extrabold, color: colors.ink, fontSize: 21, lineHeight: 29, textAlign: 'left', writingDirection: 'ltr' },
 text: { fontFamily: fonts.regular, color: colors.text, fontSize: 14, lineHeight: 21, textAlign: 'left', writingDirection: 'ltr' },
 label: { fontFamily: fonts.bold, color: colors.ink, fontSize: 15, lineHeight: 22 },
 input: { minHeight: 48, minWidth: 0, borderWidth: 1, borderColor: colors.controlLine, borderRadius: radius.input, padding: 12, fontFamily: fonts.regular, color: colors.ink, fontSize: 16, lineHeight: 24, textAlign: 'left', writingDirection: 'ltr' },
});
