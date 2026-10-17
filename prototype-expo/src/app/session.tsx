import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Item, Referent } from '@/content/schema';
import { SessionController, restoreSnapshot } from '@/engine/controller';
import type { Response } from '@/engine/scoring';
import { currentStep, findItem, startSession } from '@/engine/session';
import { newId } from '@/engine/util';
import { APP_VERSION, useApp } from '@/ui/AppContext';
import {
  ArabicText,
  Btn,
  Card,
  ConstructedLabel,
  Eyebrow,
  Field,
  HelpLines,
  Muted,
  Notice,
  P,
  Page,
  ProgressTrack,
  ReportButton,
  Segmented,
} from '@/ui/components';
import { LessonPanel } from '@/ui/LessonPanel';
import { colors, radius } from '@/ui/theme';

const OUTCOME_TITLE = {
  correct: 'Benar',
  wrong: 'Belum tepat',
  pending: 'Jawaban disimpan untuk diperiksa',
  dont_know: 'Tidak apa-apa',
} as const;

const OUTCOME_TONE = { correct: 'good', wrong: 'warn', pending: 'info', dont_know: 'info' } as const;
const OUTCOME_ICON = {
  correct: 'checkmark-circle',
  wrong: 'alert-circle',
  pending: 'time',
  dont_know: 'information-circle',
} as const;

export default function SessionScreen() {
  const { store, rules, content, learner } = useApp();
  const [ctrl, setCtrl] = useState<SessionController | null>(null);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const shownAt = useRef(0); // set when each step is shown (effect below)

  // Resume a saved session, or start a new one (saved before it is shown).
  useEffect(() => {
    if (!store || !learner || content.empty) return;
    let alive = true;
    (async () => {
      try {
        const history = await store.listAnswers();
        // Read the stored learner: the controller may have recorded seen screens since the context loaded.
        const current = (await store.getLearner()) ?? learner;
        let state = restoreSnapshot(await store.loadSnapshot(), content);
        if (!state || state.phase === 'done') {
          state = startSession({
            content,
            rules,
            history,
            learnerId: current.learner_id,
            now: Date.now(),
            budgetMinutes: current.session_minutes,
            screensSeen: current.screens_seen,
            appVersion: APP_VERSION,
          });
          await store.saveSnapshot(state);
        }
        if (alive) setCtrl(new SessionController({ store, content, rules, learner: current, history, state }));
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // Start once per mount; learner changes during a session are written by the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

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
  if (loadError) {
    return (
      <Page width="exercise">
        <Notice tone="danger">Sesi tidak dapat dibuka: {loadError}</Notice>
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
        <LessonPanel screen={screen} scale={learner.arabic_scale} eyebrow={`Unit A · Pelajaran ${screenIndex} dari ${screenCount}`} />
        {saveError}
        <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
      </Page>
    );
  }

  const item = findItem(content, step.item_id);
  const progress = `Soal ${itemIndex} dari ${itemCount}`;
  const header = (
    <View style={styles.head}>
      <Eyebrow>Unit A</Eyebrow>
      <Text style={styles.progressText}>{progress}</Text>
      <ProgressTrack value={state.phase === 'feedback' ? itemIndex : itemIndex - 1} max={itemCount} label={progress} />
    </View>
  );

  if (state.phase === 'feedback' && state.feedback) {
    const fb = state.feedback;
    const nextStep = state.queue[state.index + 1];
    const followUp = nextStep?.kind === 'item' && nextStep.role !== 'practice';
    return (
      <Page width="exercise">
        <Card tone="white" style={styles.card}>
          {header}
          <ArabicText scale={learner.arabic_scale} size={40}>
            {item.arabic}
          </ArabicText>
          <Card tone={OUTCOME_TONE[fb.outcome]} style={styles.result}>
            <View style={styles.resultHead}>
              <Ionicons name={OUTCOME_ICON[fb.outcome]} size={22} color={TONE_INK[OUTCOME_TONE[fb.outcome]]} />
              <Text accessibilityRole="header" style={[styles.resultTitle, { color: TONE_INK[OUTCOME_TONE[fb.outcome]] }]}>
                {OUTCOME_TITLE[fb.outcome]}
              </Text>
            </View>
            {fb.messages.map((m) => (
              <P key={m} testID="feedback-message">
                {m}
              </P>
            ))}
          </Card>
          {followUp ? (
            <Muted>
              {nextStep.role === 'focus' ? 'Berikutnya: satu pertanyaan singkat.' : 'Berikutnya: soal baru untuk latihan ulang.'}
            </Muted>
          ) : null}
          {saveError}
          <Btn testID="next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} />
        </Card>
      </Page>
    );
  }

  return (
    <ItemView
      key={stepKey}
      header={header}
      item={item}
      prompt={content.prompts[item.prompt_id]}
      scale={learner.arabic_scale}
      busy={busy}
      onSubmit={submit}
      saveError={saveError}
      onReport={async (reason, text) => {
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
  );
}

const TONE_INK = { good: colors.mintInk, warn: colors.clueInk, info: colors.infoInk } as const;

function ItemView({
  header,
  item,
  prompt,
  scale,
  busy,
  onSubmit,
  onReport,
  saveError,
}: {
  header: React.ReactNode;
  item: Item;
  prompt: string;
  scale: number;
  busy: boolean;
  onSubmit: (r: Response) => void;
  onReport: (reason: string, text: string) => Promise<void>;
  saveError: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [ref, setRef] = useState<Referent | null>(null);
  const isSentence = item.type === 'q-para' || item.type === 'q-form2' || item.pool === 'FOCUS';
  const arabicOptions = (item.options ?? []).some((o) => o.arabic);

  return (
    <Page width="exercise">
      <Card tone="white" style={styles.card}>
        {header}
        <View style={styles.stem}>
          <ArabicText scale={scale} size={44} testID="item-arabic">
            {item.arabic}
          </ArabicText>
          <HelpLines lines={item.help_lines} scale={scale} />
        </View>

        {item.type === 'q-para' ? (
          <View style={styles.block}>
            <Text style={styles.prompt}>Siapa yang dijelaskan: laki-laki atau perempuan?</Text>
            <Segmented
              testIDPrefix="ref-"
              value={ref}
              onChange={setRef}
              options={[
                { value: 'laki-laki', label: 'laki-laki' },
                { value: 'perempuan', label: 'perempuan' },
              ]}
            />
          </View>
        ) : null}

        <Text style={styles.prompt}>{prompt}</Text>

        {item.type === 'q-mean' || item.type === 'q-para' ? (
          <View style={styles.block}>
            <Field testID="answer-input" value={text} onChangeText={setText} placeholder="Tulis jawaban dalam bahasa Indonesia" />
            <Btn
              testID="check"
              label="Periksa"
              disabled={busy || !text.trim() || (item.type === 'q-para' && !ref)}
              onPress={() => onSubmit({ kind: 'typed', text, ...(item.type === 'q-para' && ref ? { ref } : {}) })}
            />
          </View>
        ) : (
          <View style={[styles.block, !arabicOptions && styles.optionRow]}>
            {(item.options ?? []).map((o) => (
              <View key={o.id} style={!arabicOptions ? { flex: 1 } : undefined}>
                <Btn
                  testID={`option-${o.id}`}
                  kind={arabicOptions ? 'tile' : 'secondary'}
                  arabic={o.arabic}
                  label={o.text}
                  disabled={busy}
                  onPress={() => onSubmit({ kind: 'choice', option_id: o.id })}
                />
              </View>
            ))}
          </View>
        )}

        {isSentence ? <ConstructedLabel /> : null}
        {saveError}
        <View style={styles.quiet}>
          {item.pool !== 'FOCUS' ? (
            <Btn testID="dont-know" kind="quiet" label="Saya belum tahu" disabled={busy} onPress={() => onSubmit({ kind: 'dont_know' })} />
          ) : null}
          <ReportButton onSubmit={onReport} />
        </View>
      </Card>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 14, borderRadius: radius.md },
  head: { gap: 6 },
  progressText: { fontSize: 18, fontWeight: '600', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  stem: { paddingVertical: 4, gap: 4 },
  block: { gap: 10 },
  optionRow: { flexDirection: 'row', gap: 10 },
  prompt: { fontSize: 17, lineHeight: 24, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  result: { gap: 8 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  quiet: { alignItems: 'center', gap: 0 },
});
