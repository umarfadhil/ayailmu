import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { loadRules, type RulesConfig } from '@/config/rules';
import { gateContent, type GatedContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { newId } from '@/engine/util';
import { openStore } from '@/storage/openStore';
import type { Learner, Store } from '@/storage/types';
import type { OpenedWebStore } from '@/storage/webStore';

export const APP_VERSION = '0.2.0';
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

/** A signed-in account's opened dataset, used for learning instead of the guest's. */
export interface DatasetSelection {
  store: Store;
  /** Why this store may not write (another tab owns the dataset), or null. */
  readOnly: string | null;
  /** Records session-length and Arabic-size changes through the account's journal: the intent first, then the learner. */
  savePreferences?: (patch: { session_minutes?: number; arabic_scale?: number }) => Promise<void>;
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

  const store = selection ? selection.store : guestStore;
  const learner = selection ? accountLearner : guestLearner;
  const readOnly = selection ? selection.readOnly : guestReadOnly;
  const setActiveLearner = useCallback((l: Learner | null) => (selection ? setAccountLearner(l) : setLearner(l)), [selection]);

  const selectDataset = useCallback(async (next: DatasetSelection | null) => {
    const turn = ++selecting.current; // a newer selection (or sign-out) wins over one still loading
    if (!next) {
      setSelection(null);
      setAccountLearner(null);
      return;
    }
    const l = await next.store.getLearner();
    if (turn !== selecting.current) return;
    setAccountLearner(l);
    setSelection(next);
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
    await store.reset();
    setConsentReceipt(null);
    setActiveLearner(null);
  }, [store, setActiveLearner]);

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
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
