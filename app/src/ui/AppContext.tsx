import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { APP_VERSION } from '@/config/appVersion';
import { loadRules, type RulesConfig } from '@/config/rules';
import { gateContent, type GatedContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { newId } from '@/engine/util';
import { openStore } from '@/storage/openStore';
import type { Learner, Store } from '@/storage/types';
import type { OpenedWebStore } from '@/storage/webStore';

export { APP_VERSION };
export const CONSENT_VERSION = 'demo-consent-0.1';
/**
 * Version of the consent given in «Akun lokal» before an adult profile is created («Saya setuju jawaban dan pengaturan
 * saya disimpan di profil akun lokal ini.»). Its text differs from the guest consent above, so new account profiles and
 * their new local learners record this version; receipts already recorded under either version are never rewritten.
 */
export const LOCAL_ACCOUNT_CONSENT_VERSION = 'demo-local-account-sync-consent-0.1';
/**
 * Version of the consent given in a staging build's «Akun staging» before an adult profile is created: its statement
 * names the remote staging server («… dikirim ke server akun staging jarak jauh dan disimpan di profil akun staging
 * ini.»), so profiles created there and their new local learners record this version, never the local one above.
 */
export const STAGING_ACCOUNT_CONSENT_VERSION = 'demo-staging-account-sync-consent-0.1';

/**
 * What the screen explicitly knows of its capture when it tells the account an answer was saved. Always optional: a
 * notification without it states nothing about the capture, and so never clears a held one.
 */
export interface AnswerSaveNotice {
  /** True: the answer's intent is saved but its row is not recorded yet (held). False: every captured answer is recorded. */
  capturePending: boolean;
}

/** A signed-in account's opened dataset, used for learning instead of the guest's. */
export interface DatasetSelection {
  store: Store;
  /** Why this store may not write (another tab owns the dataset), or null. */
  readOnly: string | null;
  /** Records session-length and Arabic-size changes through the account's journal: the intent first, then the learner. */
  savePreferences?: (patch: { session_minutes?: number; arabic_scale?: number }) => Promise<void>;
  /**
   * Whether the account work behind this selection is still live (same verified sign-in, handle and turn). Read
   * synchronously; only exactly true counts, and a selection without it is never active.
   */
  active?: () => boolean;
  /**
   * Told that an answer was just saved to this store. It receives the same generation guard useApp().datasetActive is:
   * exactly true only while this selection, its store and learner are still the dataset in use. Never called for a
   * read-only selection, nor once that guard is false. The screen's explicit capture state, when it gave one, is the
   * optional second argument.
   */
  answersSaved?: (active: () => boolean, notice?: AnswerSaveNotice) => Promise<void>;
}

/** In-memory proof that the learner ticked both consent boxes in this app run. Never persisted on its own. */
export interface ConsentReceipt {
  consent_version: string;
  at: string;
  adult: true;
  agreed: true;
}

interface AppState {
  ready: boolean;
  error: string | null;
  store: Store | null;
  /**
   * ENG-R01: set when this tab may not write (another tab owns the web writer lock, or Web
   * Locks is unavailable). Write routes show the read-only notice instead of their content.
   */
  readOnly: string | null;
  rules: RulesConfig;
  content: GatedContent;
  learner: Learner | null;
  consentReceipt: ConsentReceipt | null;
  /** Throws unless both the 18+ and the agreement boxes are ticked. */
  giveConsent: (answers: { adult: boolean; agreed: boolean }) => ConsentReceipt;
  /**
   * Creates the local learner (basic profile) only with an affirmative consent receipt from this app run:
   * the one passed (the profile form gives consent and creates the learner in one step) or the stored one.
   */
  createLearner: (minutes: number, options?: { arabicScale?: number; receipt?: ConsentReceipt }) => Promise<Learner>;
  /** A one-time note for Home (e.g. after a session is closed); cleared when Home is left. */
  flash: string | null;
  setFlash: (note: string | null) => void;
  updateLearner: (patch: Partial<Learner>) => Promise<void>;
  resetAll: () => Promise<void>;
  refreshLearner: () => Promise<void>;
  /** The guest's own store. It stays open while a signed-in account's dataset is in use. */
  guestStore: Store | null;
  /** Which dataset the learning screens use. */
  dataset: 'guest' | 'account';
  /** Uses a signed-in account's opened dataset for learning, or the guest's again (null). Only called explicitly. */
  selectDataset: (selection: DatasetSelection | null) => Promise<void>;
  /**
   * Whether the dataset this callback was rendered with is still the one in use: bound to that selection, store,
   * learner and generation. Any later selectDataset or resetAll turns it false at once, before awaiting anything, and
   * nothing turns it back. A guest callback holds while current; an account one only while its selection's active()
   * is exactly true. Optional only so fixtures without it fail closed.
   */
  datasetActive?: () => boolean;
  /**
   * Tells the signed-in account that an answer was just saved to the dataset this callback was rendered with. Present
   * only for an account selection that takes it. Bound like datasetActive (selection, store, learner and generation), so
   * stable across an ordinary rerender; once a later selectDataset or resetAll fences it, it resolves without calling
   * anything, and nothing revives it. Rejects only when the account's own notification failed while still live. With a
   * `notice` the screen states whether a capture is held; without one nothing is stated about it.
   */
  answersSaved?: (notice?: AnswerSaveNotice) => Promise<void>;
}

const PREFERENCE_FIELDS = ['session_minutes', 'arabic_scale'] as const;

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children, storeFactory = openStore }: { children: ReactNode; storeFactory?: () => Promise<Store | OpenedWebStore> }) {
  const rules = useMemo(() => loadRules(), []);
  const content = useMemo(() => gateContent(activePack, rules.mode), [rules.mode]);
  // The guest dataset: opened once, kept open while an account dataset is in use.
  const [guestStore, setStore] = useState<Store | null>(null);
  const [guestLearner, setLearner] = useState<Learner | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestReadOnly, setReadOnly] = useState<string | null>(null);
  const [consentReceipt, setConsentReceipt] = useState<ConsentReceipt | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // A signed-in account's dataset, when one is selected explicitly.
  const [selection, setSelection] = useState<DatasetSelection | null>(null);
  const [accountLearner, setAccountLearner] = useState<Learner | null>(null);
  const selecting = useRef(0);
  /** The selecting turn the rendered dataset was committed in; a callback bound to it holds only while it is current. */
  const [generation, setGeneration] = useState(0);

  const store = selection ? selection.store : guestStore;
  const learner = selection ? accountLearner : guestLearner;
  const readOnly = selection ? selection.readOnly : guestReadOnly;
  const learnerId = learner?.learner_id ?? null;
  const setActiveLearner = useCallback((l: Learner | null) => (selection ? setAccountLearner(l) : setLearner(l)), [selection]);

  // The binding last committed, synchronized in a layout effect so it is current before any ordinary effect reads it. A
  // held callback compares every identity it captured with it: another learner (refreshed or created), store or
  // selection turns it false, while a same-learner preference save keeps all four and so keeps it live. Until the commit,
  // a newer callback fails closed; selectDataset and resetAll still fence every earlier one at once through `selecting`.
  const currentBinding = useRef({ generation, selection, store, learnerId });
  useLayoutEffect(() => {
    currentBinding.current = { generation, selection, store, learnerId };
  }, [generation, selection, store, learnerId]);

  // Stable while the binding is unchanged, so screens keyed on it do not remount on every render.
  const datasetActive = useMemo(() => {
    const bound = { generation, selection, store, learnerId };
    return () => {
      if (selecting.current !== bound.generation || bound.store === null) return false;
      const now = currentBinding.current;
      if (now.generation !== bound.generation || now.selection !== bound.selection || now.store !== bound.store || now.learnerId !== bound.learnerId) return false;
      if (bound.selection === null) return true;
      try {
        return bound.selection.active?.() === true;
      } catch {
        return false;
      }
    };
  }, [generation, selection, store, learnerId]);

  // Bound to the same identities as datasetActive, whose guard it hands on: a fenced or read-only wrapper calls nothing.
  const answersSaved = useMemo(() => {
    const notify = selection?.answersSaved;
    if (!selection || typeof notify !== 'function' || learnerId === null) return undefined;
    return async (notice?: AnswerSaveNotice) => {
      // Only the literal flag is passed on, copied before anything is awaited; anything else states no capture at all.
      const pending = typeof notice?.capturePending === 'boolean' ? notice.capturePending : null;
      if (datasetActive() !== true || selection.readOnly !== null) return;
      try {
        await (pending === null ? notify(datasetActive) : notify(datasetActive, { capturePending: pending }));
      } catch (e) {
        // A failure of a dataset that is no longer in use concerns nobody.
        if (datasetActive() === true) throw e;
      }
    };
  }, [selection, learnerId, datasetActive]);

  const selectDataset = useCallback(async (next: DatasetSelection | null) => {
    const turn = ++selecting.current; // a newer selection (or sign-out) wins over one still loading
    if (!next) {
      setSelection(null);
      setAccountLearner(null);
      setGeneration(turn);
      return;
    }
    const l = await next.store.getLearner();
    if (turn !== selecting.current) return;
    setAccountLearner(l);
    setSelection(next);
    setGeneration(turn);
  }, []);

  useEffect(() => {
    let alive = true;
    let held: OpenedWebStore | null = null;
    (async () => {
      try {
        const opened = await storeFactory();
        const o: OpenedWebStore = 'access' in opened ? opened : { store: opened, access: 'owner', release: () => undefined };
        held = o;
        if (!alive) return o.release();
        const l = await o.store.getLearner();
        if (!alive) return;
        setStore(o.store);
        setLearner(l);
        if (o.access === 'read-only') {
          setReadOnly(o.reason ?? 'read-only');
          // Take over only once the owner tab has closed; the new store re-reads storage.
          o.whenWritable?.().then(
            async (writable) => {
              const fresh = await writable.getLearner();
              if (!alive) return o.release();
              setStore(writable);
              setLearner(fresh);
              setReadOnly(null);
            },
            (e) => {
              if (alive) setError(e instanceof Error ? e.message : String(e));
            }
          );
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
      // Unmount (e.g. a development double mount) hands the writer lock back; a waiting tab takes over.
      held?.release();
    };
  }, [storeFactory]);

  const giveConsent = useCallback((answers: { adult: boolean; agreed: boolean }) => {
    if (answers.adult !== true || answers.agreed !== true) {
      throw new Error('No consent: both the 18+ confirmation and the agreement are required');
    }
    const receipt: ConsentReceipt = { consent_version: CONSENT_VERSION, at: new Date().toISOString(), adult: true, agreed: true };
    setConsentReceipt(receipt);
    return receipt;
  }, []);

  const createLearner = useCallback(
    async (minutes: number, options?: { arabicScale?: number; receipt?: ConsentReceipt }) => {
      if (!store) throw new Error('Penyimpanan belum siap');
      // No learner ID and no data without an affirmative consent receipt from this app run.
      const receipt = options?.receipt ?? consentReceipt;
      if (!receipt || receipt.adult !== true || receipt.agreed !== true) {
        throw new Error('No consent receipt: learner not created');
      }
      const now = new Date().toISOString();
      const l: Learner = {
        learner_id: newId('lrn'),
        created_at: now,
        consent_version: receipt.consent_version,
        consent_at: receipt.at,
        age_confirmed: receipt.adult,
        session_minutes: minutes,
        arabic_scale: options?.arabicScale ?? 1,
        screens_seen: [],
      };
      await store.saveLearner(l);
      setActiveLearner(l);
      setConsentReceipt(null);
      return l;
    },
    [store, consentReceipt, setActiveLearner]
  );

  const updateLearner = useCallback(
    async (patch: Partial<Learner>) => {
      if (!store) return;
      const current = (await store.getLearner()) ?? learner;
      if (!current) return;
      const save = selection?.savePreferences;
      if (save) {
        // A signed-in account's preferences go through its journal (the intent first); other fields are saved as usual.
        const prefs: { session_minutes?: number; arabic_scale?: number } = {};
        const rest: Partial<Learner> = { ...patch };
        for (const field of PREFERENCE_FIELDS) {
          const value = patch[field];
          if (value !== undefined) prefs[field] = value;
          delete rest[field];
        }
        if (Object.keys(prefs).length) await save(prefs);
        if (Object.keys(rest).length) await store.saveLearner({ ...((await store.getLearner()) ?? current), ...rest });
        setActiveLearner(await store.getLearner());
        return;
      }
      const next = { ...current, ...patch };
      await store.saveLearner(next);
      setActiveLearner(next);
    },
    [store, learner, selection, setActiveLearner]
  );

  const resetAll = useCallback(async () => {
    if (!store) return;
    // Fences every earlier dataset callback before the reset is even queued.
    const turn = ++selecting.current;
    const target = selection;
    try {
      await store.reset();
    } catch (resetError) {
      // A failed reset may have changed nothing, or something: the stored learner is read again and, only while this
      // turn is still current, published under this turn's new generation. Earlier callbacks stay fenced; a failed
      // re-read keeps everything fenced; a newer selection is never touched. The reset's own error is rethrown.
      let actual: Learner | null;
      try {
        actual = await store.getLearner();
      } catch {
        throw resetError;
      }
      if (turn === selecting.current) {
        setActiveLearner(actual);
        setGeneration(turn);
      }
      throw resetError;
    }
    // The guest's cached learner mirrors the guest store, now empty, whichever dataset is current. Everything shared (the
    // account learner, the receipt, the generation) is published only while this turn is current; a newer selection wins.
    if (target === null) setLearner(null);
    if (turn !== selecting.current) return;
    if (target !== null) setAccountLearner(null);
    setConsentReceipt(null);
    setGeneration(turn);
  }, [store, selection, setActiveLearner]);

  const refreshLearner = useCallback(async () => {
    if (store) setActiveLearner(await store.getLearner());
  }, [store, setActiveLearner]);

  const value: AppState = {
    ready,
    error,
    store,
    readOnly,
    rules,
    content,
    learner,
    consentReceipt,
    giveConsent,
    createLearner,
    flash,
    setFlash,
    updateLearner,
    resetAll,
    refreshLearner,
    guestStore,
    dataset: selection ? 'account' : 'guest',
    selectDataset,
    datasetActive,
    answersSaved,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
