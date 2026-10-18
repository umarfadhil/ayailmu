import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useApp } from './AppContext';
import { Btn, Notice } from './components';

/** Honest one-time notices written by a migration (store meta `pending_notice`). */
export const NOTICE_TEXT: Record<string, string> = {
  'format-change':
    'Format soal diperbarui: setiap soal kini memiliki empat pilihan jawaban. Sesi lama diakhiri, tetapi semua jawaban, pengaturan, dan laporan Anda tetap tersimpan.',
  'snapshot-unreadable':
    'Sesi tersimpan tidak dapat dibaca, jadi sesi itu diarsipkan tanpa diubah. Semua jawaban Anda tetap tersimpan.',
  'day-rollover':
    'Sesi dari hari sebelumnya belum selesai, jadi sesi itu disimpan dan sesi baru disusun untuk hari ini. Latihan ulang yang belum selesai tetap dijadwalkan; semua jawaban Anda tetap tersimpan.',
  'order-invalid':
    'Urutan pilihan pada sesi tersimpan tidak cocok dengan soal saat ini, jadi sesi itu diarsipkan dan tidak dinilai ulang. Semua jawaban Anda tetap tersimpan.',
};

export function MigrationNotice() {
  const { store } = useApp();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    store?.getMeta('pending_notice').then((v) => alive && setNotice(v));
    return () => {
      alive = false;
    };
  }, [store]);
  if (!notice || !NOTICE_TEXT[notice]) return null;
  return (
    <View style={{ gap: 6 }} testID="migration-notice">
      <Notice tone="info" icon="refresh-circle">
        {NOTICE_TEXT[notice]}
      </Notice>
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
  );
}
