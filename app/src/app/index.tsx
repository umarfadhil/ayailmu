import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { restoreSnapshot } from '@/engine/controller';
import type { SessionState } from '@/engine/session';
import { localDate } from '@/engine/util';
import { useApp } from '@/ui/AppContext';
import { Btn, EmptyState, Eyebrow, H1, H2, Icon, Muted, Notice, P, Page, useIsDesktop } from '@/ui/components';
import { colors, radius } from '@/ui/theme';

// Unit name from Lessons_Unit_A_B_Draft.md Part 2 («Siapa yang dijelaskan?»).
const UNIT_TITLE = 'Unit A — Siapa yang dijelaskan?';
const OUTLINE_ACCENTS = [colors.topicBar, colors.exampleBar, colors.clueBar];

export default function Home() {
  const { ready, error, store, rules, content, learner } = useApp();
  const desktop = useIsDesktop();
  const [snap, setSnap] = useState<SessionState | null | undefined>(undefined);
  const [today, setToday] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setToday(localDate(Date.now()));
      if (store) store.loadSnapshot().then((s) => alive && setSnap(restoreSnapshot(s, content)));
      return () => {
        alive = false;
      };
    }, [store, content])
  );

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

  const inProgress = !!snap && snap.phase !== 'done';
  const doneToday = !!snap && snap.phase === 'done' && snap.local_date === today;
  const practiceCount = content.items.filter((i) => i.pool === 'PRACT').length;
  const startLabel = inProgress ? 'Lanjutkan sesi' : doneToday ? 'Mulai sesi tambahan (demo)' : 'Mulai sesi';

  return (
    <Page width="wide">
      <H1>Sesi hari ini</H1>

      <View style={styles.unit}>
        <LinearGradient
          colors={[colors.unitPanelA, colors.unitPanelB]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]}
          pointerEvents="none"
        />
        <Eyebrow tone="mint">Unit A</Eyebrow>
        <Text accessibilityRole="header" style={[styles.unitTitle, desktop && styles.unitTitleDesktop]}>
          {UNIT_TITLE}
        </Text>
        <P>{content.screens[0]?.body[0]}</P>
        <Muted testID="unit-inventory">
          {content.screens.length} panduan · {practiceCount} soal latihan · {learner.session_minutes} menit per sesi
        </Muted>
        {inProgress ? (
          <Muted testID="session-status">
            Sesi sebelumnya belum selesai: {snap!.results.length} jawaban tersimpan. Anda bisa melanjutkannya.
          </Muted>
        ) : null}
        {doneToday ? <Muted testID="session-status">Sesi hari ini sudah selesai. Terima kasih.</Muted> : null}
        {snap === undefined ? (
          <ActivityIndicator color={colors.indigo} />
        ) : (
          <View style={[styles.actions, !desktop && styles.actionsStack]}>
            <Btn testID="start-session" label={startLabel} onPress={() => router.push('/session')} />
            <Btn kind="secondary" label="Lihat panduan" icon="document-text-outline" onPress={() => router.push('/guide' as Href)} />
            {doneToday ? <Btn kind="secondary" label="Lihat ringkasan" onPress={() => router.push('/summary')} /> : null}
          </View>
        )}
      </View>

      <View style={{ gap: 4, marginTop: 6 }}>
        <H2>Daftar materi dalam unit ini</H2>
        <Muted>Ikuti panduan secara berurutan, lalu kerjakan latihannya.</Muted>
      </View>
      {content.screens.map((s, n) => (
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
