// Unit A pilot screen over the real pilot controller and the selected store. Everything shown comes from a view
// the controller made durable first; before a check nothing keyed or explanatory is rendered, and held-out
// answers show only that they were saved until the block closes.
// One inner panel per binding (store identity, owner, mode, read-only): a changed binding unmounts the old
// panel in the same commit, so its question never flashes, and its controller is disposed with it.
// Needs no router or app context (only the type of its capture notice); the route owns Back, focus and the learner binding.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { starterBetaBuild } from '@/config/learningBeta';
import { normalStarterBuild } from '@/config/normalStarter';
import { loadScreenViews } from '@/engine/exposure';
import { nextLessonAssistedOn } from '@/pilot/nextLesson/assistance';
import type { Store } from '@/storage/types';
import { moveFocus } from '@/ui/a11y';
import type { AnswerSaveNotice } from '@/ui/AppContext';
import { ArabicText, Btn, Caption, Card, Eyebrow, MixedText, Notice, Page, type PageHandle } from '@/ui/components';
import { colors, radius, typography } from '@/ui/theme';
import { isPilotAnswer } from './capture';
import type { PilotPhase } from './content';
import {
  createPilotController,
  type PilotBlockReason,
  type PilotConstructSummary,
  type PilotDelayedCounts,
  type PilotDelayedPhase,
  type PilotExplainedChoice,
  type PilotMode,
  type PilotView,
} from './controller';
import { starterReviewAccess } from './review';

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
  /** Opens the next lesson; offered only while this owner's Unit A qualifies. */
  onNextLesson?: () => void;
  /** Dataset liveness (e.g. the selected account's); only exactly true lets the controller act. */
  active?: () => boolean;
  /** The store's learner, to capture answers for; used only in a validated beta with the reviewed starter. */
  captureLearnerId?: string;
  /**
   * Tells the signed-in account that answers were saved here. Only for the reviewed tester's account capture (used
   * nowhere else), and bound to the controller it is mounted with: another one is a new controller. It runs only after a
   * safe view, and states what the controller knows: `capturePending` false once every captured answer is in the store,
   * true while one is held on this device (its row append failed). Its rejection never touches the saved answer.
   */
  onAnswersSaved?: (notice?: AnswerSaveNotice) => Promise<void>;
}

type PilotController = ReturnType<typeof createPilotController>;
type Notify = NonNullable<UnitAPilotScreenProps['onAnswersSaved']>;
type Failure = 'load' | 'save';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CAPTURE_PENDING = 'Jawaban tersimpan di perangkat. Pencatatan akun akan dicoba lagi.';
const SYNC_NOTE = 'Jawaban tersimpan di perangkat. Status sinkronisasi belum tersedia.';

/**
 * Whether the learner saw teaching or answered legacy practice on `day` in the selected store. Conservative:
 * any same-day screen view or answer, or a next lesson help day of `owner`, counts as assistance. With `owner`,
 * only that owner's own exactly recognized pilot answers are left out (the pilot document dates those itself);
 * foreign, altered or legacy answers still count. Unreadable data rejects, never reads as "unexposed".
 */
export async function pilotAssistedOn(store: Store, day: string, owner?: string): Promise<boolean> {
  if (!DAY.test(day)) throw new Error('Pilot assistance check needs a local day (YYYY-MM-DD).');
  const views = await loadScreenViews(store);
  const answers: unknown = await store.listAnswers();
  if (!Array.isArray(answers)) throw new Error('Stored answers are unreadable; they were not modified.');
  let assisted = views.some((v) => v.local_date === day);
  for (const answer of answers) {
    const date: unknown = (answer as { local_date?: unknown } | null)?.local_date;
    if (typeof date !== 'string' || !DAY.test(date)) throw new Error('A stored answer has no readable local date.');
    if (date === day && !(owner !== undefined && isPilotAnswer(answer, owner))) assisted = true;
  }
  const nextLesson = await nextLessonAssistedOn(store, owner, day);
  return assisted || nextLesson;
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

/**
 * A tester build opens Unit A only in a validated private beta, learning beta or normal user build whose compiled review
 * approves the exact starter. A build alone never opens it: the same review check always applies.
 */
function betaStarterOpen(): boolean {
  return (starterBetaBuild() || normalStarterBuild()) && starterReviewAccess().allowed === true;
}

/** The explicit normal user build (never also a beta one): its screen carries no prototype or beta wording. */
function normalUserView(mode: PilotMode): boolean {
  return mode === 'tester' && normalStarterBuild() && !starterBetaBuild();
}

export function UnitAPilotScreen(props: UnitAPilotScreenProps) {
  const { store, owner, mode, readOnly } = props;
  const normalUser = normalUserView(mode);
  // The controller re-checks the build and the review on every operation; this only keeps it from mounting otherwise.
  if (mode !== 'developer-demo' && !(mode === 'tester' && betaStarterOpen())) return <Unavailable normalUser={normalUser}>Unit A uji coba hanya tersedia di mode pengembang.</Unavailable>;
  if (readOnly !== null) return <Unavailable normalUser={normalUser}>{`Penyimpanan sedang hanya-baca (${readOnly}). Unit A tidak dibuka di tab ini.`}</Unavailable>;
  return <PilotPanel key={JSON.stringify([storeId(store), owner, mode, readOnly])} {...props} />;
}

function Unavailable({ children, normalUser = false }: { children: string; normalUser?: boolean }) {
  return (
    <Page width="exercise">
      <View style={styles.top}>
        <Eyebrow tone="accent">{normalUser ? 'Unit A' : 'Unit A · uji coba'}</Eyebrow>
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
  review: 'Materi Unit A masih menunggu tinjauan.',
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

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** A stored YYYY-MM-DD day as "9 Januari 2026"; anything else is shown as stored. */
function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : day;
}

const PHASE_LABEL: Record<PilotPhase, string> = {
  practice: 'Latihan',
  transfer: 'Cek pemahaman',
  d7: 'Cek 7 hari',
  d30: 'Cek 30 hari',
};

const PROVISIONAL_NOTE = 'Hasil sementara dari pilihan ganda.';

/** Descriptive counts for a closed delayed check; independence is mentioned only when some answers lacked it. */
function countsLine(phase: PilotDelayedPhase, c: PilotDelayedCounts): string {
  const base = `${PHASE_LABEL[phase]}: ${c.correct} dari ${c.answered} jawaban pertama benar`;
  const outside = c.answered - c.valid;
  return outside > 0 ? `${base}; ${outside} dijawab pada hari lain atau dengan bantuan tercatat.` : `${base}.`;
}

function viewKey(view: PilotView | null): string {
  if (view === null) return '';
  switch (view.kind) {
    case 'lesson':
      return `lesson:${view.lesson.id}`;
    case 'question':
    case 'feedback':
    case 'assessment-feedback':
      return `${view.kind}:${view.presentationId}`;
    case 'blocked':
      return `blocked:${view.reason}`;
    case 'awaiting-transfer':
      return `${view.kind}:${view.until}`;
    case 'progress':
      return `${view.kind}:${view.nextDue ?? ''}:${view.upcoming?.answered ?? ''}:${view.upcoming?.availableOn ?? ''}`;
    default:
      return view.kind;
  }
}

function PilotPanel({ store, owner, mode, readOnly, arabicScale, today, onNextLesson, active, captureLearnerId, onAnswersSaved }: UnitAPilotScreenProps) {
  const normalUser = normalUserView(mode);
  const [view, setView] = useState<PilotView | null>(null);
  const [choice, setChoice] = useState<{ presentationId: string; optionId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Whether the last successful operation left a captured answer only on this device; never a claim of upload.
  const [capturePending, setCapturePending] = useState(false);
  // Whether the account's latest notification failed: the answer is saved, only its sync status is unknown.
  const [syncNote, setSyncNote] = useState(false);
  const ctrl = useRef<PilotController | null>(null);
  const notifier = useRef<Notify | undefined>(undefined); // the current controller's own, never a later prop
  const notifySeq = useRef(0); // only the newest notification's outcome is shown
  const epoch = useRef(0); // a disposed controller's late results are dropped
  const busyRef = useRef(false); // synchronous duplicate-press guard; the controller's own guard stays authoritative
  const todayRef = useRef(today);
  const page = useRef<PageHandle>(null);
  const heading = useRef<ViewInstance>(null);
  const errorRegion = useRef<ViewInstance>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  // Tells the account through `notify`, the callback `c` was mounted with (none: clears the note), what the controller
  // knows of its capture as `notice`. It never waits for the screen's own work, and its outcome counts only while `c` is
  // still this panel's controller and no newer one has run.
  const tell = useCallback((c: PilotController, notify: Notify | undefined, notice?: AnswerSaveNotice): void => {
    const turn = ++notifySeq.current;
    if (notify === undefined) {
      setSyncNote(false);
      return;
    }
    const current = () => turn === notifySeq.current && ctrl.current === c;
    void Promise.resolve()
      .then(() => notify(notice))
      .then(
        () => {
          if (current()) setSyncNote(false);
        },
        () => {
          if (current()) setSyncNote(true);
        }
      );
  }, []);

  const run = useCallback(
    (action: (c: PilotController) => Promise<PilotView>, kind: Failure): Promise<void> => {
      const c = ctrl.current;
      if (c === null || busyRef.current) return Promise.resolve();
      const notify = notifier.current;
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
            const captured = c.captureStatus();
            setCapturePending(next.kind !== 'blocked' && captured === 'pending');
            setBusy(false);
            // Only a safe view of a capturing controller tells the account, and always what it knows: a held capture (its
            // row append failed) as pending, every captured answer in the store as saved. Capture off or blocked says nothing.
            const notice: AnswerSaveNotice | undefined =
              next.kind === 'blocked' ? undefined : captured === 'pending' ? { capturePending: true } : captured === 'saved' ? { capturePending: false } : undefined;
            tell(c, notice === undefined ? undefined : notify, notice);
          },
          () => {
            if (!current()) return;
            busyRef.current = false;
            setFailure(kind);
            setBusy(false);
          }
        );
    },
    [tell]
  );

  useEffect(() => {
    let live = true;
    // The dataset's own liveness, bound once per controller: a later callback never revives this one.
    const datasetLive = (): boolean => {
      if (active === undefined) return true;
      try {
        return active() === true;
      } catch {
        return false;
      }
    };
    const isLive = () => live && datasetLive();
    // Capture only in a validated beta or normal user build whose compiled review approves the exact starter, for a named learner.
    const learnerId =
      mode === 'tester' && betaStarterOpen() && typeof captureLearnerId === 'string' && captureLearnerId.length > 0 ? captureLearnerId : null;
    const c = createPilotController({
      store,
      owner,
      mode,
      today: () => todayRef.current(),
      readOnly: () => readOnly !== null,
      active: isLive,
      assistedToday: (day?: string) => pilotAssistedOn(store, day ?? todayRef.current(), owner),
      random: Math.random,
      ...(learnerId !== null ? { capture: { learnerId, now: () => new Date().toISOString(), active: isLive } } : {}),
    });
    ctrl.current = c;
    // Bound with the controller, and only where it captures: a later or foreign callback never stands in for it.
    notifier.current = learnerId !== null && typeof onAnswersSaved === 'function' ? onAnswersSaved : undefined;
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
      if (ctrl.current === c) {
        ctrl.current = null;
        notifier.current = undefined;
      }
      epoch.current += 1;
      busyRef.current = false;
    };
  }, [store, owner, mode, readOnly, active, captureLearnerId, onAnswersSaved, run]);

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
    const held = view.phase !== 'practice';
    const submit = held ? 'Simpan jawaban' : 'Periksa';
    body = (
      <View testID="pilot-question" style={styles.section}>
        <Eyebrow>{PHASE_LABEL[view.phase]}</Eyebrow>
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
        <Caption>
          {held
            ? 'Pilihan bisa diganti sampai Anda menekan Simpan jawaban. Hasilnya ditampilkan setelah semua soal cek ini dijawab.'
            : 'Pilihan bisa diganti sampai Anda menekan Periksa. Jawaban yang diperiksa disimpan dan tidak diubah.'}
        </Caption>
      </View>
    );
    footer = (
      <Btn
        key={shown}
        testID="pilot-check"
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
  } else if (view.kind === 'assessment-feedback') {
    body = (
      <View testID="pilot-assessment-feedback" role="status" accessibilityLiveRegion="polite" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.heading}>
            Jawaban tersimpan
          </Text>
        </View>
        <Text style={typography.body}>{`${PHASE_LABEL[view.phase]}: ${view.answered} dari ${view.total} soal sudah dijawab.`}</Text>
        <Caption>Hasilnya ditampilkan setelah semua soal cek ini dijawab.</Caption>
      </View>
    );
    footer = <Btn key={shown} testID="pilot-next" label="Lanjut" icon="arrow-forward" disabled={busy} onPress={next} style={styles.fullBtn} />;
  } else if (view.kind === 'progress') {
    const anchor = view.provisional ? view.anchorDay : null;
    const { nextDue, upcoming, delayed } = view;
    const counted = delayed.d7 !== null || delayed.d30 !== null;
    // Original anchored schedule first, then today's availability only where it differs; no check button is
    // offered here because no check is open today.
    const lines: string[] = [];
    if (anchor !== null) {
      lines.push(`Cek awal selesai pada ${dayLabel(anchor)}.`);
      (['d7', 'd30'] as const).forEach((phase) => {
        const counts = delayed[phase];
        if (counts !== null) lines.push(countsLine(phase, counts));
      });
      if (upcoming !== null && nextDue !== null) {
        const label = PHASE_LABEL[upcoming.phase];
        const started = upcoming.answered > 0;
        lines.push(
          started
            ? `${label} (jadwal ${dayLabel(nextDue)}): ${upcoming.answered} dari ${upcoming.total} jawaban tersimpan; hasilnya ditampilkan setelah semua dijawab.`
            : `${label} dijadwalkan ${dayLabel(nextDue)}.`
        );
        if (upcoming.availableOn > nextDue) {
          lines.push(
            `Bisa ${started ? 'dilanjutkan' : 'dibuka'} paling cepat ${dayLabel(upcoming.availableOn)}, pada hari tanpa pelajaran, latihan, atau cek lain yang tercatat di aplikasi ini.`
          );
        }
      } else if (nextDue === null && delayed.d30 !== null) {
        lines.push('Semua cek sudah tercatat.');
      }
    }
    body = (
      <View testID="pilot-progress" style={styles.section}>
        <View ref={heading} tabIndex={-1}>
          <Text accessibilityRole="header" style={typography.title}>
            {anchor !== null ? 'Progres cek Unit A' : 'Cek pemahaman selesai'}
          </Text>
        </View>
        {anchor !== null ? (
          <>
            <Text style={typography.body}>Jawaban Anda memenuhi target cek awal.</Text>
            <Card style={styles.card}>
              {lines.map((line, n) => (
                <Text key={n} style={typography.body}>
                  {line}
                </Text>
              ))}
            </Card>
          </>
        ) : (
          <Text style={typography.body}>
            Jawaban pertama pada soal cek belum memenuhi target, misalnya karena belum tepat, «Belum tahu», dijawab pada
            hari lain dari saat soal tampil, atau ada pelajaran atau latihan pada hari yang sama. Soal cek ini tidak diulang
            di versi ini.
          </Text>
        )}
        <Notice tone="info">
          {anchor !== null && counted ? `${PROVISIONAL_NOTE} Angka cek hanya catatan, bukan penilaian akhir.` : PROVISIONAL_NOTE}
        </Notice>
      </View>
    );
    // The next lesson is offered from this durable qualified progress alone; pressing only opens it, and the next
    // lesson's own controller checks qualification again on every operation.
    if (view.provisional === true && mode === 'developer-demo' && onNextLesson) {
      footer = (
        <Btn
          key={shown}
          testID="pilot-next-lesson"
          label="Pelajaran berikutnya"
          icon="arrow-forward"
          disabled={busy}
          onPress={() => {
            if (ctrl.current !== null) onNextLesson();
          }}
          style={styles.fullBtn}
        />
      );
    }
  } else if (view.kind === 'awaiting-transfer' || view.kind === 'insufficient') {
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
            : 'Target latihan belum tercapai di setiap bagian, jadi soal cek tidak dibuka.'}
        </Text>
        {view.kind === 'awaiting-transfer' ? (
          <Text style={typography.body} testID="pilot-awaiting-transfer">
            {`Soal cek pemahaman yang baru dibuka pada hari lain yang tanpa pelajaran atau latihan. Silakan kembali paling cepat ${dayLabel(view.until)}.`}
          </Text>
        ) : null}
        <Card style={styles.card}>
          {view.constructs.map((c) => (
            <Text key={c.construct} style={typography.body}>
              {`${CONSTRUCT_LABEL[c.construct]}: benar pada ${c.correctFamilies} jenis soal (target latihan ${c.required})`}
            </Text>
          ))}
        </Card>
        <Notice tone="info">Ini ringkasan latihan sementara, bukan penilaian akhir.</Notice>
      </View>
    );
  }

  return (
    <Page width="exercise" ref={page} footer={footer}>
      <View style={styles.top}>
        <Eyebrow tone="accent">{normalUser ? 'Unit A' : 'Unit A · uji coba'}</Eyebrow>
        {/* A tester panel mounts only in a validated beta or normal user build with the exact starter reviewed (UnitAPilotScreen). */}
        <Caption>
          {normalUser
            ? 'Kemajuan latihan sementara'
            : mode === 'tester'
              ? 'Beta privat · hasil sementara'
              : 'Draf belum ditinjau · progres hanya tersimpan di perangkat ini'}
        </Caption>
      </View>
      {body}
      {capturePending && view !== null && view.kind !== 'blocked' ? (
        <Notice tone="info" testID="pilot-capture-pending">
          {CAPTURE_PENDING}
        </Notice>
      ) : null}
      {syncNote && view !== null && view.kind !== 'blocked' ? (
        <View role="status" accessibilityLiveRegion="polite">
          <Notice tone="info" testID="pilot-sync-note">
            {SYNC_NOTE}
          </Notice>
        </View>
      ) : null}
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
