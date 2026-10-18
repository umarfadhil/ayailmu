import { Redirect, router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { recordScreenView } from '@/engine/exposure';
import { localDate } from '@/engine/util';
import { useApp } from '@/ui/AppContext';
import { Btn, ErrorDetail, Eyebrow, H1, MixedText, Muted, Notice, Page, StorageRefused, useIsDesktop } from '@/ui/components';
import { LessonPanel } from '@/ui/LessonPanel';
import { colors, radius } from '@/ui/theme';
import { isLearningError, useLearning } from '@/ui/useLearning';
import { HydrationGate } from '@/ui/Hydration';

/** Wall clock for dated views (read in callbacks and effects, never during render). */
const clock = () => Date.now();

/**
 * Browser for the lesson screens of units already open (S19–S22 guide anatomy). It never marks
 * screens seen, touches the session snapshot or logs answers; it records only a dated view of each
 * screen shown (teaching provenance), and shows a screen only once that view is saved, so a timed
 * check after a same-day Guide view is postponed or recorded as not counted. Locked/advanced
 * material (e.g. Unit B speech) is never shown here. Practice always goes to the canonical /session.
 */
function GuideRoute() {
  const { learner, content, store } = useApp();
  const [recorded, setRecorded] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<{ key: string; message: string } | null>(null);
  const desktop = useIsDesktop();
  const params = useLocalSearchParams<{ screen?: string }>();
  const learning = useLearning();
  const [chosen, setIndex] = useState<number | null>(null);
  const open = learning && !isLearningError(learning) ? learning.open : [];
  const screens = content.screens.filter((s) => open.includes(s.unit));
  const index = chosen ?? Math.max(0, screens.findIndex((s) => s.screen_id === params.screen));
  const shownId = screens[index]?.screen_id;
  // Expo Router keeps this route mounted while hidden: every focus of the route (and every return of
  // the app to the foreground) is a new viewing, possibly on a later day. The view key carries that
  // viewing and its date, so a view saved on an earlier visit never unlocks today's display.
  const [visit, setVisit] = useState<{ seq: number; day: string } | null>(null);
  const visits = useRef(0);
  const newVisit = useCallback(() => {
    visits.current += 1;
    setVisit({ seq: visits.current, day: localDate(clock()) });
  }, []);
  useFocusEffect(
    useCallback(() => {
      newVisit();
      const sub = AppState.addEventListener('change', (st) => st === 'active' && newVisit());
      return () => {
        sub.remove();
        setVisit(null); // hidden: nothing is shown until the next visit is recorded
      };
    }, [newVisit])
  );
  const viewKey = visit && shownId ? `${shownId}|${visit.day}|${visit.seq}` : null;
  useEffect(() => {
    if (!store || !shownId || !viewKey) return;
    let alive = true;
    const now = clock();
    recordScreenView(store, { screen_id: shownId, local_date: localDate(now), source: 'guide', at: new Date(now).toISOString() }).then(
      () => alive && setRecorded(viewKey),
      (e) => alive && setRecordError({ key: viewKey, message: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      alive = false;
    };
  }, [store, shownId, viewKey]);

  if (!learner || content.empty) return <Redirect href="/" />;
  if (learning === undefined) return null;
  if (isLearningError(learning)) return <StorageRefused message={learning.error} />;
  if (learning === null) return <Redirect href="/" />;
  const screen = screens[index];
  if (!screen) return <Redirect href="/" />;

  const contents = (
    <View style={[styles.contents, desktop && styles.contentsDesktop]} accessibilityRole="menu">
      <Text style={styles.contentsTitle}>Isi panduan</Text>
      {screens.map((s, n) => {
        const on = n === index;
        return (
          <Pressable
            key={s.screen_id}
            testID={`guide-${s.screen_id}`}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            onPress={() => setIndex(n)}
            style={[styles.contentsRow, on && styles.contentsRowOn]}
          >
            <MixedText scale={learner.arabic_scale} style={[styles.contentsText, on && styles.contentsTextOn]}>
              {`${s.unit}${screens.filter((x) => x.unit === s.unit).indexOf(s) + 1}. ${s.title}`}
            </MixedText>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Page width="wide">
      <View style={styles.band}>
        <Eyebrow tone="mint">Panduan</Eyebrow>
        <H1>{learning.open.length > 1 ? 'Panduan Unit A dan B' : 'Panduan Unit A'}</H1>
        <Muted>
          Bacaan pendukung dari awal sesi. Membuka panduan tidak dihitung sebagai latihan dan tidak mengubah sesi Anda. Tanggal
          Anda membuka materi dicatat: cek ulang yang memakai materi ini ditunda ke hari lain, atau tidak dihitung sebagai cek
          ingatan bila cek itu sudah berjalan hari ini.
        </Muted>
      </View>
      <View style={[desktop && styles.split]}>
        {contents}
        <View style={[styles.mainCol, desktop && { flex: 1 }]}>
          {recordError && recordError.key === viewKey ? (
            <>
              <Notice tone="danger" testID="guide-record-error">
                Panduan tidak dapat dibuka karena tanggal Anda membuka materi ini tidak bisa disimpan. Silakan coba lagi nanti.
              </Notice>
              <ErrorDetail message={recordError.message} />
            </>
          ) : viewKey !== null && recorded === viewKey ? (
            <LessonPanel screen={screen} scale={learner.arabic_scale} eyebrow={`Unit ${screen.unit} · Panduan ${index + 1} dari ${screens.length}`} />
          ) : (
            <ActivityIndicator color={colors.indigo} accessibilityLabel="Memuat panduan" />
          )}
          <View style={styles.pager}>
            <View style={{ flex: 1 }}>
              <Btn
                kind="secondary"
                icon="arrow-back"
                label="Sebelumnya"
                disabled={index === 0}
                onPress={() => setIndex(index - 1)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Btn
                kind="secondary"
                label="Berikutnya"
                disabled={index === screens.length - 1}
                testID="guide-next"
                onPress={() => setIndex(index + 1)}
              />
            </View>
          </View>
          <View style={styles.bottomBar}>
            <Btn testID="guide-practice" label="Ke latihan" icon="create-outline" onPress={() => router.navigate('/session')} />
            <Btn kind="quiet" icon="arrow-back" label="Kembali ke beranda" onPress={() => router.navigate('/' as Href)} />
          </View>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.unitPanelA,
    borderColor: '#D7E3DD',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 18,
    gap: 6,
  },
  split: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  contents: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 2,
    marginBottom: 14,
  },
  contentsDesktop: { width: 240, marginBottom: 0 },
  contentsTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, paddingHorizontal: 8, paddingVertical: 6, writingDirection: 'ltr', textAlign: 'left' },
  contentsRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: radius.sm },
  contentsRowOn: { backgroundColor: colors.indigoSoft },
  contentsText: { fontSize: 15, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  contentsTextOn: { color: colors.indigoText, fontWeight: '700' },
  mainCol: { gap: 14 },
  pager: { flexDirection: 'row', gap: 10 },
  bottomBar: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
});

export default function Guide() {
  return (
    <HydrationGate write>
      <GuideRoute />
    </HydrationGate>
  );
}
