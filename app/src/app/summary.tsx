import { Redirect, router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { summarize } from '@/engine/session';
import { useApp } from '@/ui/AppContext';
import { Btn, Card, EmptyState, Eyebrow, H1, Muted, Notice, P, Page } from '@/ui/components';
import { colors } from '@/ui/theme';
import { formatDue, useLearning } from '@/ui/useLearning';

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Factual counts for the saved session. Reachable from navigation at any time, so an
 * unfinished session is labelled as such (never «Sesi selesai») and offers to resume.
 * The next date comes from the actual review/check projection, never a fixed "tomorrow".
 * No streaks, percentages or mastery claims.
 */
export default function Summary() {
  const { content } = useApp();
  const learning = useLearning();

  if (content.empty) return <Redirect href="/" />;
  if (learning === undefined) return null;
  if (learning === null) return <Redirect href="/" />;
  const nextDue = learning.progress.next_due;
  const nextLine = nextDue ? (
    <P testID="summary-next">Jadwal ulasan atau cek berikutnya: {formatDue(nextDue, learning.today)}.</P>
  ) : (
    <P testID="summary-next">Belum ada ulasan atau cek yang terjadwal.</P>
  );

  const snap = learning.snapshot;
  if (snap.kind !== 'ok') {
    return (
      <Page>
        <H1>Ringkasan</H1>
        <EmptyState icon="stats-chart-outline" title="Belum ada sesi">
          <P style={{ textAlign: 'center' }}>Ringkasan muncul setelah Anda memulai sesi dengan format soal saat ini.</P>
        </EmptyState>
        {nextLine}
        <Btn testID="summary-start" label="Mulai sesi" onPress={() => router.navigate('/session')} />
      </Page>
    );
  }

  const done = snap.state.phase === 'done';
  const sum = summarize(snap.state, learning.now);
  return (
    <Page>
      <Eyebrow tone={done ? 'mint' : 'indigo'}>{done ? 'Ringkasan sesi' : 'Ringkasan sementara'}</Eyebrow>
      <H1 testID="summary-title">{done ? 'Sesi selesai' : 'Sesi belum selesai'}</H1>
      {!done ? (
        <Notice tone="info" testID="summary-interim">
          Sesi ini masih berjalan. Angka di bawah hanya mencakup jawaban yang sudah tersimpan.
        </Notice>
      ) : null}

      <Card>
        <View style={styles.stats}>
          <Stat value={sum.answered} label="Dijawab" color={colors.ink} />
          <Stat value={sum.correct} label="Benar" color={colors.mintInk} />
          <Stat value={sum.wrong} label="Belum tepat" color={colors.dangerInk} />
          <Stat value={sum.pending} label="Diperiksa" color={colors.infoInk} />
          <Stat value={sum.dont_know} label="Belum tahu" color={colors.muted} />
        </View>
        <Muted testID="summary-counts">
          Anda menjawab {sum.answered} soal: {sum.correct} benar, {sum.wrong} belum tepat, {sum.pending} disimpan untuk
          diperiksa, {sum.dont_know} «belum tahu».
        </Muted>
        {sum.follow_ups ? <Muted>{sum.follow_ups} di antaranya adalah latihan ulang setelah kesalahan.</Muted> : null}
        {sum.reviews ? <Muted testID="summary-reviews">{sum.reviews} soal adalah ulasan materi sebelumnya.</Muted> : null}
        {sum.checks ? <Muted testID="summary-checks">{sum.checks} soal adalah cek ulang setelah 7 atau 30 hari.</Muted> : null}
        <Muted>Waktu: sekitar {sum.minutes} menit.</Muted>
      </Card>

      <Card>
        {done ? nextLine : null}
        <Btn kind="secondary" label="Lihat kemajuan" icon="analytics-outline" testID="summary-progress" onPress={() => router.navigate('/progress' as Href)} />
      </Card>

      <Notice tone="warn">
        Prototipe ini belum menilai apakah sebuah keterampilan sudah dikuasai. Jawaban empat pilihan dicatat sebagai
        pengenalan, bukan jawaban yang ditulis sendiri.
      </Notice>

      {done ? (
        <Btn testID="summary-home" label="Kembali ke beranda" onPress={() => router.replace('/')} />
      ) : (
        <>
          <Btn testID="summary-resume" label="Lanjutkan sesi" icon="arrow-forward" onPress={() => router.navigate('/session')} />
          <Btn kind="quiet" label="Kembali ke beranda" onPress={() => router.navigate('/')} />
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: 96, alignItems: 'center', paddingVertical: 8, gap: 2 },
  statValue: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  statLabel: { fontSize: 13, color: colors.muted, writingDirection: 'ltr' },
});
