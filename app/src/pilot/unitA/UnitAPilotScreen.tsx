// Unit A pilot screen (initial slice) over the real pilot controller and the selected store. Everything shown
// comes from a view the controller made durable first; before a check nothing keyed or explanatory is rendered.
// One inner panel per binding (store identity, owner, mode, read-only): a changed binding unmounts the old
// panel in the same commit, so its question never flashes, and its controller is disposed with it.
// Needs no router or app context; the route owns Back, focus and the learner binding.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadScreenViews } from '@/engine/exposure';
import type { Store } from '@/storage/types';
import { moveFocus } from '@/ui/a11y';
import { ArabicText, Btn, Caption, Card, Eyebrow, MixedText, Notice, Page, type PageHandle } from '@/ui/components';
import { colors, radius, typography } from '@/ui/theme';
import {
  createPilotController,
  type PilotBlockReason,
  type PilotConstructSummary,
  type PilotExplainedChoice,
  type PilotMode,
  type PilotView,
} from './controller';

export interface UnitAPilotScreenProps {
  store: Store;
  /** Dataset-bound learner owner, e.g. "guest:<learner_id>". */
  owner: string;
  mode: PilotMode;
  /** Why the store may not write, or null. */
  readOnly: string | null;
  arabicScale: number;
  /** Local calendar day, YYYY-MM-DD. */
  today: () => string;
}

type PilotController = ReturnType<typeof createPilotController>;
type Failure = 'load' | 'save';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the learner saw teaching or answered legacy practice on `day` in the selected store. Conservative:
 * any same-day screen view or answer counts as assistance. Unreadable data rejects, never reads as "unexposed".
 */
export async function pilotAssistedOn(store: Store, day: string): Promise<boolean> {
  if (!DAY.test(day)) throw new Error('Pilot assistance check needs a local day (YYYY-MM-DD).');
  const views = await loadScreenViews(store);
  const answers: unknown = await store.listAnswers();
  if (!Array.isArray(answers)) throw new Error('Stored answers are unreadable; they were not modified.');
  let assisted = views.some((v) => v.local_date === day);
  for (const answer of answers) {
    const date: unknown = (answer as { local_date?: unknown } | null)?.local_date;
    if (typeof date !== 'string' || !DAY.test(date)) throw new Error('A stored answer has no readable local date.');
    if (date === day) assisted = true;
  }
  return assisted;
}

const storeIds = new WeakMap<object, number>();
let lastStoreId = 0;

function storeId(store: object): number {
  let id = storeIds.get(store);
  if (id === undefined) {
    lastStoreId += 1;
    id = lastStoreId;
    storeIds.set(store, id);
  }
  return id;
}

export function UnitAPilotScreen(props: UnitAPilotScreenProps) {
  const { store, owner, mode, readOnly } = props;
  if (mode !== 'developer-demo') return <Unavailable>Unit A uji coba hanya tersedia di mode pengembang.</Unavailable>;
  if (readOnly !== null) return <Unavailable>{`Penyimpanan sedang hanya-baca (${readOnly}). Unit A tidak dibuka di tab ini.`}</Unavailable>;
  return <PilotPanel key={JSON.stringify([storeId(store), owner, mode, readOnly])} {...props} />;
}

function Unavailable({ children }: { children: string }) {
  return (
    <Page width="exercise">
      <View style={styles.top}>
        <Eyebrow tone="accent">Unit A · uji coba</Eyebrow>
      </View>
      <Notice tone="info" testID="pilot-unavailable">
        {children}
      </Notice>
    </Page>
  );
}

const BLOCKED: Record<PilotBlockReason, string> = {
  disposed: 'Unit A ditutup.',
  inactive: 'Unit A sedang tidak aktif.',
  mode: 'Unit A uji coba hanya tersedia di mode pengembang.',
  'read-only': 'Penyimpanan sedang hanya-baca, jadi Unit A tidak dibuka.',
  content: 'Materi Unit A tidak lolos pemeriksaan otomatis, jadi tidak ditampilkan.',
  owner: 'Data Unit A tersimpan milik profil lain. Data itu tidak diubah.',
  today: 'Tanggal perangkat tidak terbaca. Silakan coba lagi.',
  schema: 'Data Unit A tersimpan memakai format lain. Data itu tidak diubah.',
  version: 'Data Unit A tersimpan berasal dari versi materi lain. Data itu tidak diubah.',
  'future-day': 'Tanggal perangkat lebih awal dari data Unit A tersimpan. Data itu tidak diubah.',
  corrupt: 'Data Unit A tersimpan tidak terbaca. Data itu tidak diubah.',
};
const RETRYABLE: readonly PilotBlockReason[] = ['today', 'future-day', 'inactive'];

const OUTCOME = {
  correct: { title: 'Benar', bg: colors.goodBg, line: colors.goodLine, ink: colors.goodInk },
  wrong: { title: 'Belum tepat', bg: colors.missBg, line: colors.missLine, ink: colors.missInk },
  'dont-know': { title: 'Tidak apa-apa', bg: colors.infoBg, line: colors.infoLine, ink: colors.infoInk },
} as const;

const CONSTRUCT_LABEL: Record<PilotConstructSummary['construct'], string> = {
  reference: 'Kata ganti: siapa yang dimaksud',
  agreement: 'Kesesuaian kata',
};

function viewKey(view: PilotView | null): string {
  if (view === null) return '';
  switch (view.kind) {
    case 'lesson':
      return `lesson:${view.lesson.id}`;
    case 'question':
    case 'feedback':
      return `${view.kind}:${view.presentationId}`;
    case 'blocked':
      return `blocked:${view.reason}`;
    default:
      return view.kind;
  }
}

function PilotPanel({ store, owner, mode, readOnly, arabicScale, today }: UnitAPilotScreenProps) {
  const [view, setView] = useState<PilotView | null>(null);
  const [choice, setChoice] = useState<{ presentationId: string; optionId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const ctrl = useRef<PilotController | null>(null);
  const epoch = useRef(0); // a disposed controller's late results are dropped
  const busyRef = useRef(false); // synchronous duplicate-press guard; the controller's own guard stays authoritative
  const todayRef = useRef(today);
  const page = useRef<PageHandle>(null);
  const heading = useRef<View>(null);
  const errorRegion = useRef<View>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const run = useCallback((action: (c: PilotController) => Promise<PilotView>, kind: Failure): Promise<void> => {
    const c = ctrl.current;
    if (c === null || busyRef.current) return Promise.resolve();
    busyRef.current = true;
    const ticket = ++epoch.current;
    setBusy(true);
    setFailure(null);
    const current = () => ticket === epoch.current && ctrl.current === c;
    return Promise.resolve()
      .then(() => action(c))
      .then(
        (next) => {
          if (!current()) return;
          busyRef.current = false;
          setView(next);
          setBusy(false);
        },
        () => {
          if (!current()) return;
          busyRef.current = false;
          setFailure(kind);
          setBusy(false);
        }
      );
  }, []);

  useEffect(() => {
    let live = true;
    const c = createPilotController({
      store,
      owner,
      mode,
      today: () => todayRef.current(),
      readOnly: () => readOnly !== null,
      active: () => live,
      assistedToday: (day?: string) => pilotAssistedOn(store, day ?? todayRef.current()),
      random: Math.random,
    });
    ctrl.current = c;
    busyRef.current = false;
    void run((x) => x.load(), 'load');
    // Back in the foreground (possibly on a new day): show where the learner is now.
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const resumed = next === 'active' && last !== 'active';
      last = next;
      if (resumed) void run((x) => x.load(), 'load');
    });
    return () => {
      live = false;
      c.dispose();
      sub.remove();
      if (ctrl.current === c) ctrl.current = null;
      epoch.current += 1;
      busyRef.current = false;
    };
  }, [store, owner, mode, readOnly, run]);

  const shown = viewKey(view);
  useLayoutEffect(() => {
    if (shown) page.current?.toTop();
  }, [shown]);
  useEffect(() => {
    if (shown) moveFocus(heading);
  }, [shown]);
  useEffect(() => {
    if (!failure) return;
    page.current?.reveal(errorRegion.current);
    moveFocus(errorRegion);
  }, [failure]);

  const question = view?.kind === 'question' ? view : null;
  const selected = question && choice?.presentationId === question.presentationId ? choice.optionId : null;

  const choose = (optionId: string) => {
    if (busyRef.current || question === null) return;
    setChoice({ presentationId: question.presentationId, optionId });
  };
  const answer = (optionId: string | null) => {
    if (question === null) return;
    const presentationId = question.presentationId;
    void run((c) => c.answer(presentationId, optionId), 'save');
  };
  const next = () => void run((c) => c.next(), 'save');
  const reload = () => void run((c) => c.load(), 'load');

  const errorNotice = failure ? (
    <View ref={errorRegion} tabIndex={-1} role="alert" accessibilityLiveRegion="assertive">
      <Notice
        tone="danger"
        testID="pilot-error"
        action={failure === 'load' ? <Btn kind="quiet" label="Coba lagi" testID="pilot-retry" disabled={busy} onPress={reload} /> : undefined}
      >
        {failure === 'save'
          ? 'Belum tersimpan. Pilihan Anda masih ada; silakan coba lagi.'
          : 'Unit A belum dapat dibuka. Data tersimpan tidak diubah.'}
      </Notice>
    </View>
  ) : null;

  let body: ReactNode = null;
  let footer: ReactNode = null;
  if (view === null || (view.kind === 'blocked' && (view.reason === 'disposed' || view.reason === 'inactive') && !failure)) {
    body = failure ? null : (
      <View style={styles.loading} testID="pilot-loading">
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat Unit A" />
      </View>
    );
  } else if (view.kind === 'blocked') {
    body = (
      <View style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.heading}>
            Unit A tidak dapat dibuka
          </Text>
        </View>
        <Notice tone="warn" testID="pilot-blocked">
          {BLOCKED[view.reason]}
        </Notice>
        {RETRYABLE.includes(view.reason) ? (
          <Btn kind="secondary" label="Muat ulang" testID="pilot-retry" disabled={busy} onPress={reload} style={styles.fullBtn} />
        ) : null}
      </View>
    );
  } else if (view.kind === 'lesson') {
    const { lesson } = view;
    body = (
      <View testID="pilot-lesson" style={styles.section}>
        <Eyebrow>Pelajaran</Eyebrow>
        <View ref={heading} tabIndex={-1}>
          <MixedText header scale={arabicScale} style={typography.title}>
            {lesson.title}
          </MixedText>
        </View>
        {lesson.body.map((paragraph, n) => (
          <MixedText key={n} scale={arabicScale}>
            {paragraph}
          </MixedText>
        ))}
        {lesson.examples.map((example, n) => (
          <Card key={n} style={styles.card}>
            <Caption>Contoh</Caption>
            <ArabicText scale={arabicScale} size={30} weight="medium">
              {example.arabic}
            </ArabicText>
            <Glosses glosses={example.glosses} scale={arabicScale} />
            <MixedText scale={arabicScale} style={styles.meaning}>
              {example.meaning}
            </MixedText>
            <MixedText scale={arabicScale}>{example.explanation}</MixedText>
          </Card>
        ))}
      </View>
    );
    // Footer controls are keyed by the view they act on: a press aimed at an earlier view's control can
    // never reach the next view's action through a reused host instance.
    footer = <Btn key={shown} testID="pilot-next" label="Mulai latihan" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else if (view.kind === 'question') {
    body = (
      <View testID="pilot-question" style={styles.section}>
        <Eyebrow>Latihan</Eyebrow>
        <View ref={heading} tabIndex={-1}>
          <MixedText header scale={arabicScale} style={typography.heading}>
            {view.prompt}
          </MixedText>
        </View>
        <Card style={styles.card}>
          <ArabicText scale={arabicScale} weight="medium">
            {view.arabic}
          </ArabicText>
          <Glosses glosses={view.glosses} scale={arabicScale} />
        </Card>
        <View accessibilityRole="radiogroup" accessibilityLabel="Pilihan jawaban" style={styles.options}>
          {view.options.map((option) => {
            const on = option.id === selected;
            return (
              <Pressable
                key={option.id}
                testID={`pilot-option-${option.id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, selected: on, disabled: busy }}
                aria-checked={on}
                disabled={busy}
                onPress={() => choose(option.id)}
                // Space selects as well as Enter (react-native-web only; native ignores onKeyDown).
                {...{
                  onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
                    const key = e.nativeEvent?.key ?? e.key;
                    if (key === ' ' || key === 'Spacebar') {
                      e.preventDefault?.();
                      choose(option.id);
                    }
                  },
                }}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && !busy && styles.optionPressed]}
              >
                <View style={[styles.marker, on && styles.markerOn]} />
                <View style={styles.optionBody}>
                  <MixedText scale={arabicScale} style={typography.option}>
                    {option.text}
                  </MixedText>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Btn kind="quiet" label="Belum tahu" testID="pilot-dont-know" disabled={busy} onPress={() => answer(null)} style={styles.fullBtn} />
        <Caption>Pilihan bisa diganti sampai Anda menekan Periksa. Jawaban yang diperiksa disimpan dan tidak diubah.</Caption>
      </View>
    );
    footer = (
      <Btn
        key={shown}
        testID="pilot-check"
        label="Periksa"
        disabled={busy || selected === null}
        onPress={() => {
          if (selected !== null) answer(selected);
        }}
        style={styles.fullBtn}
      />
    );
  } else if (view.kind === 'feedback') {
    const tone = OUTCOME[view.outcome];
    body = (
      <View testID="pilot-feedback" role="status" accessibilityLiveRegion="polite" style={[styles.feedback, { backgroundColor: tone.bg, borderColor: tone.line }]}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={[typography.heading, { color: tone.ink }]}>
            {tone.title}
          </Text>
        </View>
        <Caption>Jawaban pertama Anda sudah tersimpan di perangkat ini.</Caption>
        {view.selected ? (
          <Explained label="Pilihan Anda" choice={view.selected} scale={arabicScale} />
        ) : (
          <MixedText scale={arabicScale}>Anda memilih «Belum tahu».</MixedText>
        )}
        {view.outcome === 'correct' ? null : <Explained label="Jawaban yang tepat" choice={view.keyed} scale={arabicScale} />}
      </View>
    );
    footer = <Btn key={shown} testID="pilot-next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else {
    const awaiting = view.kind === 'awaiting-transfer';
    body = (
      <View testID="pilot-summary" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.title}>
            {awaiting ? 'Latihan Unit A selesai' : 'Semua soal latihan sudah dijawab'}
          </Text>
        </View>
        <Text style={typography.body}>
          {awaiting
            ? 'Anda sudah menjawab semua soal latihan Unit A versi ini.'
            : 'Beberapa bagian belum cukup jawaban benar. Latihan ulang belum tersedia di versi ini.'}
        </Text>
        <Card style={styles.card}>
          {view.constructs.map((c) => (
            <Text key={c.construct} style={typography.body}>
              {`${CONSTRUCT_LABEL[c.construct]}: benar pada ${c.correctFamilies} jenis soal (target latihan ${c.required})`}
            </Text>
          ))}
        </Card>
        <Notice tone="info">Soal penerapan baru serta cek hari ke-7 dan ke-30 belum tersedia. Ini ringkasan latihan sementara, bukan penilaian akhir.</Notice>
      </View>
    );
  }

  return (
    <Page width="exercise" ref={page} footer={footer}>
      <View style={styles.top}>
        <Eyebrow tone="accent">Unit A · uji coba</Eyebrow>
        <Caption>Draf belum ditinjau · progres hanya tersimpan di perangkat ini</Caption>
      </View>
      {body}
      {errorNotice}
    </Page>
  );
}

function Glosses({ glosses, scale }: { glosses: readonly { arabic: string; meaning: string }[]; scale: number }) {
  if (glosses.length === 0) return null;
  return (
    <View style={styles.glosses}>
      <Caption>Arti kata</Caption>
      {glosses.map((g, n) => (
        <MixedText key={n} scale={scale}>
          {`${g.arabic} = ${g.meaning}`}
        </MixedText>
      ))}
    </View>
  );
}

function Explained({ label, choice, scale }: { label: string; choice: PilotExplainedChoice; scale: number }) {
  return (
    <View style={styles.explained}>
      <Caption>{label}</Caption>
      <MixedText scale={scale} style={typography.option}>
        {choice.text}
      </MixedText>
      <MixedText scale={scale}>{choice.explanation}</MixedText>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { gap: 2, marginBottom: 12 },
  section: { gap: 14 },
  loading: { paddingVertical: 48, alignItems: 'center' },
  card: { gap: 10 },
  meaning: { fontFamily: typography.label.fontFamily, color: colors.ink },
  glosses: { gap: 4 },
  options: { gap: 10, alignSelf: 'stretch' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.tileLine,
    backgroundColor: colors.sheet,
    alignSelf: 'stretch',
  },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionPressed: { backgroundColor: colors.sheet2 },
  optionBody: { flex: 1, minWidth: 0 },
  marker: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.marker },
  markerOn: { borderColor: colors.accent, borderWidth: 6 },
  fullBtn: { alignSelf: 'stretch', minHeight: 52 },
  feedback: { gap: 12, padding: 16, borderRadius: radius.card, borderWidth: 1 },
  explained: { gap: 4 },
});
