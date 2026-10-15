import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChoiceOption, Item } from '@/content/schema';
import { prepareSession, SessionController } from '@/engine/controller';
import type { Response } from '@/engine/scoring';
import { currentStep, findItem, type FeedbackView, type ItemStep } from '@/engine/session';
import { newId } from '@/engine/util';
import { APP_VERSION, useApp } from '@/ui/AppContext';
import {
  ARABIC_FONT,
  ArabicText,
  Btn,
  Card,
  ConstructedLabel,
  Eyebrow,
  H1,
  HelpLines,
  Muted,
  Notice,
  P,
  Page,
  ProgressTrack,
  ReportButton,
} from '@/ui/components';
import { LessonPanel } from '@/ui/LessonPanel';
import { MigrationNotice } from '@/ui/notices';
import { colors, radius } from '@/ui/theme';
import { HydrationGate } from '@/ui/Hydration';

const OUTCOME_TITLE = {
  correct: 'Benar',
  wrong: 'Belum tepat',
  pending: 'Jawaban disimpan untuk diperiksa',
  dont_know: 'Tidak apa-apa',
} as const;
const OUTCOME_TONE = { correct: 'good', wrong: 'warn', pending: 'info', dont_know: 'info' } as const;
const OUTCOME_ICON = { correct: 'checkmark-circle', wrong: 'alert-circle', pending: 'time', dont_know: 'information-circle' } as const;
const TONE_INK = { good: colors.mintInk, warn: colors.clueInk, info: colors.infoInk } as const;
const ROLE_LABEL: Record<string, string> = { review: 'Ulasan', check: 'Cek ulang', remed: 'Latihan ulang', focus: 'Pertanyaan singkat' };

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; ctrl: SessionController }
  | { kind: 'nothing-due' }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string };

function SessionScreenRoute() {
  const { store, rules, content, learner } = useApp();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0); // set when each step is shown (effect below)

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
  useEffect(() => {
    shownAt.current = Date.now();
  }, [stepKey]);

  useEffect(() => {
    if (state?.phase === 'done') router.replace('/summary');
  }, [state?.phase]);

  if (!learner) return <Redirect href="/" />;
  if (content.empty) return <Redirect href="/" />;
  if (load.kind === 'error' || load.kind === 'refused') {
    return (
      <Page width="exercise">
        <Notice tone="danger" testID="session-refused">
          Sesi tidak dapat dibuka: {load.kind === 'error' ? load.message : load.reason} Data tersimpan tidak diubah.
        </Notice>
      </Page>
    );
  }
  if (load.kind === 'nothing-due') {
    return (
      <Page width="exercise">
        <MigrationNotice />
        <H1>Tidak ada latihan saat ini</H1>
        <P testID="nothing-due">Semua latihan yang tersedia sudah dikerjakan, dan belum ada ulasan yang jatuh tempo.</P>
        <Btn label="Lihat kemajuan" onPress={() => router.replace('/summary')} />
      </Page>
    );
  }
  if (!ctrl || !state) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.indigo} accessibilityLabel="Memuat sesi" />
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
    <Notice tone="danger" testID="save-error">
      Belum tersimpan. Periksa penyimpanan perangkat lalu coba lagi.
    </Notice>
  ) : null;

  const itemCount = state.queue.filter((q) => q.kind === 'item').length;
  const itemIndex = state.queue.slice(0, state.index + 1).filter((q) => q.kind === 'item').length;
  const screenCount = state.queue.filter((q) => q.kind === 'screen').length;
  const screenIndex = state.queue.slice(0, state.index + 1).filter((q) => q.kind === 'screen').length;

  if (!step) return null;

  if (step.kind === 'screen') {
    const screen = content.screens.find((s) => s.screen_id === step.screen_id)!;
    return (
      <Page width="exercise">
        <MigrationNotice />
        <LessonPanel screen={screen} scale={learner.arabic_scale} eyebrow={`Unit ${screen.unit} · Pelajaran ${screenIndex} dari ${screenCount}`} />
        {saveError}
        <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
      </Page>
    );
  }

  const item = findItem(content, step.item_id);
  const progress = `Soal ${itemIndex} dari ${itemCount}`;
  const header = (
    <View style={styles.head}>
      <Eyebrow>{`Unit ${item.unit}${ROLE_LABEL[step.role] ? ` · ${ROLE_LABEL[step.role]}` : ''}`}</Eyebrow>
      <Text style={styles.progressText}>{progress}</Text>
      <ProgressTrack value={state.phase === 'feedback' ? itemIndex : itemIndex - 1} max={itemCount} label={progress} />
    </View>
  );
  const feedback = state.phase === 'feedback' && state.feedback?.item_id === item.item_id ? state.feedback : null;

  return (
    <Page width="exercise">
      <MigrationNotice />
      <Card tone="white" style={styles.card}>
        {header}
        <Question item={item} prompt={content.prompts[item.prompt_id]} scale={learner.arabic_scale} />
        <OptionTiles
          key={stepKey}
          item={item}
          step={step}
          feedback={feedback}
          disabled={busy || !!feedback}
          scale={learner.arabic_scale}
          onChoose={(id) => submit({ kind: 'choice', option_id: id })}
        />
        {feedback ? (
          <>
            <Card tone={OUTCOME_TONE[feedback.outcome]} style={styles.result}>
              <View style={styles.resultHead}>
                <Ionicons name={OUTCOME_ICON[feedback.outcome]} size={22} color={TONE_INK[OUTCOME_TONE[feedback.outcome]]} />
                <Text accessibilityRole="header" style={[styles.resultTitle, { color: TONE_INK[OUTCOME_TONE[feedback.outcome]] }]}>
                  {OUTCOME_TITLE[feedback.outcome]}
                </Text>
              </View>
              {feedback.messages.map((m) => (
                <P key={m} testID="feedback-message">
                  {m}
                </P>
              ))}
            </Card>
            <FollowUpHint state={state} />
            {saveError}
            <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
          </>
        ) : (
          <>
            {item.format !== 'word-meaning' ? <ConstructedLabel /> : null}
            {saveError}
            <View style={styles.quiet}>
              {item.pool !== 'FOCUS' ? (
                <Btn testID="dont-know" kind="quiet" label="Saya belum tahu" disabled={busy} onPress={() => submit({ kind: 'dont_know' })} />
              ) : null}
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
      </Card>
    </Page>
  );
}

function FollowUpHint({ state }: { state: NonNullable<SessionController['state']> }) {
  const nextStep = state.queue[state.index + 1];
  if (!nextStep || nextStep.kind !== 'item' || (nextStep.role !== 'focus' && nextStep.role !== 'remed')) return null;
  return <Muted>{nextStep.role === 'focus' ? 'Berikutnya: satu pertanyaan singkat.' : 'Berikutnya: soal baru untuk latihan ulang.'}</Muted>;
}

function Question({ item, prompt, scale }: { item: Item; prompt: string; scale: number }) {
  return (
    <View style={styles.stem}>
      {item.arabic ? (
        <ArabicText scale={scale} size={44} testID="item-arabic">
          {item.arabic}
        </ArabicText>
      ) : null}
      <HelpLines lines={item.help_lines} scale={scale} />
      <Text style={styles.prompt} testID="item-prompt">
        {prompt}
      </Text>
      {item.target ? (
        <Text style={styles.target} testID="item-target">
          «{item.target}»
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Exactly four answer tiles, in the step's persisted order. Accessible labels carry only the
 * option text before grading; correctness is announced only after the answer is saved.
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
  return (
    <View style={styles.tiles} accessibilityRole="radiogroup" testID="answer-tiles">
      {ordered.map((o, position) => {
        const isKey = !!feedback && feedback.correct_option_id === o.id;
        const isPicked = !!feedback && feedback.selected_option_id === o.id;
        const after = feedback ? (isKey ? 'Jawaban tepat. ' : isPicked ? 'Pilihan Anda. ' : '') : '';
        return (
          <Pressable
            key={o.id}
            testID={`option-${o.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${after}Pilihan ${position + 1}: ${o.text}`}
            accessibilityState={{ disabled, selected: isPicked }}
            disabled={disabled}
            onPress={() => onChoose(o.id)}
            style={({ pressed }) => [
              styles.tile,
              pressed && !disabled && styles.tilePressed,
              isKey && styles.tileKey,
              isPicked && !isKey && styles.tileWrong,
            ]}
          >
            {feedback && (isKey || isPicked) ? (
              <Ionicons
                name={isKey ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={isKey ? colors.mintInk : colors.dangerInk}
                style={styles.tileIcon}
              />
            ) : null}
            <Text
              style={[
                styles.tileText,
                o.arabic && { fontFamily: ARABIC_FONT, fontSize: Math.round(30 * scale), lineHeight: Math.round(54 * scale), writingDirection: 'rtl' },
              ]}
            >
              {o.text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 14, borderRadius: radius.md },
  head: { gap: 6 },
  progressText: { fontSize: 18, fontWeight: '600', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  stem: { paddingVertical: 4, gap: 6 },
  prompt: { fontSize: 17, lineHeight: 24, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  target: { fontSize: 18, lineHeight: 26, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  tiles: { gap: 10 },
  tile: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  tilePressed: { backgroundColor: colors.indigoSoft, borderColor: colors.indigo },
  tileKey: { backgroundColor: colors.mintBg, borderColor: colors.mintBorder, borderWidth: 2 },
  tileWrong: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, borderWidth: 2 },
  tileIcon: { position: 'absolute', left: 12 },
  tileText: { fontSize: 17, lineHeight: 24, color: colors.ink, textAlign: 'center', flexShrink: 1 },
  result: { gap: 8 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  quiet: { alignItems: 'center', gap: 0 },
});

export default function SessionScreen() {
  return (
    <HydrationGate>
      <SessionScreenRoute />
    </HydrationGate>
  );
}
