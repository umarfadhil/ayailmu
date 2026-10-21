import { Redirect, router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccount } from '@/ui/AccountContext';
import { useApp } from '@/ui/AppContext';
import { BackLink } from '@/ui/BackLink';
import { ArabicText, Chip, Icon, ModeNote, Muted, Page, SectionLabel, Segmented } from '@/ui/components';
import { ARABIC_SCALES, NEUTRAL_PREVIEW } from '@/ui/labels';
import { colors, fonts, radius } from '@/ui/theme';
import { HydrationGate } from '@/ui/Hydration';

/** A setting card: its title, then the control. */
function Setting({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.setting}>
      <Text accessibilityRole="header" style={styles.settingTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A row in a list card. `unavailable`: a plain statement that the feature does not exist yet, never a control. */
function Row({ title, unavailable, first, children }: { title: string; unavailable?: boolean; first?: boolean; children?: ReactNode }) {
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{title}</Text>
        {unavailable ? <Chip label="Belum tersedia" /> : null}
      </View>
      {children}
    </View>
  );
}

/** Copies the participant ID where the browser offers a clipboard; elsewhere the ID text itself is selectable. */
function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState<string | null>(null);
  const clipboard = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard) return null;
  return (
    <View style={styles.copy}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Salin ID peserta"
        onPress={() =>
          clipboard.writeText(id).then(
            () => setDone('ID disalin.'),
            () => setDone('Tidak bisa menyalin. Pilih teks ID lalu salin.')
          )
        }
        style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
      >
        <Icon name="copy-outline" size={16} color={colors.ink} />
        <Text style={styles.copyText}>Salin</Text>
      </Pressable>
      {done ? (
        <Text accessibilityLiveRegion="polite" style={styles.copyDone}>
          {done}
        </Text>
      ) : null}
    </View>
  );
}

/** Board 15: the guest's local profile and truthful data facts. Values persist on the local learner record. */
function SettingsRoute() {
  const { learner, rules, content, updateLearner } = useApp();
  const account = useAccount();
  if (!learner) return <Redirect href="/" />;
  const accountLabel = account.signedIn ? 'Kelola akun' : 'Masuk ke akun';

  return (
    <Page>
      <BackLink />
      <Text accessibilityRole="header" style={styles.title}>
        Pengaturan
      </Text>

      <SectionLabel>Belajar</SectionLabel>
      <Setting title="Lama sesi harian">
        <Segmented
          testIDPrefix="settings-minutes-"
          accessibilityLabel="Lama sesi harian"
          value={learner.session_minutes}
          onChange={(m) => updateLearner({ session_minutes: m })}
          options={rules.session_minutes_options.map((m) => ({ value: m, label: `${m} menit` }))}
        />
      </Setting>
      <Setting title="Ukuran huruf Arab">
        <Segmented
          testIDPrefix="settings-scale-"
          accessibilityLabel="Ukuran huruf Arab"
          value={learner.arabic_scale}
          onChange={(v) => updateLearner({ arabic_scale: v })}
          options={ARABIC_SCALES}
        />
        {/* Neutral letters only (never a course word or check material); none in empty tester mode. */}
        {content.empty ? null : (
          <ArabicText scale={learner.arabic_scale} size={34}>
            {NEUTRAL_PREVIEW}
          </ArabicText>
        )}
      </Setting>

      <SectionLabel>Data dan privasi</SectionLabel>
      <View style={styles.local}>
        <View style={styles.localIcon}>
          <Icon name="phone-portrait-outline" size={20} color={colors.goodInk} />
        </View>
        <View style={styles.localBody}>
          <Text style={styles.localTitle}>Tersimpan di perangkat ini</Text>
          <Text style={styles.localText}>
            {account.connected
              ? 'Akun lokal: jawaban dan pengaturan dikirim ke layanan akun lokal (uji coba) hanya saat Anda menekan «Sinkronkan sekarang».'
              : 'Tanpa akun. Data tidak dikirim ke mana pun.'}
          </Text>
        </View>
      </View>
      <View style={styles.list}>
        <Row title="ID peserta" first>
          <CopyId id={learner.learner_id} />
          <Text selectable testID="learner-id" style={styles.id}>
            {learner.learner_id}
          </Text>
          <Muted>Sebutkan ID ini bila menghubungi tim kursus.</Muted>
        </Row>
        <Row title="Unduh data saya" unavailable />
        <Row title="Hapus data" unavailable>
          <Muted>Belum bisa dari aplikasi. Alamat kontak untuk permintaan penghapusan belum ditetapkan.</Muted>
        </Row>
        <Row title="Persetujuan">
          <Muted>{`Versi ${learner.consent_version} · ${new Date(learner.consent_at).toLocaleDateString('id-ID')}`}</Muted>
        </Row>
      </View>

      <SectionLabel>Akun lokal</SectionLabel>
      <View style={styles.list}>
        {account.enabled ? (
          <Pressable
            testID="account-open"
            accessibilityRole="link"
            accessibilityLabel={accountLabel}
            onPress={() => router.push('/account' as Href)}
            style={({ pressed }) => [styles.row, styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkBody}>
              <Text style={styles.rowTitle}>{accountLabel}</Text>
              <Muted>
                {account.connected
                  ? 'Jawaban disimpan di perangkat ini dan dikirim ke layanan akun lokal saat Anda menekan «Sinkronkan sekarang».'
                  : 'Akun uji coba lokal, khusus pengembangan. Tanpa akun, data tetap di perangkat ini.'}
              </Muted>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : (
          <Row title="Akun lokal" unavailable first />
        )}
      </View>

      <SectionLabel>Lainnya</SectionLabel>
      <View style={styles.list}>
        <Row title="Pengingat harian" unavailable first />
        {rules.mode === 'developer-demo' ? (
          <Pressable
            testID="open-dev"
            accessibilityRole="link"
            onPress={() => router.push('/dev')}
            style={({ pressed }) => [styles.row, styles.rowDivider, styles.linkRow, pressed && styles.pressed]}
          >
            <Text style={styles.rowTitle}>Data pengembang</Text>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <ModeNote />
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.7, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  setting: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  settingTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  local: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.goodBg,
    borderWidth: 1,
    borderColor: colors.goodLine,
  },
  localIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.sheet, alignItems: 'center', justifyContent: 'center' },
  localBody: { flex: 1 },
  localTitle: { fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 22, color: colors.goodInk },
  localText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#263A31' },
  list: { paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  row: { gap: 6, paddingVertical: 14, minHeight: 56, justifyContent: 'center' },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkBody: { flex: 1, gap: 4 },
  pressed: { backgroundColor: colors.sheet2 },
  id: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 19,
    color: '#203253',
    backgroundColor: colors.sheet2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xs,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  copy: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.sheet,
  },
  copyText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  copyDone: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
});

export default function Settings() {
  return (
    <HydrationGate write>
      <SettingsRoute />
    </HydrationGate>
  );
}
