import { Redirect, router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewInstance } from 'react-native';

import type { ChoiceOption, Item } from '@/content/schema';
import { prepareSession, SessionController } from '@/engine/controller';
import type { Response } from '@/engine/scoring';
import { currentStep, findItem, type FeedbackView, type ItemStep } from '@/engine/session';
import { newId } from '@/engine/util';
import { onCheckpoint } from '@/storage/checkpoints';
import { moveFocus } from '@/ui/a11y';
import { APP_VERSION, useApp } from '@/ui/AppContext';
import {
  ArabicText,
  Btn,
  ConstructedLabel,
  DraftChip,
  ErrorDetail,
  Eyebrow,
  H1,
  HelpLines,
  Icon,
  IconButton,
  MixedText,
  Notice,
  P,
  Page,
  ProgressTrack,
  ReportButton,
  type IconName,
  type PageHandle,
} from '@/ui/components';
import { LessonPanel } from '@/ui/LessonPanel';
import { MigrationNotice } from '@/ui/notices';
import { colors, dockShadow, fonts, radius, shadow } from '@/ui/theme';
import { HydrationGate } from '@/ui/Hydration';

const OUTCOME_TITLE = {
  correct: 'Benar',
  wrong: 'Belum tepat',
  pending: 'Jawaban disimpan untuk diperiksa',
  dont_know: 'Tidak apa-apa',
} as const;
/** Scheduled check (F03): one neutral title, tone and icon whatever the outcome, so nothing leaks during the block. */
const DEFERRED_TITLE = 'Jawaban tersimpan';
type Tone = 'good' | 'miss' | 'info' | 'saved';
const OUTCOME_TONE: Record<FeedbackView['outcome'], Tone> = { correct: 'good', wrong: 'miss', pending: 'info', dont_know: 'info' };
const TONE: Record<Tone, { bg: string; line: string; ink: string; icon: IconName }> = {
  good: { bg: colors.goodBg, line: colors.goodLine, ink: colors.goodInk, icon: 'checkmark-circle-outline' },
  miss: { bg: colors.missBg, line: colors.missLine, ink: colors.missInk, icon: 'alert-circle-outline' },
  info: { bg: colors.infoBg, line: colors.infoLine, ink: colors.infoInk, icon: 'information-circle-outline' },
  saved: { bg: colors.accentSoft, line: colors.accentLine, ink: colors.accentInk, icon: 'file-tray-outline' },
};
const ROLE_LABEL: Record<string, string> = { review: 'Ulasan', check: 'Cek ulang', remed: 'Latihan ulang', focus: 'Pertanyaan singkat' };
const CLOSED_NOTE = 'Sesi disimpan. Lanjutkan kapan saja.';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; ctrl: SessionController }
  | { kind: 'nothing-due' }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string };

/**
 * Session bar: close, the step label with its progress track, and the Draf chip. With very large text the
 * label moves under the close button. The session runs full screen: no route menu, no tab bar.
 */
function SessionBar({ label, value = 0, max = 0, onClose }: { label?: string; value?: number; max?: number; onClose: () => void }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;
  const progress = label ? (
    <View style={styles.barProgress}>
      <Text style={styles.barLabel} testID="step-progress">
        {label}
      </Text>
      <ProgressTrack value={value} max={max} label={label} testID="step-progress-track" />
    </View>
  ) : (
    <View style={styles.barProgress} />
  );
  return (
    <View style={styles.bar}>
      <View style={styles.barInner}>
        <View style={styles.barRow}>
          <IconButton icon="close" label="Tutup sesi" testID="session-close" onPress={onClose} />
          {stacked ? <View style={styles.barProgress} /> : progress}
          <DraftChip />
        </View>
        {stacked && label ? <View style={styles.barStacked}>{progress}</View> : null}
      </View>
    </View>
  );
}

function SessionScreenRoute() {
  const { store, rules, content, learner, setFlash } = useApp();
  const { height: windowHeight } = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0); // set when each step is shown (effect below)
  // UI-01 focus targets: the heading of each newly shown question/lesson screen, and a save error.
  const stepHeading = useRef<ViewInstance>(null);
  const errorRegion = useRef<ViewInstance>(null);
  // Each new step starts at the top of its page.
  const page = useRef<PageHandle>(null);

  // Resume a valid saved session or plan a new one (persisted before display; incompatible saves archived atomically).
  useEffect(() => {
    if (!store || !learner || content.empty) return;
    let alive = true;
    (async () => {
      try {
        const r = await prepareSession({ store, content, rules, now: Date.now(), appVersion: APP_VERSION });
        if (!alive) return;
        if (r.kind === 'resume' || r.kind === 'new') {
          setLoad({ kind: 'ready', ctrl: new SessionController({ store, content, rules, learner: r.learner, history: r.history, state: r.state }) });
        } else if (r.kind === 'nothing-due') setLoad({ kind: 'nothing-due' });
        else setLoad({ kind: 'refused', reason: r.reason });
      } catch (e) {
        if (alive) setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
    // Start once per mount; learner changes during a session are written by the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const ctrl = load.kind === 'ready' ? load.ctrl : null;
  const state = ctrl?.state;
  const step = state ? currentStep(state) : null;
  const stepKey = state ? `${state.session_id}:${state.index}:${state.phase}` : '';
  // A new question or lesson screen starts at its heading: the page keeps its scroll position between
  // steps, and native focus does not scroll the view. Before paint, so the old position never shows.
  useLayoutEffect(() => {
    if (state?.phase === 'step') page.current?.toTop();
  }, [stepKey, state?.phase]);
  useEffect(() => {
    shownAt.current = Date.now();
    // A new question or lesson screen takes keyboard/screen-reader focus (after Lanjut the old
    // button is gone; focus must not fall back to the page body). Feedback focuses its own heading.
    if (state?.phase === 'step') moveFocus(stepHeading);
  }, [stepKey, state?.phase]);
  const saveFailed = ctrl?.error ?? null;
  useEffect(() => {
    if (saveFailed) moveFocus(errorRegion);
  }, [saveFailed, tick]);

  useEffect(() => {
    if (state?.phase === 'done') router.replace('/summary');
  }, [state?.phase]);

  // ENG-04 lifecycle checkpoints: active time is saved and the step clock stops when the app goes to
  // the background / the tab is hidden, when the page is left (pagehide, before the web writer lock
  // is released) and when the route loses focus; it restarts when visible again. Hidden time is never charged.
  useEffect(() => {
    if (!ctrl) return;
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? ctrl.resume() : void ctrl.pause()));
    const off = onCheckpoint(() => ctrl.pause());
    return () => {
      sub.remove();
      off();
    };
  }, [ctrl]);
  useFocusEffect(
    useCallback(() => {
      ctrl?.resume();
      return () => void ctrl?.pause();
    }, [ctrl])
  );

  // Closing keeps the session: leaving the route checkpoints it, and Home offers to continue it.
  const leave = (saved: boolean) => {
    if (saved) setFlash(CLOSED_NOTE);
    router.dismissTo('/');
  };

  if (!learner) return <Redirect href="/" />;
  if (content.empty) return <Redirect href="/" />;
  if (load.kind === 'error' || load.kind === 'refused') {
    return (
      <Page width="exercise" header={<SessionBar onClose={() => leave(false)} />}>
        <Notice tone="danger" testID="session-refused">
          {load.kind === 'refused'
            ? `Sesi tidak dapat dibuka: ${load.reason} Data tersimpan tidak diubah.`
            : 'Sesi tidak dapat dibuka saat ini. Data tersimpan tidak diubah; silakan coba lagi nanti.'}
        </Notice>
        {load.kind === 'error' ? <ErrorDetail message={load.message} /> : null}
      </Page>
    );
  }
  if (load.kind === 'nothing-due') {
    return (
      <Page
        width="exercise"
        header={<SessionBar onClose={() => leave(false)} />}
        footer={<Btn label="Lihat kemajuan" onPress={() => router.replace('/progress' as Href)} />}
      >
        <MigrationNotice />
        <H1>Tidak ada latihan saat ini</H1>
        <P testID="nothing-due">Semua latihan yang tersedia sudah dikerjakan, dan belum ada ulasan yang jatuh tempo.</P>
      </Page>
    );
  }
  if (!ctrl || !state) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat sesi" />
      </View>
    );
  }

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
      setTick((t) => t + 1);
    }
  };
  const submit = (r: Response) => run(() => ctrl.submit(r, Date.now() - shownAt.current));
  const next = () => run(() => ctrl.next());

  const saveError = ctrl.error ? (
    <View role="alert" accessibilityLiveRegion="assertive" ref={errorRegion} tabIndex={-1} testID="save-error-region">
      <Notice tone="danger" testID="save-error">
        Belum tersimpan. Periksa penyimpanan perangkat lalu coba lagi.
      </Notice>
    </View>
  ) : null;

  const itemCount = state.queue.filter((q) => q.kind === 'item').length;
  const itemIndex = state.queue.slice(0, state.index + 1).filter((q) => q.kind === 'item').length;
  const screenCount = state.queue.filter((q) => q.kind === 'screen').length;
  const screenIndex = state.queue.slice(0, state.index + 1).filter((q) => q.kind === 'screen').length;

  if (!step) return null;

  if (step.kind === 'screen') {
    const screen = content.screens.find((s) => s.screen_id === step.screen_id)!;
    const label = `Pelajaran ${screenIndex} dari ${screenCount}`;
    return (
      <Page
        width="exercise"
        ref={page}
        header={<SessionBar label={label} value={screenIndex - 1} max={screenCount} onClose={() => leave(true)} />}
        footer={
          <>
            {saveError}
            <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
          </>
        }
      >
        <MigrationNotice />
        <LessonPanel screen={screen} scale={learner.arabic_scale} eyebrow={`Unit ${screen.unit}`} headingRef={stepHeading} />
      </Page>
    );
  }

  const item = findItem(content, step.item_id);
  const prompt = content.prompts[item.prompt_id];
  // During a scheduled check, count check questions only: follow-ups queued after a wrong check answer
  // would otherwise change the total and reveal the outcome before the check is complete.
  const inCheck = step.role === 'check';
  const isCheck = (q: (typeof state.queue)[number]) => q.kind === 'item' && q.role === 'check';
  const count = inCheck ? state.queue.filter(isCheck).length : itemCount;
  const position = inCheck ? state.queue.slice(0, state.index + 1).filter(isCheck).length : itemIndex;
  const progress = `${inCheck ? 'Cek ulang' : 'Soal'} ${position} dari ${count}`;
  const feedback = state.phase === 'feedback' && state.feedback?.item_id === item.item_id ? state.feedback : null;
  const tone: Tone | null = feedback ? (feedback.deferred ? 'saved' : OUTCOME_TONE[feedback.outcome]) : null;

  // One docked block after every answer (correct, wrong, «belum tahu» and neutral scheduled checks alike):
  // the result with all its teaching, then Lanjut. It grows to 60 % of the screen and then scrolls itself;
  // Lanjut stays pinned and the tiles above stay reachable.
  const dock =
    feedback && tone ? (
      <View testID="feedback-block" style={styles.dock}>
        <ScrollView style={styles.dockScroll} contentContainerStyle={styles.dockContent}>
          <ResultCard feedback={feedback} tone={tone} scale={learner.arabic_scale} />
          {inCheck ? null : <FollowUpHint state={state} />}
        </ScrollView>
        {saveError}
        <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
      </View>
    ) : undefined;

  return (
    <Page
      width="exercise"
      ref={page}
      header={<SessionBar label={progress} value={state.phase === 'feedback' ? position : position - 1} max={count} onClose={() => leave(true)} />}
      footer={dock}
      footerStyle={
        tone ? [styles.dockSurface, { backgroundColor: TONE[tone].bg, borderTopColor: TONE[tone].line, maxHeight: Math.round(windowHeight * 0.6) }] : undefined
      }
    >
      <MigrationNotice />
      <View style={styles.card}>
        <Eyebrow tone="accent">{`Unit ${item.unit}${ROLE_LABEL[step.role] ? ` · ${ROLE_LABEL[step.role]}` : ''}`}</Eyebrow>
        <View ref={stepHeading} tabIndex={-1} testID="step-heading" accessible accessibilityRole="header" accessibilityLabel={`${progress}. ${prompt}`}>
          <MixedText scale={learner.arabic_scale} style={styles.prompt} testID="item-prompt">
            {prompt}
          </MixedText>
        </View>
        {item.arabic ? (
          <ArabicText scale={learner.arabic_scale} size={46} weight="medium" testID="item-arabic">
            {item.arabic}
          </ArabicText>
        ) : null}
        {item.target ? (
          <MixedText scale={learner.arabic_scale} style={styles.target} testID="item-target">
            {`«${item.target}»`}
          </MixedText>
        ) : null}
        <HelpLines lines={item.help_lines} scale={learner.arabic_scale} />
        {item.format !== 'word-meaning' ? <ConstructedLabel /> : null}
      </View>
      <OptionTiles
        key={stepKey}
        item={item}
        step={step}
        feedback={feedback}
        disabled={busy || !!feedback}
        scale={learner.arabic_scale}
        onChoose={(id) => submit({ kind: 'choice', option_id: id })}
      />
      {/* UI-01: persistent polite live region; empty until an answer is saved, so nothing leaks before answering. */}
      <View accessibilityLiveRegion="polite" role="status" testID="result-live">
        {feedback ? <Text style={styles.srOnly}>{feedback.deferred ? DEFERRED_TITLE : OUTCOME_TITLE[feedback.outcome]}</Text> : null}
      </View>
      {feedback ? null : (
        <>
          {saveError}
          <View style={styles.quiet}>
            {/* Always available, including guided focus questions (source principle; review F07). */}
            <Btn testID="dont-know" kind="quiet" icon="help-circle-outline" label="Saya belum tahu" disabled={busy} onPress={() => submit({ kind: 'dont_know' })} />
            <ReportButton
              onSubmit={async (reason, text) => {
                await store!.addReport({
                  report_id: newId('rep'),
                  learner_id: learner.learner_id,
                  item_id: item.item_id,
                  content_version: item.content_version,
                  timestamp: new Date().toISOString(),
                  reason,
                  text,
                });
              }}
            />
          </View>
        </>
      )}
    </Page>
  );
}

/** Feedback after a saved answer. Focus moves to its heading (UI-01). Scheduled checks stay neutral (F03). */
function ResultCard({ feedback, tone, scale }: { feedback: FeedbackView; tone: Tone; scale: number }) {
  const heading = useRef<ViewInstance>(null);
  useEffect(() => {
    moveFocus(heading);
  }, []);
  const t = TONE[tone];
  const title = feedback.deferred ? DEFERRED_TITLE : OUTCOME_TITLE[feedback.outcome];
  const icon: IconName = !feedback.deferred && feedback.outcome === 'pending' ? 'time-outline' : t.icon;
  return (
    <View style={styles.result} testID="result-card">
      <View ref={heading} tabIndex={-1} style={styles.resultHead} testID="result-heading" accessible accessibilityRole="header" accessibilityLabel={title}>
        <Icon name={icon} size={26} color={t.ink} />
        <Text style={[styles.resultTitle, { color: t.ink }]} testID="result-title">
          {title}
        </Text>
      </View>
      {feedback.messages.map((m) => (
        <MixedText key={m} testID="feedback-message" scale={scale} style={styles.feedbackText}>
          {m}
        </MixedText>
      ))}
    </View>
  );
}

function FollowUpHint({ state }: { state: NonNullable<SessionController['state']> }) {
  const nextStep = state.queue[state.index + 1];
  if (!nextStep || nextStep.kind !== 'item' || (nextStep.role !== 'focus' && nextStep.role !== 'remed')) return null;
  return (
    <View style={styles.hint}>
      <Icon name="arrow-forward" size={16} color={colors.exampleInk} />
      <Text testID="follow-up-hint" style={styles.hintText}>
        {nextStep.role === 'focus' ? 'Berikutnya: satu pertanyaan singkat.' : 'Berikutnya: soal baru untuk latihan ulang.'}
      </Text>
    </View>
  );
}

type MarkerKind = 'idle' | 'off' | 'key' | 'miss' | 'chosen';

/** The marker column carries the state icon, so wrapped text never collides with it. */
function Marker({ kind }: { kind: MarkerKind }) {
  if (kind === 'key')
    return (
      <View style={[styles.marker, styles.markerKey]}>
        <Icon name="checkmark" size={15} color={colors.white} />
      </View>
    );
  if (kind === 'miss')
    return (
      <View style={[styles.marker, styles.markerMiss]}>
        <Icon name="close" size={15} color={colors.white} />
      </View>
    );
  if (kind === 'chosen')
    return (
      <View style={[styles.marker, styles.markerChosen]}>
        <View style={styles.markerDot} />
      </View>
    );
  return <View style={[styles.marker, styles.markerIdle, kind === 'off' && styles.markerOff]} />;
}

/**
 * Exactly four answer tiles, in the step's persisted order. Accessible labels carry only the option
 * text before grading; after the answer is saved, state is shown by marker icon, label and border
 * (never colour alone). A scheduled check marks only «Pilihan Anda»: no key, no verdict colour.
 */
function OptionTiles({
  item,
  step,
  feedback,
  disabled,
  scale,
  onChoose,
}: {
  item: Item;
  step: ItemStep;
  feedback: FeedbackView | null;
  disabled: boolean;
  scale: number;
  onChoose: (id: string) => void;
}) {
  const byId = new Map((item.options ?? []).map((o) => [o.id, o] as [string, ChoiceOption]));
  const ordered = step.option_order.map((id) => byId.get(id)).filter((o): o is ChoiceOption => !!o);
  const deferred = !!feedback?.deferred;
  return (
    <View
      style={styles.tiles}
      role="group"
      accessibilityLabel="Pilihan jawaban"
      accessibilityState={{ busy: disabled && !feedback }}
      aria-busy={disabled && !feedback}
      testID="answer-tiles"
    >
      {ordered.map((o, position) => {
        const isKey = !!feedback && !deferred && feedback.correct_option_id === o.id;
        const isPicked = !!feedback && feedback.selected_option_id === o.id;
        const after = feedback ? (isKey && isPicked ? 'Jawaban tepat. Pilihan Anda. ' : isKey ? 'Jawaban tepat. ' : isPicked ? 'Pilihan Anda. ' : '') : '';
        const marker: MarkerKind = isKey ? 'key' : isPicked ? (deferred ? 'chosen' : 'miss') : feedback ? 'off' : 'idle';
        const note = isKey && isPicked ? 'Jawaban tepat · Pilihan Anda' : isKey ? 'Jawaban tepat' : isPicked ? 'Pilihan Anda' : null;
        const noteInk = isKey ? colors.goodInk : deferred ? colors.accentInk : colors.missInk;
        return (
          <Pressable
            key={o.id}
            testID={`option-${o.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${after}Pilihan ${position + 1}: ${o.text}`}
            accessibilityLanguage={o.arabic ? 'ar' : undefined}
            accessibilityState={{ disabled, selected: isPicked }}
            disabled={disabled}
            onPress={() => onChoose(o.id)}
            style={({ pressed }) => [
              styles.tile,
              pressed && !disabled && styles.tilePressed,
              isKey && styles.tileKey,
              isPicked && !isKey && (deferred ? styles.tileChosen : styles.tileMiss),
            ]}
          >
            <Marker kind={marker} />
            <View style={[styles.tileBody, o.arabic && styles.tileBodyArabic]}>
              <Text
                lang={o.arabic ? 'ar' : undefined}
                style={[
                  styles.tileText,
                  (isKey || isPicked) && styles.tileTextStrong,
                  o.arabic && {
                    fontFamily: fonts.arabic,
                    fontSize: Math.round(30 * scale),
                    lineHeight: Math.round(54 * scale),
                    writingDirection: 'rtl',
                    textAlign: 'center',
                  },
                ]}
              >
                {o.text}
              </Text>
              {note ? <Text style={[styles.tileNote, { color: noteInk }]}>{note}</Text> : null}
            </View>
            {o.arabic ? <View style={styles.markerSpacer} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },

  bar: { backgroundColor: colors.ground, paddingTop: 6, paddingBottom: 6, paddingLeft: 6, paddingRight: 8 },
  barInner: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 56 },
  barProgress: { flex: 1, gap: 6, minWidth: 0 },
  barStacked: { paddingLeft: 14, paddingRight: 8 },
  barLabel: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },

  card: {
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 20,
    gap: 6,
    ...shadow,
  },
  prompt: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.text },
  target: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 27, color: colors.ink },

  tiles: { gap: 10 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.tileLine,
    backgroundColor: colors.sheet,
  },
  tilePressed: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  tileKey: { backgroundColor: colors.goodBg, borderColor: colors.goodBorder, borderWidth: 2 },
  tileMiss: { backgroundColor: colors.missBg, borderColor: colors.missBorder, borderWidth: 2 },
  tileChosen: { backgroundColor: colors.accentSoft, borderColor: colors.accent, borderWidth: 2 },
  tileBody: { flex: 1, gap: 1 },
  tileBodyArabic: { alignItems: 'center' },
  tileText: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  tileTextStrong: { fontFamily: fonts.semibold },
  tileNote: { fontFamily: fonts.extrabold, fontSize: 12, lineHeight: 16 },
  marker: { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  markerIdle: { borderWidth: 2, borderColor: colors.marker, width: 22, height: 22, marginHorizontal: 1 },
  markerOff: { borderColor: colors.markerOff },
  markerKey: { backgroundColor: colors.goodInk },
  markerMiss: { backgroundColor: colors.missInk },
  markerChosen: { borderWidth: 2, borderColor: colors.accent },
  markerDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
  markerSpacer: { width: 24 },

  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  quiet: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 },

  dockSurface: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...dockShadow,
  },
  dock: { gap: 10, flexShrink: 1 },
  dockScroll: { flexGrow: 0, flexShrink: 1 },
  dockContent: { gap: 10 },
  result: { gap: 8 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultTitle: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28 },
  feedbackText: { fontSize: 17, lineHeight: 27, color: colors.exampleInk },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.exampleInk, writingDirection: 'ltr', textAlign: 'left' },
});

export default function SessionScreen() {
  return (
    <HydrationGate write>
      <SessionScreenRoute />
    </HydrationGate>
  );
}
