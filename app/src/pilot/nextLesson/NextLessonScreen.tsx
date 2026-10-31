// Next lesson (U-C nominal definiteness) pilot screen over the next lesson controller and the selected store.
// Everything shown comes from a view the controller made durable first; before a check nothing keyed or explanatory
// is rendered, and transfer answers show only that they were saved until the fourth closes the block.
// One inner panel per binding (store identity, owner, mode, read-only): a changed binding unmounts the old panel in
// the same commit, so its content never flashes. The outer binding is updated in that commit's layout phase, before
// the old panel's passive cleanup and any queued continuation run, so its pause sees a changed account, mode or
// store and records nothing.
// Back only pauses (records today for teaching or practice still on display) and leaves; it never loads, advances
// or answers, so leaving on a newly eligible day never presents a reserved task.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { pilotAssistedOn } from '@/pilot/unitA/UnitAPilotScreen';
import type { Store } from '@/storage/types';
import { moveFocus } from '@/ui/a11y';
import {
  ArabicText,
  Btn,
  Caption,
  Card,
  Eyebrow,
  HelpLines,
  IconButton,
  MixedText,
  Notice,
  Page,
  type PageHandle,
} from '@/ui/components';
import { colors, radius, typography } from '@/ui/theme';
import {
  createNextLessonController,
  type NextLessonController,
  type NextLessonExplainedChoice,
  type NextLessonView,
} from './controller';

export interface NextLessonScreenProps {
  store: Store;
  /** Dataset-bound learner owner, e.g. "guest:<learner_id>". */
  owner: string;
  mode: 'developer-demo' | 'tester';
  /** Why the store may not write, or null. */
  readOnly: string | null;
  arabicScale: number;
  /** Local calendar day, YYYY-MM-DD. */
  today: () => string;
  /** Leaves the screen; never answers or advances anything. */
  onBack: () => void;
  /** Whether the route still has this consented learner selected on this store; read at every operation. */
  consented?: (owner: string, store: Store) => boolean;
}

type Binding = RefObject<NextLessonScreenProps>;
type Failure = 'load' | 'save' | 'back';

/** The mounted panel's controller and its tracked pause; null once the panel is unmounted. */
interface Live {
  controller: NextLessonController;
  pause: () => Promise<void>;
  active: () => boolean;
}

/** Day poll while mounted and in the foreground, so a visible lesson crossing midnight is recorded on the new day. */
const DAY_POLL_MS = 30_000;

const noop = () => undefined;

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

export function NextLessonScreen(props: NextLessonScreenProps) {
  const binding = useRef(props);
  // Updated as each binding commits (layout phase, before passive effects and queued continuations): an old
  // panel's guards read the selected binding, never a cached copy.
  useLayoutEffect(() => {
    binding.current = props;
  }, [props]);
  const { store, owner, mode, readOnly, onBack } = props;
  if (mode !== 'developer-demo') {
    return <Unavailable onBack={onBack}>Pelajaran berikutnya hanya tersedia di mode pengembang.</Unavailable>;
  }
  if (readOnly !== null) {
    return <Unavailable onBack={onBack}>{`Penyimpanan sedang hanya-baca (${readOnly}). Pelajaran ini tidak dibuka di tab ini.`}</Unavailable>;
  }
  return <LessonPanel key={JSON.stringify([storeId(store), owner, mode, readOnly])} {...props} binding={binding} />;
}

function BackBar({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.bar}>
      <IconButton icon="arrow-back" label="Kembali ke Unit A" testID="next-lesson-home" onPress={onPress} />
    </View>
  );
}

function Top() {
  return (
    <View style={styles.top}>
      <Eyebrow tone="accent">Pelajaran berikutnya · uji coba</Eyebrow>
      <Caption>Draf belum ditinjau</Caption>
    </View>
  );
}

function Unavailable({ children, onBack }: { children: string; onBack: () => void }) {
  return (
    <Page width="exercise" header={<BackBar onPress={onBack} />}>
      <Top />
      <Notice tone="info" testID="next-lesson-unavailable">
        {children}
      </Notice>
    </Page>
  );
}

const BLOCKED: Record<string, string> = {
  'not-qualified': 'Pelajaran ini hanya terbuka setelah cek awal Unit A Anda memenuhi target. Tidak ada data yang diubah.',
  disposed: 'Pelajaran ini ditutup.',
  inactive: 'Pelajaran ini sedang tidak aktif.',
  consent: 'Profil yang dipilih sudah berganti. Silakan buka lagi dari Unit A.',
  mode: 'Pelajaran berikutnya hanya tersedia di mode pengembang.',
  'read-only': 'Penyimpanan sedang hanya-baca, jadi pelajaran ini tidak dibuka.',
  content: 'Materi pelajaran ini tidak lolos pemeriksaan otomatis, jadi tidak ditampilkan.',
  storage: 'Penyimpanan ini tidak dapat menyimpan progres pelajaran ini.',
  owner: 'Data pelajaran ini tersimpan milik profil lain. Data itu tidak diubah.',
  today: 'Tanggal perangkat tidak terbaca. Silakan coba lagi.',
  schema: 'Data pelajaran ini tersimpan memakai format lain. Data itu tidak diubah.',
  version: 'Data pelajaran ini tersimpan berasal dari versi materi lain. Data itu tidak diubah.',
  'future-day': 'Tanggal perangkat lebih awal dari data pelajaran ini yang tersimpan. Data itu tidak diubah.',
  corrupt: 'Data pelajaran ini tersimpan tidak terbaca. Data itu tidak diubah.',
  stale: 'Tampilan ini sudah tidak sesuai dengan data tersimpan. Silakan muat ulang.',
  answered: 'Soal ini sudah dijawab; jawaban pertama tidak diganti. Silakan muat ulang.',
  'invalid-answer': 'Jawaban ini tidak dapat disimpan. Silakan muat ulang.',
  'invalid-option': 'Pilihan ini tidak ada pada soal yang tampil. Silakan muat ulang.',
};
const BLOCKED_FALLBACK = 'Pelajaran ini tidak dapat dibuka. Data tersimpan tidak diubah.';
const RETRYABLE: readonly string[] = ['today', 'future-day', 'inactive', 'stale', 'answered', 'invalid-answer', 'invalid-option'];

const OUTCOME = {
  correct: { title: 'Benar', bg: colors.goodBg, line: colors.goodLine, ink: colors.goodInk },
  wrong: { title: 'Belum tepat', bg: colors.missBg, line: colors.missLine, ink: colors.missInk },
  'dont-know': { title: 'Tidak apa-apa', bg: colors.infoBg, line: colors.infoLine, ink: colors.infoInk },
} as const;

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** A stored YYYY-MM-DD day as "9 Januari 2026"; anything else is shown as stored. */
function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : day;
}

function viewKey(view: NextLessonView | null): string {
  if (view === null) return '';
  switch (view.kind) {
    case 'screen':
      return `screen:${view.screen.screen_id}`;
    case 'question':
    case 'feedback':
    case 'assessment-feedback':
      return `${view.kind}:${view.presentationId}`;
    case 'awaiting-transfer':
      return `${view.kind}:${view.until}`;
    case 'blocked':
      return `blocked:${view.reason}`;
    default:
      return view.kind;
  }
}

function LessonPanel({ store, owner, mode, readOnly, arabicScale, binding }: NextLessonScreenProps & { binding: Binding }) {
  const [view, setView] = useState<NextLessonView | null>(null);
  const [choice, setChoice] = useState<{ presentationId: string; optionId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const live = useRef<Live | null>(null);
  const epoch = useRef(0); // a disposed controller's, hidden view's or superseded action's late results are dropped
  const busyRef = useRef(false); // synchronous duplicate-press guard; the controller's own guard stays authoritative
  const leaving = useRef(false); // one Back at a time
  const viewRef = useRef<NextLessonView | null>(null);
  const dayRef = useRef<string | null>(null); // the day the view on display was made durable
  const page = useRef<PageHandle>(null);
  const heading = useRef<ViewInstance>(null);
  const errorRegion = useRef<ViewInstance>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const readDay = useCallback((): string | null => {
    try {
      const day: unknown = binding.current.today();
      return typeof day === 'string' ? day : null;
    } catch {
      return null;
    }
  }, [binding]);

  /** `hide` drops what is shown until the fresh durable view arrives (load, refocus, foreground, new day). */
  const run = useCallback(
    (action: (c: NextLessonController) => Promise<NextLessonView>, kind: Failure, hide = false): Promise<void> => {
      const panel = live.current;
      if (panel === null || busyRef.current) return Promise.resolve();
      const c = panel.controller;
      busyRef.current = true;
      const ticket = ++epoch.current;
      const day = readDay();
      setBusy(true);
      setFailure(null);
      if (hide) setView(null);
      const current = () => ticket === epoch.current && live.current?.controller === c;
      return Promise.resolve()
        .then(() => action(c))
        .then(
          (next) => {
            if (!current()) return;
            busyRef.current = false;
            dayRef.current = day;
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
    },
    [readDay]
  );

  useEffect(() => {
    let mounted = true;
    // Only an app actually reported active counts: a background, inactive or not yet reported state at mount waits
    // for the change to active before anything is read, reserved or shown.
    let foreground = AppState.currentState === 'active';
    const active = () => mounted && foreground;
    // This panel's binding is still the selected one (and the route still has its consented learner).
    const consented = () => {
      const b = binding.current;
      return (
        b.store === store &&
        b.owner === owner &&
        b.mode === mode &&
        b.readOnly === readOnly &&
        (b.consented === undefined || b.consented(owner, store) === true)
      );
    };
    const c = createNextLessonController({
      get store() {
        return binding.current.store;
      },
      get owner() {
        return binding.current.owner;
      },
      get mode() {
        return binding.current.mode;
      },
      today: () => binding.current.today(),
      readOnly: () => binding.current.readOnly !== null,
      active,
      consented,
      assistedToday: (day) => pilotAssistedOn(store, day, owner),
      random: Math.random,
    });

    // Every requested pause is kept until it settles, so disposing never discards a help day still being written.
    const pauses = new Set<Promise<void>>();
    const pause = (): Promise<void> => {
      let pending: Promise<void>;
      try {
        pending = c.pause();
      } catch (error) {
        pending = Promise.reject(error);
      }
      pauses.add(pending);
      const drop = () => {
        pauses.delete(pending);
      };
      pending.then(drop, drop);
      return pending;
    };
    // Only content still on screen is flushed; a hidden or failed view records nothing.
    const flush = (): Promise<void> => (viewRef.current !== null ? pause() : Promise.resolve());
    live.current = { controller: c, pause: flush, active };
    busyRef.current = false;
    dayRef.current = null;
    // The first load starts one microtask later, only if the app is active and this panel and controller are still
    // the mounted ones; the view starts hidden (null), so nothing shows until the fresh durable view arrives.
    if (foreground) {
      void Promise.resolve().then(() => {
        if (active() && live.current?.controller === c) void run((x) => x.load(), 'load', true);
      });
    }

    const hide = () => {
      epoch.current += 1;
      busyRef.current = false;
      setBusy(false);
      setFailure(null);
      setView(null);
    };

    // Any state other than active hides: what an active panel had on display is recorded while still active, then
    // hidden. The change to active loads fresh.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (foreground) return;
        foreground = true;
        void run((x) => x.load(), 'load', true);
        return;
      }
      if (foreground) void flush().catch(noop);
      foreground = false;
      hide();
    });

    // A new day under visible teaching or practice: record it, then show the same place again from the store.
    // Awaiting keeps its notice; loading there could present a reserved task nobody asked for.
    const poll = setInterval(() => {
      if (!active() || busyRef.current) return;
      const shown = viewRef.current;
      const day = readDay();
      if (shown === null || day === null || dayRef.current === null || day === dayRef.current) return;
      if (shown.kind === 'awaiting-transfer' || shown.kind === 'blocked') {
        dayRef.current = day;
        return;
      }
      const flushed = pause();
      void run(async (x) => {
        await flushed;
        return x.load();
      }, 'load', true);
    }, DAY_POLL_MS);

    return () => {
      // Requested while still active, so a blur or history Back records what was on display; it may finish later.
      void flush().catch(noop);
      mounted = false;
      clearInterval(poll);
      sub.remove();
      if (live.current?.controller === c) live.current = null;
      epoch.current += 1;
      busyRef.current = false;
      void Promise.all([...pauses].map((p) => p.then(noop, noop))).then(() => c.dispose());
    };
  }, [store, owner, mode, readOnly, run, readDay, binding]);

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
  const reload = () => void run((c) => c.load(), 'load', true);

  // Pause, then leave; a pause that could not be saved keeps the learner here with a retry.
  const back = () => {
    const panel = live.current;
    if (panel === null || leaving.current) return;
    leaving.current = true;
    setFailure(null);
    const flushed = panel.active() ? panel.pause() : Promise.resolve();
    flushed.then(
      () => {
        leaving.current = false;
        if (live.current === panel) binding.current.onBack();
      },
      () => {
        leaving.current = false;
        if (live.current === panel) setFailure('back');
      }
    );
  };

  const errorNotice = failure ? (
    <View ref={errorRegion} tabIndex={-1} role="alert" accessibilityLiveRegion="assertive">
      <Notice
        tone="danger"
        testID="next-lesson-error"
        action={
          failure === 'save' ? undefined : (
            <Btn kind="quiet" label="Coba lagi" testID="next-lesson-retry" disabled={busy} onPress={failure === 'load' ? reload : back} />
          )
        }
      >
        {failure === 'save'
          ? 'Belum tersimpan. Pilihan Anda masih ada; silakan coba lagi.'
          : failure === 'back'
            ? 'Belum tersimpan, jadi pelajaran ini belum ditutup. Silakan coba lagi.'
            : 'Pelajaran ini belum dapat dibuka. Data tersimpan tidak diubah.'}
      </Notice>
    </View>
  ) : null;

  let body: ReactNode = null;
  let footer: ReactNode = null;
  if (view === null || (view.kind === 'blocked' && (view.reason === 'disposed' || view.reason === 'inactive') && !failure)) {
    body = failure ? null : (
      <View style={styles.loading} testID="next-lesson-loading">
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat pelajaran berikutnya" />
      </View>
    );
  } else if (view.kind === 'blocked') {
    body = (
      <View style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.heading}>
            Pelajaran berikutnya tidak dapat dibuka
          </Text>
        </View>
        <Notice tone="warn" testID="next-lesson-blocked">
          {BLOCKED[view.reason] ?? BLOCKED_FALLBACK}
        </Notice>
        {RETRYABLE.includes(view.reason) ? (
          <Btn kind="secondary" label="Muat ulang" testID="next-lesson-retry" disabled={busy} onPress={reload} style={styles.fullBtn} />
        ) : null}
      </View>
    );
  } else if (view.kind === 'screen') {
    const { screen } = view;
    body = (
      <View testID="next-lesson-screen" style={styles.section}>
        <Eyebrow>Pelajaran</Eyebrow>
        <View ref={heading} tabIndex={-1}>
          <MixedText header scale={arabicScale} style={typography.title}>
            {screen.title}
          </MixedText>
        </View>
        {screen.body.map((paragraph, n) => (
          <MixedText key={n} scale={arabicScale}>
            {paragraph}
          </MixedText>
        ))}
        {screen.examples.map((example, n) => (
          <Card key={n} style={styles.card}>
            <Caption>Contoh</Caption>
            <ArabicText scale={arabicScale} size={30} weight="medium">
              {example.arabic}
            </ArabicText>
            <HelpLines lines={[...example.help_lines]} scale={arabicScale} />
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
    footer = <Btn key={shown} testID="next-lesson-next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else if (view.kind === 'question') {
    const held = view.phase !== 'practice';
    const submit = held ? 'Simpan jawaban' : 'Periksa';
    body = (
      <View testID="next-lesson-question" style={styles.section}>
        <Eyebrow>{held ? 'Cek pemahaman' : 'Latihan'}</Eyebrow>
        <View ref={heading} tabIndex={-1}>
          <MixedText header scale={arabicScale} style={typography.heading}>
            {view.prompt}
          </MixedText>
        </View>
        <Card style={styles.card}>
          {view.format === 'arabic-to-meaning' ? (
            <ArabicText scale={arabicScale} weight="medium">
              {view.stem}
            </ArabicText>
          ) : (
            <MixedText scale={arabicScale} style={typography.option}>
              {view.stem}
            </MixedText>
          )}
          {held ? null : <HelpLines lines={[...view.help_lines]} scale={arabicScale} />}
        </Card>
        <View accessibilityRole="radiogroup" accessibilityLabel="Pilihan jawaban" style={styles.options}>
          {view.options.map((option) => {
            const on = option.id === selected;
            return (
              <Pressable
                key={option.id}
                testID={`next-lesson-option-${option.id}`}
                accessibilityRole="radio"
                accessibilityLabel={option.text}
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
        <Btn kind="quiet" label="Belum tahu" testID="next-lesson-dont-know" disabled={busy} onPress={() => answer(null)} style={styles.fullBtn} />
        <Caption>
          {held
            ? 'Jawaban dikunci saat disimpan. Hasil muncul setelah 4 soal.'
            : 'Jawaban dikunci setelah diperiksa.'}
        </Caption>
      </View>
    );
    footer = (
      <Btn
        key={shown}
        testID="next-lesson-check"
        label={submit}
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
      <View testID="next-lesson-feedback" role="status" accessibilityLiveRegion="polite" style={[styles.feedback, { backgroundColor: tone.bg, borderColor: tone.line }]}>
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
    footer = <Btn key={shown} testID="next-lesson-next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else if (view.kind === 'assessment-feedback') {
    body = (
      <View testID="next-lesson-assessment-feedback" role="status" accessibilityLiveRegion="polite" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.heading}>
            Jawaban tersimpan
          </Text>
        </View>
        <Caption>Hasilnya ditampilkan setelah keempat soal cek ini dijawab.</Caption>
      </View>
    );
    footer = <Btn key={shown} testID="next-lesson-next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else if (view.kind === 'awaiting-transfer') {
    body = (
      <View testID="next-lesson-awaiting" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.title}>
            Latihan selesai
          </Text>
        </View>
        <Text style={typography.body}>Anda sudah menjawab semua soal latihan pelajaran ini.</Text>
        <Text style={typography.body}>
          {`Soal cek pemahaman dibuka pada hari lain tanpa pelajaran, latihan, atau bantuan lain yang tercatat di aplikasi ini. Silakan kembali paling cepat ${dayLabel(view.until)}.`}
        </Text>
      </View>
    );
  } else if (view.kind === 'closed') {
    const { answered, correct, valid } = view.counts;
    body = (
      <View testID="next-lesson-closed" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.title}>
            Cek pemahaman selesai
          </Text>
        </View>
        <Card style={styles.card}>
          <Text style={typography.body}>{`${correct} dari ${answered} jawaban sesuai kunci draf.`}</Text>
          <Text style={typography.body}>
            {`${valid} dari ${answered} dijawab pada hari soal ditampilkan, tanpa bantuan tercatat.`}
          </Text>
        </Card>
        <Notice tone="info">Hasil sementara. Soal cek belum bisa diulang.</Notice>
      </View>
    );
  }

  return (
    <Page width="exercise" ref={page} header={<BackBar onPress={back} />} footer={footer}>
      <Top />
      {body}
      {errorNotice}
    </Page>
  );
}

function Explained({ label, choice, scale }: { label: string; choice: NextLessonExplainedChoice; scale: number }) {
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
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 8 },
  top: { gap: 2, marginBottom: 12 },
  section: { gap: 14 },
  loading: { paddingVertical: 48, alignItems: 'center' },
  card: { gap: 10 },
  meaning: { fontFamily: typography.label.fontFamily, color: colors.ink },
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
