import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadRules, type RulesConfig } from '@/config/rules';
import { gateContent, type GatedContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { newId } from '@/engine/util';
import { openStore } from '@/storage/openStore';
import type { Learner, Store } from '@/storage/types';
import type { OpenedWebStore } from '@/storage/webStore';

export const APP_VERSION = '0.2.0';
export const CONSENT_VERSION = 'demo-consent-0.1';

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
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children, storeFactory = openStore }: { children: ReactNode; storeFactory?: () => Promise<Store | OpenedWebStore> }) {
  const rules = useMemo(() => loadRules(), []);
  const content = useMemo(() => gateContent(activePack, rules.mode), [rules.mode]);
  const [store, setStore] = useState<Store | null>(null);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState<string | null>(null);
  const [consentReceipt, setConsentReceipt] = useState<ConsentReceipt | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

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
      setLearner(l);
      setConsentReceipt(null);
      return l;
    },
    [store, consentReceipt]
  );

  const updateLearner = useCallback(
    async (patch: Partial<Learner>) => {
      if (!store) return;
      const current = (await store.getLearner()) ?? learner;
      if (!current) return;
      const next = { ...current, ...patch };
      await store.saveLearner(next);
      setLearner(next);
    },
    [store, learner]
  );

  const resetAll = useCallback(async () => {
    if (!store) return;
    await store.reset();
    setConsentReceipt(null);
    setLearner(null);
  }, [store]);

  const refreshLearner = useCallback(async () => {
    if (store) setLearner(await store.getLearner());
  }, [store]);

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
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
