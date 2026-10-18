import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/ui/AppContext';
import { BackLink } from '@/ui/BackLink';
import { ArabicText, H1, Muted, Page, Segmented } from '@/ui/components';
import { colors, radius } from '@/ui/theme';
import { HydrationGate } from '@/ui/Hydration';

const SCALES = [
  { label: 'Kecil', value: 0.85 },
  { label: 'Sedang', value: 1 },
  { label: 'Besar', value: 1.3 },
];

/** S18-style setting rows. Values persist on the local learner record. */
function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SettingsRoute() {
  const { learner, rules, content, updateLearner } = useApp();
  if (!learner) return <Redirect href="/" />;

  return (
    <Page>
      <BackLink />
      <H1>Pengaturan</H1>

      <Row title="Lama sesi harian">
        <Segmented
          testIDPrefix="settings-minutes-"
          value={learner.session_minutes}
          onChange={(m) => updateLearner({ session_minutes: m })}
          options={rules.session_minutes_options.map((m) => ({ value: m, label: `${m} mnt` }))}
        />
      </Row>

      <Row title="Ukuran huruf Arab">
        <Segmented
          testIDPrefix="settings-scale-"
          value={learner.arabic_scale}
          onChange={(v) => updateLearner({ arabic_scale: v })}
          options={SCALES.map((s) => ({ value: s.value, label: s.label }))}
        />
        {/* Sample sentence only when content may be shown (never in empty tester mode). */}
        {content.empty ? null : <ArabicText scale={learner.arabic_scale}>هِيَ صَابِرَةٌ</ArabicText>}
      </Row>

      <Row title="ID peserta">
        <Muted>Sebutkan ID ini jika meminta data Anda dihapus.</Muted>
        <Text selectable testID="learner-id" style={styles.id}>
          {learner.learner_id}
        </Text>
        <Muted>Alamat kontak untuk permintaan penghapusan: belum ditetapkan (prototipe; data hanya ada di perangkat ini).</Muted>
      </Row>

      <Row title="Lainnya">
        <Muted>
          Persetujuan: versi {learner.consent_version}, {new Date(learner.consent_at).toLocaleString('id-ID')}
        </Muted>
        <Muted>Pengingat harian: belum tersedia di prototipe ini.</Muted>
      </Row>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  id: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.inkSoft,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
});

export default function Settings() {
  return (
    <HydrationGate write>
      <SettingsRoute />
    </HydrationGate>
  );
}
