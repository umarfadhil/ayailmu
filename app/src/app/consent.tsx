import { Redirect, router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isReleasePresentation } from '@/config/releasePresentation';
import { starterBeta } from '@/pilot/unitA/StarterHome';
import { useApp } from '@/ui/AppContext';
import { ArabicText, Btn, Icon, IconButton, Notice, Page, Segmented, type IconName } from '@/ui/components';
import { ARABIC_SCALES, NEUTRAL_PREVIEW } from '@/ui/labels';
import { colors, fonts, radius } from '@/ui/theme';
import { HydrationGate } from '@/ui/Hydration';

function Check({ value, onChange, label, testID }: { value: boolean; onChange: (v: boolean) => void; label: string; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      onPress={() => onChange(!value)}
      style={styles.check}
    >
      <View style={[styles.box, value && styles.boxOn]}>{value ? <Icon name="checkmark" size={18} color={colors.white} /> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function Fact({ icon, children, warn }: { icon: IconName; children: string; warn?: boolean }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={18} color={warn ? colors.draftInk : colors.muted} />
      <Text style={[styles.factText, warn && styles.factWarn]}>{children}</Text>
    </View>
  );
}

/**
 * Basic local profile and demo consent (board 14, spec §11). No learner ID or data is created until
 * both statements are ticked; then the profile is saved on this device only.
 */
function ConsentRoute() {
  const { learner, content, rules, dataset, giveConsent, createLearner } = useApp();
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [minutes, setMinutes] = useState(rules.default_session_minutes);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set while this screen creates the learner: it then leaves by itself (back to the existing Home).
  const [creating, setCreating] = useState(false);

  // A learner who already exists on arrival goes Home.
  if (learner && !creating) return <Redirect href="/" />;
  // Empty legacy content goes Home, unless a validated private beta's starter is reviewed: it is studied from here.
  // A beta whose starter is still pending goes Home whatever the legacy content says.
  const beta = starterBeta(rules.mode);
  if (beta === 'pending' || (content.empty && beta !== 'reviewed')) return <Redirect href="/" />;
  // An account dataset gets its learner through the account's own profile and consent, never this guest form.
  if (beta === 'reviewed' && dataset === 'account' && !learner) return <Redirect href={'/account' as Href} />;
  const ready = adult && agree;
  // Only the heading changes in a genuine release presentation or private beta; the statements, facts and checks stay as they are.
  const consentTitle = isReleasePresentation(rules.mode) || beta !== 'off' ? 'Persetujuan' : 'Persetujuan (versi demo)';

  const start = async () => {
    setBusy(true);
    setError(null);
    setCreating(true);
    try {
      const receipt = giveConsent({ adult, agreed: agree });
      await createLearner(minutes, { arabicScale: scale, receipt });
      router.dismissTo('/');
    } catch {
      setCreating(false);
      setError('Belum tersimpan. Periksa penyimpanan perangkat lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      footer={
        <>
          <Btn testID="consent-continue" label="Mulai belajar" icon="arrow-forward" disabled={!ready || busy} onPress={start} />
          {ready ? null : <Text style={styles.hint}>Centang kedua pernyataan untuk mulai.</Text>}
        </>
      }
    >
      <View style={styles.back}>
        <IconButton icon="arrow-back" label="Kembali" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        Atur belajar Anda
      </Text>

      <View style={styles.row}>
        <Text style={styles.rowTitle}>Bahasa penjelasan</Text>
        <Text style={styles.rowValue}>Bahasa Indonesia</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Lama sesi harian
        </Text>
        <Segmented
          testIDPrefix="minutes-"
          accessibilityLabel="Lama sesi harian"
          value={minutes}
          onChange={setMinutes}
          options={rules.session_minutes_options.map((m) => ({ value: m, label: `${m} menit` }))}
        />
        <Text style={styles.hintLeft}>Anda bisa mengubahnya nanti di Pengaturan.</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Ukuran huruf Arab
        </Text>
        <Segmented testIDPrefix="scale-" accessibilityLabel="Ukuran huruf Arab" value={scale} onChange={setScale} options={ARABIC_SCALES} />
        <View style={styles.preview}>
          <ArabicText scale={scale} size={34}>
            {NEUTRAL_PREVIEW}
          </ArabicText>
        </View>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {consentTitle}
        </Text>
        <View style={styles.consent}>
          <Fact icon="file-tray-outline">Disimpan: jawaban, waktu menjawab, dan ID acak. Tanpa nama, kontak, lokasi, atau foto.</Fact>
          <Fact icon="phone-portrait-outline">Hanya di perangkat ini; tidak dikirim ke mana pun.</Fact>
          <Fact icon="checkmark-circle-outline">Tujuannya memperbaiki pelajaran. Anda boleh berhenti kapan saja.</Fact>
          <Fact icon="alert-circle-outline" warn>
            Menghapus data dari aplikasi belum tersedia.
          </Fact>
          <View style={styles.divider} />
          <Check testID="consent-adult" value={adult} onChange={setAdult} label="Saya berusia 18 tahun atau lebih." />
          <Check testID="consent-agree" value={agree} onChange={setAgree} label="Saya setuju jawaban saya disimpan seperti dijelaskan di atas." />
        </View>
      </View>
      {error ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  back: { marginLeft: -10, alignSelf: 'flex-start' },
  title: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.7, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink },
  rowValue: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  section: { gap: 8 },
  sectionTitle: { fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  hintLeft: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  preview: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
  },
  consent: { gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  factText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
  factWarn: { color: colors.draftInk, fontFamily: fonts.semibold },
  divider: { height: 1, backgroundColor: colors.lineSoft },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 48, paddingVertical: 4 },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.controlLine,
    backgroundColor: colors.sheet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
});

export default function Consent() {
  return (
    <HydrationGate write>
      <ConsentRoute />
    </HydrationGate>
  );
}
