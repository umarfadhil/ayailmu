import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadRules, type RulesConfig } from '@/config/rules';
import { gateContent, type GatedContent } from '@/content/gating';
import { demoPack } from '@/content/load';
import { newId } from '@/engine/util';
import { openStore } from '@/storage/openStore';
import type { Learner, Store } from '@/storage/types';

export const APP_VERSION = '0.1.0';
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
  rules: RulesConfig;
  content: GatedContent;
  learner: Learner | null;
  consentReceipt: ConsentReceipt | null;
  /** Throws unless both the 18+ and the agreement boxes are ticked. */
  giveConsent: (answers: { adult: boolean; agreed: boolean }) => ConsentReceipt;
  createLearner: (minutes: number) => Promise<Learner>;
  updateLearner: (patch: Partial<Learner>) => Promise<void>;
  resetAll: () => Promise<void>;
  refreshLearner: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children, storeFactory = openStore }: { children: ReactNode; storeFactory?: () => Promise<Store> }) {
  const rules = useMemo(() => loadRules(), []);
  const content = useMemo(() => gateContent(demoPack, rules.mode), [rules.mode]);
  const [store, setStore] = useState<Store | null>(null);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentReceipt, setConsentReceipt] = useState<ConsentReceipt | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await storeFactory();
        const l = await s.getLearner();
        if (!alive) return;
        setStore(s);
        setLearner(l);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
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
    async (minutes: number) => {
      if (!store) throw new Error('Penyimpanan belum siap');
      // No learner ID and no data without an affirmative consent receipt from this app run.
      if (!consentReceipt || consentReceipt.adult !== true || consentReceipt.agreed !== true) {
        throw new Error('No consent receipt: learner not created');
      }
      const now = new Date().toISOString();
      const l: Learner = {
        learner_id: newId('lrn'),
        created_at: now,
        consent_version: consentReceipt.consent_version,
        consent_at: consentReceipt.at,
        age_confirmed: consentReceipt.adult,
        session_minutes: minutes,
        arabic_scale: 1,
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
    rules,
    content,
    learner,
    consentReceipt,
    giveConsent,
    createLearner,
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
