import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/ui/AppContext';
import { MigrationNotice } from '@/ui/notices';
import { formatDue, useLearning } from '@/ui/useLearning';
import { Btn, EmptyState, Eyebrow, H1, H2, Icon, Muted, Notice, P, Page, useIsDesktop } from '@/ui/components';
import { colors, radius } from '@/ui/theme';

// Unit names from Lessons_Unit_A_B_Draft.md Part 2 / Part 3. Unit B in this slice is its basic part only
// (who did it); the speech part is locked while the learned rule is pending.
const UNIT_TITLE = { A: 'Unit A — Siapa yang dijelaskan?', B: 'Unit B (dasar) — Siapa yang melakukan?' } as const;
const OUTLINE_ACCENTS = [colors.topicBar, colors.exampleBar, colors.clueBar];

export default function Home() {
  const { ready, error, rules, content, learner } = useApp();
  const desktop = useIsDesktop();
  const learning = useLearning();

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.indigo} accessibilityLabel="Memuat" />
      </View>
    );
  }

  if (error) {
    return (
      <Page>
        <H1>Penyimpanan tidak dapat dibuka</H1>
        <Notice tone="danger">{error}</Notice>
        <P>Data yang ada tidak ditimpa.</P>
      </Page>
    );
  }

  if (content.empty) {
    return (
      <Page>
        <EmptyState icon="hourglass-outline" title="Belum ada materi yang disetujui untuk uji coba">
          <P style={{ textAlign: 'center' }}>
            Materi pelajaran masih ditinjau oleh peninjau bahasa Arab dan bahasa Indonesia. Aplikasi hanya menampilkan
            materi yang sudah disetujui untuk uji coba. Silakan kembali lagi nanti.
          </P>
        </EmptyState>
      </Page>
    );
  }

  if (!learner) return <Redirect href="/consent" />;

  const unit = learning?.open[learning.open.length - 1] ?? 'A';
  const unitScreens = content.screens.filter((sc) => sc.unit === unit);
  const practiceCount = content.items.filter((i) => i.unit === unit && i.pool === 'PRACT').length;
  const snap = learning?.snapshot;
  const inProgress = snap?.kind === 'ok' && snap.state.phase !== 'done';
  const doneToday = snap?.kind === 'ok' && snap.state.phase === 'done' && snap.state.local_date === learning?.today;
  const oldFormat = snap?.kind === 'legacy' || snap?.kind === 'content-changed';
  const nextDue = learning?.progress.next_due;

  return (
    <Page width="wide">
      <MigrationNotice />
      <H1>Sesi hari ini</H1>

      <View style={styles.unit}>
        <LinearGradient
          colors={[colors.unitPanelA, colors.unitPanelB]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]}
          pointerEvents="none"
        />
        <Eyebrow tone="mint">{`Unit ${unit}`}</Eyebrow>
        <Text accessibilityRole="header" testID="unit-title" style={[styles.unitTitle, desktop && styles.unitTitleDesktop]}>
          {UNIT_TITLE[unit]}
        </Text>
        <P>{unitScreens[0]?.body[0]}</P>
        <Muted testID="unit-inventory">
          {unitScreens.length} panduan · {practiceCount} soal latihan · {learner.session_minutes} menit per sesi
        </Muted>
        {inProgress ? (
          <Muted testID="session-status">
            Sesi sebelumnya belum selesai: {snap.state.results.length} jawaban tersimpan. Anda bisa melanjutkannya.
          </Muted>
        ) : null}
        {doneToday ? <Muted testID="session-status">Sesi hari ini sudah selesai. Terima kasih.</Muted> : null}
        {oldFormat ? (
          <Muted testID="session-status">
            Sesi lama memakai format soal sebelumnya dan akan diarsipkan saat Anda mulai. Semua jawaban tetap tersimpan.
          </Muted>
        ) : null}
        {nextDue ? <Muted testID="next-due">Jadwal ulasan atau cek berikutnya: {formatDue(nextDue, learning!.today)}.</Muted> : null}
        {learning === undefined ? (
          <ActivityIndicator color={colors.indigo} />
        ) : (
          <View style={[styles.actions, !desktop && styles.actionsStack]}>
            <Btn testID="start-session" label={inProgress ? 'Lanjutkan sesi' : 'Mulai sesi'} onPress={() => router.push('/session')} />
            <Btn kind="secondary" label="Lihat panduan" icon="document-text-outline" onPress={() => router.push('/guide' as Href)} />
            {doneToday ? <Btn kind="secondary" label="Lihat ringkasan" onPress={() => router.push('/summary')} /> : null}
          </View>
        )}
      </View>

      <View style={{ gap: 4, marginTop: 6 }}>
        <H2>Daftar materi dalam unit ini</H2>
        <Muted>Ikuti panduan secara berurutan, lalu kerjakan latihannya.</Muted>
      </View>
      {unitScreens.map((s, n) => (
        <Pressable
          key={s.screen_id}
          testID={`outline-${s.screen_id}`}
          accessibilityRole="link"
          accessibilityLabel={`${n + 1}. ${s.title}`}
          onPress={() => router.push(`/guide?screen=${s.screen_id}` as unknown as Href)}
          style={({ pressed }) => [styles.outline, { borderLeftColor: OUTLINE_ACCENTS[n % 3] }, pressed && styles.outlinePressed]}
        >
          <View style={styles.num}>
            <Text style={styles.numText}>{n + 1}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.outlineTitle}>{s.title}</Text>
            <Text style={styles.outlineBody} numberOfLines={2}>
              {s.body[0]}
            </Text>
          </View>
          <Icon name="chevron-forward" color={colors.muted} />
        </Pressable>
      ))}

      <Notice tone="info">
        Cek Awal (bacaan dengan audio): {rules.audio_enabled ? 'aktif' : 'audio tidak tersedia (opsional, dinonaktifkan)'}.
      </Notice>
      {rules.mode === 'developer-demo' ? (
        <Btn kind="quiet" label="Data pengembang" icon="code-slash" testID="open-dev" onPress={() => router.push('/dev')} />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  unit: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D7E3DD',
    padding: 20,
    gap: 8,
    overflow: 'hidden',
  },
  unitTitle: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  unitTitleDesktop: { fontSize: 30, lineHeight: 38 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  actionsStack: { flexDirection: 'column', alignItems: 'stretch' },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 64,
  },
  outlinePressed: { backgroundColor: colors.paper },
  num: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.indigoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  outlineTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  outlineBody: { fontSize: 14, lineHeight: 20, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
});
