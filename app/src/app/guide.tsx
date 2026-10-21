import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { recordScreenView } from '@/engine/exposure';
import { localDate } from '@/engine/util';
import { useApp } from '@/ui/AppContext';
import { Btn, DraftChip, ErrorDetail, Icon, MixedText, Notice, Page, ScreenHeader, Sheet, StorageRefused, type PageHandle } from '@/ui/components';
import { moveFocus } from '@/ui/a11y';
import { UNIT_ORDER, UNIT_TITLE } from '@/ui/labels';
import { LessonPanel } from '@/ui/LessonPanel';
import { colors, fonts, radius } from '@/ui/theme';
import { isLearningError, useLearning } from '@/ui/useLearning';
import { HydrationGate } from '@/ui/Hydration';

/** Wall clock for dated views (read in callbacks and effects, never during render). */
const clock = () => Date.now();

const ABOUT =
  'Membaca panduan bukan latihan dan tidak mengubah sesi. Tanggal membaca dicatat. Cek ingatan yang memakai materi ini ditunda ke hari lain. Jika cek itu sudah dimulai hari ini, jawabannya tetap dicatat, tetapi tidak dihitung sebagai bukti ingatan.';

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
  const [sheet, setSheet] = useState<'topics' | 'about' | null>(null);
  const [focusAsk, setFocusAsk] = useState(0); // counts choices of lesson (focus effect below)
  // Every choice of lesson is a new attempt to save its dated view, so choosing a lesson whose view
  // could not be saved tries again (a lesson already saved on this visit is not saved twice).
  const [attempt, setAttempt] = useState(0);
  const page = useRef<PageHandle>(null);
  // UI-01 focus targets: the title of the lesson shown, or the error shown instead of it.
  const heading = useRef<View>(null);
  const errorRegion = useRef<View>(null);
  // Openers of the two sheets: focus returns there when a sheet is dismissed.
  const topicsButton = useRef<View>(null);
  const aboutButton = useRef<View>(null);
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
  // Shown: the lesson once the dated view of this viewing is saved, or the error instead if saving it failed.
  const showError = recordError !== null && recordError.key === viewKey;
  const showLesson = !showError && viewKey !== null && recorded === viewKey;
  // Focus moves to whichever of the two appears, never while the view is still being saved, and again after
  // every choice of lesson: choosing closes the contents sheet and removes the pressed link, even when the
  // same lesson stays shown.
  useEffect(() => {
    if (showError) moveFocus(errorRegion);
    else if (showLesson) moveFocus(heading);
  }, [showError, showLesson, viewKey, focusAsk]);
  useEffect(() => {
    if (!store || !shownId || !viewKey) return;
    let alive = true;
    const now = clock();
    recordScreenView(store, { screen_id: shownId, local_date: localDate(now), source: 'guide', at: new Date(now).toISOString() }).then(
      () => {
        if (!alive) return;
        setRecorded(viewKey);
        // This viewing is saved now: an error left by an earlier failed save of the same viewing is stale.
        setRecordError((e) => (e?.key === viewKey ? null : e));
      },
      (e) => alive && setRecordError({ key: viewKey, message: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      alive = false;
    };
  }, [store, shownId, viewKey, attempt]);

  if (!learner || content.empty) return <Redirect href="/" />;
  if (learning === undefined)
    return (
      <Page>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat panduan" />
      </Page>
    );
  if (isLearningError(learning)) return <StorageRefused message={learning.error} />;
  if (learning === null) return <Redirect href="/" />;
  const screen = screens[index];
  if (!screen) return <Redirect href="/" />;

  const choose = (n: number) => {
    setIndex(n);
    setSheet(null);
    setFocusAsk((ask) => ask + 1);
    setAttempt((a) => a + 1);
    page.current?.toTop();
  };
  const unitScreens = screens.filter((s) => s.unit === screen.unit);
  const last = index === screens.length - 1;
  const openUnits = UNIT_ORDER.filter((u) => open.includes(u));
  const closedUnits = UNIT_ORDER.filter((u, n) => n > 0 && !open.includes(u) && content.screens.some((s) => s.unit === u));

  const pager = (
    <View style={styles.pager}>
      <View style={styles.pagerBack}>
        <Btn kind="secondary" icon="arrow-back" label="Sebelumnya" disabled={index === 0} onPress={() => choose(index - 1)} style={styles.pagerButton} />
      </View>
      <View style={styles.pagerNext}>
        {last ? (
          <Btn testID="guide-practice" label="Ke latihan" icon="arrow-forward" onPress={() => router.push('/session')} style={styles.pagerButton} />
        ) : (
          <Btn testID="guide-next" label="Berikutnya" icon="arrow-forward" onPress={() => choose(index + 1)} style={styles.pagerButton} />
        )}
      </View>
    </View>
  );

  return (
    <Page ref={page} footer={pager} footerInset={false}>
      <ScreenHeader title="Panduan">
        <DraftChip />
        <Pressable
          ref={topicsButton}
          testID="guide-topics"
          accessibilityRole="button"
          accessibilityHint="Membuka daftar isi"
          accessibilityState={{ expanded: sheet === 'topics' }}
          aria-expanded={sheet === 'topics'}
          onPress={() => setSheet('topics')}
          style={({ pressed }) => [styles.contentsButton, pressed && styles.pressed]}
        >
          <Icon name="list" size={18} color={colors.ink} />
          <Text style={styles.contentsButtonText}>Daftar isi</Text>
        </Pressable>
      </ScreenHeader>

      {showError ? (
        <>
          <View role="alert" accessibilityLiveRegion="assertive" ref={errorRegion} tabIndex={-1} testID="guide-record-error-region">
            <Notice tone="danger" testID="guide-record-error">
              Panduan tidak dapat dibuka. Tanggal membaca belum tersimpan. Coba lagi nanti.
            </Notice>
          </View>
          <ErrorDetail message={recordError.message} />
        </>
      ) : showLesson ? (
        <LessonPanel
          screen={screen}
          scale={learner.arabic_scale}
          eyebrow={`Unit ${screen.unit} · ${unitScreens.indexOf(screen) + 1} dari ${unitScreens.length}`}
          headingRef={heading}
        />
      ) : (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat panduan" style={styles.loading} />
      )}

      <View style={styles.note}>
        <Icon name="information-circle-outline" size={18} color={colors.muted} />
        <View style={styles.noteBody}>
          <Text style={styles.noteText}>Membaca panduan bukan latihan. Cek ingatan materi ini ditunda.</Text>
          <Pressable
            ref={aboutButton}
            testID="guide-about"
            accessibilityRole="button"
            accessibilityHint="Membuka penjelasan tentang panduan"
            onPress={() => setSheet('about')}
            style={styles.more}
          >
            <Text style={styles.moreText}>Selengkapnya</Text>
          </Pressable>
        </View>
      </View>

      <Sheet
        visible={sheet === 'topics'}
        title="Daftar isi"
        closeLabel="Tutup daftar isi"
        onClose={() => setSheet(null)}
        returnFocus={topicsButton}
        testID="guide-contents"
      >
        {openUnits.map((u) => (
          <View key={u} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupTitle}>{`Unit ${u} · ${UNIT_TITLE[u]}`}</Text>
            {screens
              .filter((s) => s.unit === u)
              .map((s, n) => {
                const at = screens.indexOf(s);
                const on = at === index;
                return (
                  <Pressable
                    key={s.screen_id}
                    testID={`guide-${s.screen_id}`}
                    accessibilityRole="link"
                    accessibilityState={{ selected: on }}
                    // On the web a link marks the lesson shown with aria-current (aria-selected is not valid on links).
                    aria-current={on ? 'page' : undefined}
                    onPress={() => choose(at)}
                    style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && !on && styles.pressed]}
                  >
                    <View style={[styles.num, on && styles.numOn]}>
                      <Text style={[styles.numText, on && styles.numTextOn]}>{n + 1}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <MixedText scale={learner.arabic_scale} style={[styles.rowTitle, on && styles.rowTitleOn]}>
                        {s.title}
                      </MixedText>
                      {on ? <Text style={styles.current}>Sedang dibaca</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
          </View>
        ))}
        {closedUnits.map((u) => (
          <View key={u} style={styles.locked}>
            <Icon name="lock-closed-outline" size={16} color={colors.muted} />
            <Text style={styles.lockedText}>{`Unit ${u} dibuka setelah panduan dan latihan inti Unit ${UNIT_ORDER[UNIT_ORDER.indexOf(u) - 1]} dikerjakan.`}</Text>
          </View>
        ))}
        <View style={styles.sheetDivider} />
        <Pressable
          testID="guide-about-sheet"
          accessibilityRole="button"
          onPress={() => setSheet('about')}
          style={({ pressed }) => [styles.aboutRow, pressed && styles.pressed]}
        >
          <Icon name="information-circle-outline" size={20} color={colors.muted} />
          <Text style={styles.aboutRowText}>Tentang panduan</Text>
          <Icon name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      </Sheet>

      <Sheet visible={sheet === 'about'} title="Tentang panduan" onClose={() => setSheet(null)} returnFocus={aboutButton} testID="guide-about-dialog">
        <Text testID="guide-about-body" style={styles.aboutBody}>
          {ABOUT}
        </Text>
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.chipBg },
  contentsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  contentsButtonText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  loading: { paddingVertical: 32 },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    backgroundColor: colors.sheet2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  noteBody: { flex: 1, alignItems: 'flex-start', gap: 2 },
  noteText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
  more: { minHeight: 44, justifyContent: 'center' },
  moreText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.accentInk, textDecorationLine: 'underline' },

  pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 10 },
  pagerBack: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  pagerNext: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  pagerButton: { flexGrow: 1 },

  group: { gap: 2 },
  groupTitle: { fontFamily: fonts.extrabold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5, color: colors.muted, marginHorizontal: 8, marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.input },
  rowOn: { backgroundColor: colors.accentSoft },
  num: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  numOn: { backgroundColor: colors.accent },
  numText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.text },
  numTextOn: { fontFamily: fonts.extrabold, color: colors.white },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  rowTitleOn: { fontFamily: fonts.extrabold, color: colors.accentDeep },
  current: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.accentInk },
  locked: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 8, marginTop: 4 },
  lockedText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
  sheetDivider: { height: 1, backgroundColor: colors.line, marginHorizontal: 8, marginTop: 6 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderRadius: radius.input },
  aboutRowText: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink },
  aboutBody: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 27, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
});

export default function Guide() {
  return (
    <HydrationGate write>
      <GuideRoute />
    </HydrationGate>
  );
}
