import { router, useFocusEffect, type Href } from 'expo-router';
import { Fragment, useCallback, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useAccount } from '@/ui/AccountContext';
import { useApp } from '@/ui/AppContext';
import {
  ArabicText,
  Btn,
  Chip,
  DraftChip,
  EmptyState,
  Icon,
  IconButton,
  ModeNote,
  Notice,
  P,
  Page,
  ReadOnlyNotice,
  StorageRefused,
  Wordmark,
  type IconName,
} from '@/ui/components';
import { NEUTRAL_PREVIEW, UNIT_TITLE, unitLabel } from '@/ui/labels';
import { UNIT_STATE_LABEL, unitStates, type UnitState } from '@/ui/learningPath';
import { MigrationNotice } from '@/ui/notices';
import { colors, fonts, radius, shadow, typography } from '@/ui/theme';
import { formatDue, formatLongDate, isLearningError, useLearning, type LearningState } from '@/ui/useLearning';

export default function Home() {
  const { ready, error, content, learner } = useApp();
  const learning = useLearning();

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat" />
      </View>
    );
  }

  if (error) return <StorageRefused message={error} />;
  if (isLearningError(learning)) return <StorageRefused message={learning.error} />;

  if (content.empty) {
    return (
      <Page>
        <EmptyState icon="hourglass-outline" title="Belum ada materi yang disetujui untuk uji coba">
          <P style={{ textAlign: 'center' }}>
            Materi pelajaran masih ditinjau oleh peninjau bahasa Arab dan bahasa Indonesia. Aplikasi hanya menampilkan
            materi yang sudah disetujui untuk uji coba. Silakan kembali lagi nanti.
          </P>
        </EmptyState>
        <ModeNote />
      </Page>
    );
  }

  if (!learner) return <Welcome />;
  return <Today learning={learning} />;
}

/** Guest-first welcome (board 13). Nothing is saved until the profile and consent step. */
function Welcome() {
  const { rules, content } = useApp();
  const account = useAccount();
  return (
    <Page
      footer={
        <>
          <Btn testID="welcome-start" label="Mulai" icon="arrow-forward" onPress={() => router.push('/consent')} />
          {account.enabled ? (
            <Btn testID="welcome-account" kind="quiet" label="Sudah punya akun lokal? Masuk di sini" onPress={() => router.push('/account' as Href)} />
          ) : null}
          <Text style={styles.modeCaption}>{rules.mode === 'tester' ? 'Prototipe · mode penguji' : 'Prototipe pengembang'}</Text>
        </>
      }
    >
      <View style={styles.welcomeTop}>
        <Wordmark />
        {content.unreviewed ? <Chip tone="draft" label="Konten contoh · belum ditinjau" /> : null}
      </View>
      <View style={styles.figure}>
        <ArabicText size={52} weight="medium" testID="welcome-preview">
          {NEUTRAL_PREVIEW}
        </ArabicText>
        <Text style={styles.figureCaption}>Huruf Arab berharakat</Text>
      </View>
      <View style={styles.welcomeText}>
        <Text accessibilityRole="header" style={styles.welcomeTitle}>
          Pahami kalimat Arab pendek, langkah demi langkah.
        </Text>
        <Text style={typography.body}>Penjelasan dalam bahasa Indonesia. Satu sesi singkat setiap hari.</Text>
      </View>
    </Page>
  );
}

function StatusLine({ icon, tone = 'plain', testID, children }: { icon: IconName; tone?: 'plain' | 'accent' | 'good'; testID?: string; children: string }) {
  const ink = tone === 'good' ? colors.goodInk : colors.text;
  return (
    <View style={styles.status}>
      <Icon name={icon} size={18} color={tone === 'accent' ? colors.accent : tone === 'good' ? colors.goodInk : colors.muted} />
      <Text testID={testID} style={[styles.statusText, { color: ink }, tone === 'good' && styles.statusStrong]}>
        {children}
      </Text>
    </View>
  );
}

const DOT: Record<UnitState, ViewStyle> = {
  due: { backgroundColor: colors.accent, borderColor: colors.missBg, borderWidth: 4 },
  practising: { backgroundColor: colors.accent, borderColor: colors.accentSoft, borderWidth: 4 },
  available: { backgroundColor: colors.sheet, borderColor: colors.accent, borderWidth: 3 },
  closed: { backgroundColor: colors.sheet, borderColor: '#A89A84', borderWidth: 2 },
};

/**
 * Home (board 01): one hero card with the unit, today's state and ONE primary action, then the
 * learning path. Every date and count comes from the saved projection; there are no lesson previews
 * here (they live in Panduan, where each view is dated).
 */
function Today({ learning }: { learning: LearningState }) {
  const { readOnly, content, learner, flash, setFlash, dataset } = useApp();
  // The note left by closing a session is for this visit to Home only.
  useFocusEffect(useCallback(() => () => setFlash(null), [setFlash]));
  if (!learner) return null;

  const data = learning && !isLearningError(learning) ? learning : null;
  const unit = data?.open[data.open.length - 1] ?? 'A';
  const snap = data?.snapshot;
  const inProgress = snap?.kind === 'ok' && snap.state.phase !== 'done';
  const doneToday = snap?.kind === 'ok' && snap.state.phase === 'done' && snap.state.local_date === data?.today;
  const oldFormat = snap?.kind === 'legacy' || snap?.kind === 'content-changed';
  const nextDue = data?.progress.next_due ?? null;
  const minutes = learner.session_minutes;

  let status: ReactNode;
  if (inProgress) {
    status = <StatusLine icon="bookmark-outline" testID="session-status">{`Sesi belum selesai · ${snap.state.results.length} jawaban tersimpan`}</StatusLine>;
  } else if (doneToday) {
    status = (
      <View style={styles.statusGroup}>
        <StatusLine icon="checkmark-circle-outline" tone="good" testID="session-status">
          Sesi hari ini selesai
        </StatusLine>
        {data && nextDue ? (
          <Text testID="next-due" style={styles.statusSub}>{`Ulasan/cek berikutnya: ${formatDue(nextDue, data.today)}.`}</Text>
        ) : null}
      </View>
    );
  } else if (data && nextDue && nextDue <= data.today) {
    status = (
      <StatusLine icon="calendar-outline" tone="accent" testID="next-due">
        {`Ada ulasan hari ini · sesi ± ${minutes} menit`}
      </StatusLine>
    );
  } else {
    status = <StatusLine icon="time-outline">{`Sesi ± ${minutes} menit`}</StatusLine>;
  }

  const action =
    learning === undefined ? (
      <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat" />
    ) : doneToday ? (
      <Btn testID="home-summary" label="Lihat ringkasan" onPress={() => router.push('/summary')} />
    ) : (
      <Btn
        testID="start-session"
        label={inProgress ? 'Lanjutkan sesi' : 'Mulai sesi'}
        icon="arrow-forward"
        disabled={!!readOnly}
        onPress={() => {
          setFlash(null);
          router.push('/session');
        }}
      />
    );

  const states = data ? unitStates(data, content) : [];

  return (
    <Page>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.headerActions}>
          <DraftChip />
          <IconButton icon="options-outline" label="Pengaturan" testID="home-settings" onPress={() => router.push('/settings')} />
        </View>
      </View>
      <MigrationNotice />
      {readOnly ? <ReadOnlyNotice reason={readOnly} /> : null}
      {flash ? (
        <View accessibilityLiveRegion="polite" role="status">
          <Notice tone="info" icon="bookmark-outline" testID="home-flash">
            {flash}
          </Notice>
        </View>
      ) : null}
      {oldFormat ? (
        <Notice tone="info" testID="session-status">
          Sesi lama memakai format soal sebelumnya dan akan diarsipkan saat Anda mulai. Semua jawaban tetap tersimpan.
        </Notice>
      ) : null}

      <View style={styles.hero} testID="home-hero">
        <View style={styles.heroTop}>
          <Text style={typography.eyebrow}>{unitLabel(unit)}</Text>
          {data ? <Text style={styles.date}>{formatLongDate(data.today)}</Text> : null}
        </View>
        <Text accessibilityRole="header" accessibilityLabel={`Unit ${unit}: ${UNIT_TITLE[unit]}`} testID="unit-title" style={styles.unitTitle}>
          {UNIT_TITLE[unit]}
        </Text>
        {status}
        <View style={styles.action}>{action}</View>
      </View>

      {states.length ? (
        <View style={styles.pathSection}>
          <Text accessibilityRole="header" style={styles.pathTitle}>
            Jalur belajar
          </Text>
          <Pressable
            testID="home-path"
            accessibilityRole="link"
            accessibilityLabel={`Jalur belajar: ${states.map((s) => `Unit ${s.unit} ${UNIT_STATE_LABEL[s.state].toLowerCase()}`).join(', ')}. Buka Kemajuan.`}
            onPress={() => router.dismissTo('/progress' as Href)}
            style={({ pressed }) => [styles.path, pressed && styles.pathPressed]}
          >
            <View style={styles.pathUnits}>
              {states.map((s, n) => (
                <Fragment key={s.unit}>
                  {n > 0 ? <View style={[styles.connector, s.state === 'closed' && styles.connectorOff]} /> : null}
                  <View style={styles.pathUnit}>
                    <View style={[styles.dot, DOT[s.state]]} />
                    <Text style={styles.pathUnitLabel}>{`Unit ${s.unit}`}</Text>
                    <Text style={[styles.pathState, s.state === 'closed' && styles.pathStateOff]}>{UNIT_STATE_LABEL[s.state]}</Text>
                  </View>
                </Fragment>
              ))}
            </View>
            <Icon name="chevron-forward" color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.storage}>
        <Icon name="phone-portrait-outline" size={16} color={colors.muted} />
        <Text style={styles.storageText}>
          {dataset === 'account' ? 'Tersimpan di perangkat ini · akun lokal, dikirim saat Anda menyinkronkan' : 'Tersimpan di perangkat ini · tanpa akun'}
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },

  welcomeTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 },
  figure: {
    alignItems: 'center',
    gap: 2,
    paddingTop: 22,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderRadius: radius.xl,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 8,
    ...shadow,
  },
  figureCaption: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink, textAlign: 'center' },
  welcomeText: { gap: 10, marginTop: 6 },
  welcomeTitle: { ...typography.display, fontSize: 32, lineHeight: 38 },
  modeCaption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted, textAlign: 'center', marginTop: 2 },

  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 52 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  hero: {
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 22,
    gap: 14,
    ...shadow,
  },
  heroTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  date: { ...typography.caption },
  unitTitle: { ...typography.display },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  statusText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, writingDirection: 'ltr', textAlign: 'left' },
  statusStrong: { fontFamily: fonts.semibold },
  statusGroup: { gap: 4 },
  statusSub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted, marginLeft: 26, writingDirection: 'ltr', textAlign: 'left' },
  action: { marginTop: 6 },

  pathSection: { gap: 10, marginTop: 4 },
  pathTitle: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5, color: colors.muted, marginHorizontal: 4 },
  path: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 72,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 10,
    borderRadius: radius.card,
    backgroundColor: colors.sheet2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pathPressed: { backgroundColor: colors.chipBg },
  pathUnits: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  connector: { flex: 1, height: 2, marginTop: 7, borderRadius: 2, backgroundColor: colors.lineStrong },
  connectorOff: { backgroundColor: colors.line },
  pathUnit: { alignItems: 'flex-start', gap: 6, flexShrink: 1 },
  dot: { width: 16, height: 16, borderRadius: radius.pill },
  pathUnitLabel: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 16, color: colors.ink },
  pathState: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.accentInk },
  pathStateOff: { fontFamily: fonts.regular, color: colors.muted },

  storage: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginHorizontal: 4 },
  storageText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
});
