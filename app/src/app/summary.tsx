import { Redirect, router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { learningBetaEnabled } from '@/config/learningBeta';
import { summarize } from '@/engine/session';
import { useApp } from '@/ui/AppContext';
import { Btn, EmptyState, Eyebrow, H1, Icon, Notice, P, Page, StorageRefused } from '@/ui/components';
import { SKILL_LABEL } from '@/ui/labels';
import { colors, fonts, radius } from '@/ui/theme';
import { formatDue, isLearningError, useLearning } from '@/ui/useLearning';
import { HydrationGate } from '@/ui/Hydration';

function Stat({ value, label, testID }: { value: number; label: string; testID: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Board 07: what was practised and when it comes back, with small neutral counts for the saved session.
 * Reachable at any time, so an unfinished session is labelled as such (never «Sesi selesai») and offers to
 * resume. The next date comes from the actual review/check projection, never a fixed "tomorrow". No
 * streaks, percentages or mastery claims; practised skills are named only from this session's items.
 */
function SummaryRoute() {
  const { content } = useApp();
  const learning = useLearning();

  if (content.empty) return <Redirect href="/" />;
  if (learning === undefined) return null;
  if (isLearningError(learning)) return <StorageRefused message={learning.error} />;
  if (learning === null) return <Redirect href="/" />;
  const nextDue = learning.progress.next_due;

  const snap = learning.snapshot;
  if (snap.kind !== 'ok') {
    return (
      <Page footer={<Btn testID="summary-start" label="Mulai sesi" icon="arrow-forward" onPress={() => router.push('/session')} />}>
        <H1>Ringkasan</H1>
        <EmptyState icon="stats-chart-outline" title="Belum ada sesi">
          <P style={{ textAlign: 'center' }}>Ringkasan muncul setelah Anda memulai sesi dengan format soal saat ini.</P>
        </EmptyState>
        <P testID="summary-next">
          {nextDue ? `Ulasan/cek berikutnya: ${formatDue(nextDue, learning.today)}.` : 'Belum ada ulasan atau cek yang terjadwal.'}
        </P>
      </Page>
    );
  }

  const done = snap.state.phase === 'done';
  const all = summarize(snap.state, learning.now);
  // F03: a scheduled-check outcome stays hidden until every item of its check (unit × D7/D30) is answered,
  // also after this session ends (a check split by the time budget continues in a later session).
  const lineFor = (itemId: string) => {
    const it = content.items.find((i) => i.item_id === itemId);
    const u = learning.progress.units.find((x) => x.unit === it?.unit);
    return it?.pool === 'D7' ? u?.retention_d7 : it?.pool === 'D30' ? u?.retention_d30 : undefined;
  };
  const hiddenChecks = snap.state.results.filter((r) => r.role === 'check' && (lineFor(r.item_id)?.correct ?? null) === null).length;
  const sum = {
    ...summarize({ ...snap.state, results: snap.state.results.filter((r) => r.role !== 'check' || (lineFor(r.item_id)?.correct ?? null) !== null) }, learning.now),
    checks: all.checks,
    checks_not_counted: all.checks_not_counted,
  };
  // Skills named only from the items answered in this saved session (catalog labels; no inference).
  const practised = [
    ...new Set(snap.state.results.flatMap((r) => content.items.find((i) => i.item_id === r.item_id)?.skills ?? [])),
  ].filter((s) => SKILL_LABEL[s]);
  const duration =
    sum.minutes === null
      ? 'Waktu tidak tercatat · tersimpan di perangkat ini'
      : sum.minutes < 1
        ? 'Kurang dari 1 menit · tersimpan di perangkat ini'
        : `Sekitar ${sum.minutes} menit · tersimpan di perangkat ini`;

  const actions = done ? (
    <>
      <Btn testID="summary-home" label="Selesai" onPress={() => router.dismissTo('/')} />
      <Btn kind="quiet" testID="summary-progress" label="Lihat kemajuan" onPress={() => router.dismissTo('/progress' as Href)} />
    </>
  ) : (
    <>
      <Btn testID="summary-resume" label="Lanjutkan sesi" icon="arrow-forward" onPress={() => router.dismissTo('/session')} />
      <Btn kind="quiet" label="Kembali ke beranda" onPress={() => router.dismissTo('/')} />
    </>
  );

  return (
    <Page footer={actions}>
      <View style={styles.titleBlock}>
        {done ? (
          <View style={styles.doneMark}>
            <Icon name="checkmark" size={26} color={colors.goodInk} />
          </View>
        ) : null}
        <Eyebrow tone={done ? 'good' : 'accent'}>{done ? 'Ringkasan sesi' : 'Ringkasan sementara'}</Eyebrow>
        <Text accessibilityRole="header" testID="summary-title" style={styles.title}>
          {done ? 'Sesi selesai' : 'Sesi belum selesai'}
        </Text>
        {done ? (
          <Text testID="summary-minutes" style={styles.subtitle}>
            {duration}
          </Text>
        ) : (
          <Notice tone="info" testID="summary-interim">
            Angka di bawah hanya mencakup jawaban yang sudah tersimpan.
          </Notice>
        )}
      </View>

      {practised.length ? (
        <View style={styles.card} testID="summary-skills">
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Yang Anda latih
          </Text>
          {practised.map((s) => (
            <View key={s} style={styles.skill}>
              <View style={styles.bullet} />
              <Text style={styles.skillText}>{SKILL_LABEL[s]}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.counts} accessibilityLabel="Jawaban sesi ini">
        <View style={styles.stats}>
          <Stat value={sum.answered} label="dijawab" testID="summary-answered" />
          <Stat value={sum.correct} label="benar" testID="summary-correct" />
          <Stat value={sum.wrong} label="belum tepat" testID="summary-wrong" />
          {/* Four-choice answers are never pending: shown only for a saved answer that still is. */}
          {sum.pending ? <Stat value={sum.pending} label="diperiksa" testID="summary-pending" /> : null}
          <Stat value={sum.dont_know} label="belum tahu" testID="summary-dont-know" />
        </View>
        {sum.follow_ups ? <Text style={styles.countNote}>{`${sum.follow_ups} di antaranya latihan ulang setelah kesalahan.`}</Text> : null}
        {sum.reviews ? (
          <Text testID="summary-reviews" style={styles.countNote}>
            {`${sum.reviews} soal adalah ulasan materi sebelumnya.`}
          </Text>
        ) : null}
        {sum.checks ? (
          <Text testID="summary-checks" style={styles.countNote}>
            {`${sum.checks} soal adalah cek ulang setelah 7 atau 30 hari.`}
            {hiddenChecks ? ` ${hiddenChecks} jawaban cek tersimpan; hasilnya ditampilkan setelah semua soal cek itu dijawab.` : ''}
            {sum.checks_not_counted
              ? ` ${sum.checks_not_counted} di antaranya dijawab setelah materinya dilihat hari ini, jadi tidak dihitung sebagai cek ingatan.`
              : ''}
          </Text>
        ) : null}
      </View>

      {done ? (
        <View style={styles.next}>
          <View style={styles.nextIcon}>
            <Icon name="calendar-outline" size={20} color={colors.accentInk} />
          </View>
          {nextDue ? (
            <View testID="summary-next" style={styles.nextBody}>
              <Text style={styles.nextLabel}>Ulasan/cek berikutnya</Text>
              <Text style={styles.nextDate}>{`${formatDue(nextDue, learning.today)}.`}</Text>
            </View>
          ) : (
            <Text testID="summary-next" style={styles.nextNone}>
              Belum ada ulasan atau cek yang terjadwal.
            </Text>
          )}
        </View>
      ) : null}

      <Notice tone="info">Jawaban empat pilihan dicatat sebagai pengenalan. Penguasaan belum dinilai.</Notice>
    </Page>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: 8, marginTop: 16 },
  doneMark: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.goodBg,
    borderWidth: 1,
    borderColor: colors.goodLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  card: { gap: 8, paddingVertical: 16, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 22, color: colors.ink },
  skill: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bullet: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
  skillText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
  counts: { gap: 8, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 22, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  stat: { flexGrow: 1, flexBasis: 70, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28, color: colors.ink },
  statLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted, textAlign: 'center' },
  countNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center', marginHorizontal: 8 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  nextIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  nextBody: { flex: 1 },
  nextLabel: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  nextDate: { fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 24, color: colors.ink },
  nextNone: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
});

export default function Summary() {
  // A validated learning beta is bounded starter access: Home before any legacy hydration or learning effect mounts.
  if (learningBetaEnabled()) return <Redirect href="/" />;
  return (
    <HydrationGate>
      <SummaryRoute />
    </HydrationGate>
  );
}
