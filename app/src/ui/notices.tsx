import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp } from './AppContext';
import { Btn, Notice } from './components';

/** Honest one-time notices written by a migration (store meta `pending_notice`). */
export const NOTICE_TEXT: Record<string, string> = {
  'format-change': 'Soal kini punya empat pilihan; semua jawaban, pengaturan, dan laporan Anda tetap tersimpan.',
  'snapshot-unreadable': 'Sesi lama tidak bisa dibuka. Semua jawaban Anda tetap tersimpan.',
  'day-rollover': 'Latihan hari ini sudah siap. Jawaban sebelumnya tetap tersimpan.',
  'order-invalid': 'Sesi lama diarsipkan. Semua jawaban Anda tetap tersimpan.',
};

/** What happened to the session, shown on request («Rincian»). */
const NOTICE_DETAIL: Record<string, string> = {
  'format-change': 'Format soal diperbarui, jadi sesi lama diakhiri.',
  'snapshot-unreadable': 'Sesi itu diarsipkan tanpa diubah.',
  'day-rollover':
    'Sesi hari sebelumnya yang belum selesai disimpan, dan sesi baru disusun untuk hari ini. Latihan ulang yang belum selesai tetap dijadwalkan.',
  'order-invalid': 'Urutan pilihannya tidak cocok dengan soal saat ini, jadi sesi itu tidak dinilai ulang.',
};

export function MigrationNotice() {
  const { store } = useApp();
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    let alive = true;
    store?.getMeta('pending_notice').then((v) => alive && setNotice(v));
    return () => {
      alive = false;
    };
  }, [store]);
  if (!notice || !NOTICE_TEXT[notice]) return null;
  return (
    <View testID="migration-notice">
      <Notice
        tone="info"
        icon="refresh-circle"
        action={
          <View style={styles.actions}>
            <Btn
              kind="quiet"
              label={detail ? 'Tutup rincian' : 'Rincian'}
              testID="migration-notice-details"
              onPress={() => setDetail((d) => !d)}
            />
            <Btn
              kind="quiet"
              label="Mengerti"
              testID="migration-notice-dismiss"
              onPress={async () => {
                if (!store) return;
                await store.setMeta('pending_notice', null);
                setNotice(null);
              }}
            />
          </View>
        }
      >
        {detail ? `${NOTICE_TEXT[notice]}\n${NOTICE_DETAIL[notice]}` : NOTICE_TEXT[notice]}
      </Notice>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: 4 },
});
