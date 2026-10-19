// Approved Calm Paper UI port (design review 2026-10-18), written before the port. The Guide recovers from a
// dated-view save error without showing a lesson before its view is saved; the phone navigation, the focused
// session and summary, consent, Kemajuan and the Arabic size preview follow the reviewed direction.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { progress } from '@/engine/progress';
import { addDays, localDate } from '@/engine/util';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import { moveFocus } from '@/ui/a11y';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Dev from '@/app/dev';
import Guide from '@/app/guide';
import Home from '@/app/index';
import ProgressScreen from '@/app/progress';
import SessionScreen from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';

// Focus moves are observed through the a11y helper, as in a11y-checks.test.tsx.
jest.mock('@/ui/a11y', () => ({ moveFocus: jest.fn() }));
const focusedIds = () => (moveFocus as jest.Mock).mock.calls.map((c) => c[0]?.current?.props?.testID as string | undefined);
const lastFocused = () => focusedIds()[focusedIds().length - 1];

let mockKv: KvBackend = memoryKv();
let mockFailWrites = false;
/** When set, a meta write (such as a dated Guide view) waits for it before it is attempted. */
let mockHoldMeta: Promise<void> | null = null;
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    const { KvStore: Store } = jest.requireActual('@/storage/kvStore');
    const kv = {
      getItem: (k: string) => mockKv.getItem(k),
      removeItem: (k: string) => mockKv.removeItem(k),
      setItem: (k: string, v: string) => {
        if (mockFailWrites) throw new Error('disk full');
        mockKv.setItem(k, v);
      },
    };
    const s = new Store(kv);
    await s.init();
    const setMeta = s.setMeta.bind(s);
    s.setMeta = async (key: string, value: string | null) => {
      if (mockHoldMeta) await mockHoldMeta;
      return setMeta(key, value);
    };
    return s;
  },
}));

const routes = { _layout: RootLayout, index: Home, consent: Consent, setup: Setup, session: SessionScreen, summary: Summary, settings: Settings, guide: Guide, progress: ProgressScreen, dev: Dev };
const start = (initialUrl = '/') => renderRouter(routes, { initialUrl });
const tap = async (id: string) => {
  await waitFor(() => expect(screen.getByTestId(id)).toBeEnabled());
  await fireEvent.press(screen.getByTestId(id));
};

const content = gateContent(activePack, 'developer-demo');
const rules = loadRules('developer-demo');
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
const today = () => localDate(Date.now());
const learner: Learner = {
  learner_id: 'lrn-port',
  created_at: '2026-01-01T00:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: A_SCREENS,
};
let n = 0;
function rec(item_id: string, local_date: string, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id)!;
  return {
    answer_id: `seed-${n}`,
    learner_id: learner.learner_id,
    item_id,
    content_version: item.content_version,
    rules_version: rules.rules_version,
    app_version: '0.2.0',
    timestamp: `${local_date}T02:00:00.000Z`,
    local_date,
    session_id: 'seed',
    pool: item.pool,
    unit: item.unit,
    skills: item.skills,
    raw_response: '{"kind":"choice","option_id":"k"}',
    auto_score: {},
    outcome: 'correct',
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 1000,
    audio_status: null,
    report_flag: false,
    review_status: item.review_status,
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: item.lineage,
    role: 'practice',
    ...extra,
  };
}
const seed = (answers: AnswerRecord[] = []) =>
  mockKv.setItem(KvStore.KEY, JSON.stringify({ schema: 2, meta: {}, learner, answers, snapshot: null, reports: [] }));
const stored = () => JSON.parse(mockKv.getItem(KvStore.KEY)!);
const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

type Host = ReturnType<typeof screen.getByTestId>;
const insideTabList = (el: Host | null): boolean =>
  !!el && ((el.props.role ?? el.props.accessibilityRole) === 'tablist' || insideTabList(el.parent ?? null));
/** The primary navigation: the controls of the tab list (Expo Router's own tab bar has role="tablist"). */
const primaryNav = () => screen.queryAllByRole(/^(tab|button|link)$/).filter((el) => insideTabList(el.parent ?? null));
const NAV = ['Belajar', 'Panduan', 'Kemajuan'];
/** Exactly the three learner destinations, in order, with the current one selected. */
const expectPrimaryNav = (current: string) => {
  const items = primaryNav();
  expect(items).toHaveLength(NAV.length);
  NAV.forEach((label, i) => {
    expect(items[i]).toHaveTextContent(new RegExp(`\\b${label}\\b`));
    if (label === current) expect(items[i]).toBeSelected();
    else expect(items[i]).not.toBeSelected();
  });
};
/** A control that opens a list of routes (the old phone header «Buka menu»). */
const menuButtons = () => screen.queryAllByRole('button', { name: /menu/i });

beforeEach(() => {
  (moveFocus as jest.Mock).mockClear();
  mockKv = memoryKv();
  mockFailWrites = false;
  mockHoldMeta = null;
  delete process.env.EXPO_PUBLIC_APP_MODE;
});

describe('Guide: a view saved after a failed one replaces the stale error (essential regression)', () => {
  /** Screens with a saved dated Guide view, in order. */
  const guideViews = () => (JSON.parse(stored().meta.screen_views ?? '[]') as { screen_id: string }[]).map((v) => v.screen_id);
  /** The learner's way to a lesson: open the topic picker, choose the lesson. */
  const chooseLesson = async (screenId: string) => {
    await tap('guide-topics');
    await tap(`guide-${screenId}`);
  };

  it('switching away and back in the same visit saves the view first, then shows the lesson in place of the error and focuses its title', async () => {
    seed();
    await start('/guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));

    // The dated view of «هُوَ dan هِيَ» cannot be saved: its text stays hidden and the error takes focus.
    mockFailWrites = true;
    await chooseLesson('DEMO-S2');
    await waitFor(() => expect(screen.getByTestId('guide-record-error')).toBeTruthy());
    await waitFor(() => expect(lastFocused()).toMatch(/^guide-record-error/));
    expect(screen.queryByTestId('lesson-panel')).toBeNull();
    expect(guideViews()).toEqual(['DEMO-S1']);

    // Saving works again. Away to the first lesson (already saved on this visit) ...
    mockFailWrites = false;
    await chooseLesson('DEMO-S1');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    expect(screen.queryByTestId('guide-record-error')).toBeNull();

    // ... and back. Nothing is shown while its view is still being saved.
    let release!: () => void;
    mockHoldMeta = new Promise<void>((r) => (release = r));
    (moveFocus as jest.Mock).mockClear();
    await chooseLesson('DEMO-S2');
    expect(screen.queryByTestId('lesson-panel')).toBeNull();
    expect(guideViews()).toEqual(['DEMO-S1']);
    await act(async () => release());
    mockHoldMeta = null;

    // Saved: the lesson body replaces the stale error and its detail, and the lesson title takes focus.
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    expect(screen.getByTestId('lesson-panel')).toHaveTextContent(/artinya dia \(laki-laki\)/);
    expect(screen.queryByTestId('guide-record-error')).toBeNull();
    expect(screen.queryByText(/disk full/)).toBeNull();
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    expect(guideViews()).toEqual(['DEMO-S1', 'DEMO-S2']);
  }, 30000);

  it('choosing the failed lesson again retries its view: still failing keeps it hidden behind the focused error; once saved it is shown and focused', async () => {
    seed();
    await start('/guide');
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    mockFailWrites = true;
    await chooseLesson('DEMO-S2');
    await waitFor(() => expect(screen.getByTestId('guide-record-error')).toBeTruthy());

    // Retried while saving still fails: nothing is saved or shown, and the error keeps focus.
    (moveFocus as jest.Mock).mockClear();
    await chooseLesson('DEMO-S2');
    await waitFor(() => expect(lastFocused()).toMatch(/^guide-record-error/));
    expect(screen.queryByTestId('lesson-panel')).toBeNull();
    expect(guideViews()).toEqual(['DEMO-S1']);

    // Retried once saving works: saved, then shown in place of the error.
    mockFailWrites = false;
    (moveFocus as jest.Mock).mockClear();
    await chooseLesson('DEMO-S2');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    expect(screen.queryByTestId('guide-record-error')).toBeNull();
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    expect(guideViews()).toEqual(['DEMO-S1', 'DEMO-S2']);
  }, 30000);
});

describe('phone shell: three learner destinations, Pengaturan apart, no route menu', () => {
  const setWidth = async (width: number) => {
    const { Dimensions } = jest.requireActual('react-native');
    const height = width < 1024 ? 844 : 900;
    await act(async () => {
      Dimensions.set({
        window: { width, height, scale: 2, fontScale: 1 },
        screen: { width, height, scale: 2, fontScale: 1 },
      });
    });
  };
  beforeEach(() => setWidth(390));
  afterEach(() => setWidth(750));

  it('the primary navigation is exactly Belajar, Panduan and Kemajuan and follows the route; Pengaturan is a separate control', async () => {
    seed();
    await start('/');
    await screen.findByTestId('start-session');
    expectPrimaryNav('Belajar');
    expect(menuButtons()).toHaveLength(0);

    await fireEvent.press(primaryNav()[NAV.indexOf('Panduan')]);
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    expectPrimaryNav('Panduan');
    await fireEvent.press(primaryNav()[NAV.indexOf('Kemajuan')]);
    await screen.findByTestId('progress-overview');
    expectPrimaryNav('Kemajuan');
    await fireEvent.press(primaryNav()[NAV.indexOf('Belajar')]);
    await screen.findByTestId('start-session');
    expectPrimaryNav('Belajar');

    const settings = screen.queryAllByRole(/^(button|link)$/, { name: /Pengaturan/ }).filter((el) => !insideTabList(el));
    expect(settings.length).toBeGreaterThan(0);
    await fireEvent.press(settings[0]);
    await screen.findByTestId('learner-id');
  }, 30000);

  it('the session and its interim Ringkasan show no route menu, and the unfinished session resumes at the same step', async () => {
    seed();
    await start('/');
    await tap('start-session');
    await waitFor(() => expect(screen.getByTestId('item-arabic')).toHaveTextContent('صَادِقٌ'));
    expect(menuButtons()).toHaveLength(0);
    await tap('option-k');
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
    const answers = stored().answers;

    await act(async () => router.navigate('/summary'));
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi belum selesai'));
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('1');
    expect(menuButtons()).toHaveLength(0);

    await tap('summary-resume');
    await waitFor(() => expect(screen.getByTestId('feedback-message')).toHaveTextContent(/jujur/));
    expect(stored().answers).toEqual(answers);
  }, 30000);
});

describe('consent and Kemajuan claim nothing the app does not do', () => {
  it('consent ties no deletion, reminder, export or sync to Pengaturan and keeps the data on this device; unconfigured data and account controls stay unavailable', async () => {
    // Test-premise fix (local account pilot): this case is about a build WITHOUT the local account service, but the
    // test runner configures that service through EXPO_PUBLIC_*. Its three variables are cleared for this case only
    // and restored afterwards; every assertion below is unchanged.
    const accountEnv = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'] as const;
    const savedEnv = accountEnv.map((name) => [name, process.env[name]] as const);
    for (const name of accountEnv) delete process.env[name];
    try {
      await unconfiguredControls();
    } finally {
      for (const [name, value] of savedEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 30000);

  async function unconfiguredControls() {
    await start('/');
    // The guest-first welcome comes before the consent (board 13 → 14); neither shows learner navigation.
    await screen.findByTestId('welcome-start');
    expect(primaryNav()).toHaveLength(0);
    await tap('welcome-start');
    await screen.findByTestId('consent-adult');
    expect(primaryNav()).toHaveLength(0); // no learner navigation before consent
    expect(screen.getAllByText(/hanya[^.]*di perangkat ini/i).length).toBeGreaterThan(0);
    const unoffered = /(hapus|pengingat|ekspor|unduh|sinkron)[^.]*Pengaturan|Pengaturan[^.]*(hapus|pengingat|ekspor|unduh|sinkron)/i;
    expect(screen.queryAllByText(unoffered).map((t) => t.props.children)).toEqual([]);
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();

    // Sign-in, sync, export and deletion are not configured: Pengaturan offers no working control for them.
    await cleanup();
    seed();
    await start('/settings');
    await screen.findByTestId('learner-id');
    const unconfigured = /hapus|ekspor|unduh|sinkron|cadangan|\bakun\b|\bmasuk\b|\bOTP\b|\blogin\b/i;
    for (const control of screen.queryAllByRole(/^(button|link|switch|checkbox)$/, { name: unconfigured })) {
      expect(control).toBeDisabled();
    }
  }

  it('Kemajuan shows the recognition, pending and transfer caveats as soon as it opens, without opening a panel', async () => {
    const answers = [...A_CORE.map((id) => rec(id, addDays(today(), -8))), rec('A3-D7S3', today(), { role: 'check', feedback_deferred: true })];
    seed(answers);
    await start('/progress');
    await screen.findByTestId('progress-overview');
    const unitA = progress(answers, content, rules, today(), learner.screens_seen, []).units.find((u) => u.unit === 'A')!;

    // Nothing is pressed: each caveat is part of the page.
    expect(screen.getByTestId('line-learned-A')).toHaveTextContent(/Belum dinilai/);
    expect(screen.getByTestId('line-transfer-A')).toHaveTextContent(/Belum dinilai/);
    for (const reason of [unitA.learned.reason, unitA.transfer.reason]) {
      expect(screen.getAllByText(literally(reason)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/hasilnya ditampilkan setelah semua soal cek ini dijawab/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dicatat sebagai pengenalan/).length).toBeGreaterThan(0);
  }, 30000);
});

describe('Arabic samples outside dated lessons show no held-out check material', () => {
  const ARABIC_WORD = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g;
  const arabicWords = (text: string) => text.match(ARABIC_WORD) ?? [];
  // Lesson titles are listed openly (Home outline, Guide topic picker), so their words (هُوَ, هِيَ) are not held out.
  const listed = new Set(content.screens.flatMap((s) => arabicWords(s.title)));
  /** Every other Arabic word a scheduled check (D7/D30) shows or offers: its stimulus, help lines and Arabic options. */
  const HELD_OUT = new Set(
    content.items
      .filter((i) => i.pool === 'D7' || i.pool === 'D30')
      .flatMap((i) => [i.arabic, ...i.help_lines.map((h) => h.word), ...(i.options ?? []).filter((o) => o.arabic).map((o) => o.text)])
      .flatMap(arabicWords)
      .filter((w) => !listed.has(w))
  );
  /** Held-out words anywhere on the rendered screen, in text or accessibility labels. */
  const heldOutShown = () => [...new Set(arabicWords(JSON.stringify(screen.toJSON())))].filter((w) => HELD_OUT.has(w));

  it('Belajar and the Pengaturan size preview (a neutral sample) show none, also while a check is due', async () => {
    // A3-D30W4 asks for the meaning of صَابِرَةٌ thirty days after Unit A; it stays in the course as it is.
    expect([...HELD_OUT]).toContain(content.items.find((i) => i.item_id === 'A3-D30W4')?.arabic);
    seed(A_CORE.map((id) => rec(id, addDays(today(), -8)))); // the 7-day check is due
    await start('/');
    await screen.findByTestId('start-session');
    expect(heldOutShown()).toEqual([]);

    await cleanup();
    await start('/settings');
    await screen.findByTestId('learner-id');
    expect(screen.queryAllByText(/[؀-ۿ]/).length).toBeGreaterThan(0); // the size preview is still shown
    expect(heldOutShown()).toEqual([]);
  }, 30000);
});
