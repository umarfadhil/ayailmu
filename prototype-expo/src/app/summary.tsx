import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { restoreSnapshot } from '@/engine/controller';
import { summarize, type SessionSummary } from '@/engine/session';
import { useApp } from '@/ui/AppContext';
import { Btn, Card, EmptyState, Eyebrow, H1, Muted, Notice, P, Page } from '@/ui/components';
import { colors } from '@/ui/theme';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

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
 * No streaks, percentages or mastery claims.
 */
export default function Summary() {
  const { store, rules, content, refreshLearner } = useApp();
  const [data, setData] = useState<{ sum: SessionSummary; done: boolean } | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!store) return;
        await refreshLearner();
        const s = restoreSnapshot(await store.loadSnapshot(), content);
        if (alive) setData(s ? { sum: summarize(s, rules, Date.now()), done: s.phase === 'done' } : null);
      })();
      return () => {
        alive = false;
      };
    }, [store, content, rules, refreshLearner])
  );

  if (data === undefined) return null;
  if (!data) {
    return (
      <Page>
        <H1>Ringkasan</H1>
        <EmptyState icon="stats-chart-outline" title="Belum ada sesi">
          <P style={{ textAlign: 'center' }}>Ringkasan muncul setelah Anda memulai sesi.</P>
        </EmptyState>
        <Btn testID="summary-start" label="Mulai sesi" onPress={() => router.navigate('/session')} />
      </Page>
    );
  }

  const { sum, done } = data;
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
        <Muted>Waktu: sekitar {sum.minutes} menit.</Muted>
      </Card>

      <Card>
        <P>Yang dilatih: memahami kalimat «dia + sifat» (هُوَ / هِيَ), memilih bentuk yang cocok, dan arti kata.</P>
        {done ? <P testID="summary-next">Ulasan berikutnya: {formatDate(sum.next_review_date)}.</P> : null}
      </Card>

      <Notice tone="warn">
        Prototipe ini belum menilai apakah sebuah keterampilan sudah dikuasai. Jawaban yang disimpan untuk diperiksa tidak
        dihitung benar atau salah.
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
