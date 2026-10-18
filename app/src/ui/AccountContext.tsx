// The local account layer of the developer pilot: sign-in against the Auth emulator (RAM only), the verified server
// account, its own local dataset (chosen only by the verified account ID), an explicit guest copy, the adult profile,
// manual sync through the durable journal and factual account counts. It drives the presentational AccountPanel and
// selects the account's dataset for learning only after an explicit profile choice. Signing out (or another sign-in)
// drops every late result and returns learning to the guest's dataset; nothing stored is deleted.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { loadAccountConfig } from '@/account/config';
import { copyGuestToAccount, GUEST_NAMESPACE, type Namespace, type OpenedAccountDataset, type RawSource } from '@/account/datasets';
import { isCanonicalUuid } from '@/account/ids';
import { openAccountDataset } from '@/account/openAccountDataset';
import { createAccountSession } from '@/account/session';
import { ApiError, createApiClient } from '@/api/client';
import { AuthError, createEmulatorAuth } from '@/auth/emulatorAuth';
import { newId } from '@/engine/util';
import type { RawDataset } from '@/storage/rawRecords';
import type { Store } from '@/storage/types';
import { openJournal, SyncError, type JournalView, type LinkChoice, type SyncConnection, type SyncJournal } from '@/sync/journal';
import type { AccountBusy, AccountMode, AccountPanelProps, AccountProfileChoice, ConnectedProfile } from '@/ui/account/AccountPanel';
import { APP_VERSION, LOCAL_ACCOUNT_CONSENT_VERSION, useApp } from '@/ui/AppContext';

export interface AccountContextValue {
  /** The local account service is configured for this build. */
  enabled: boolean;
  /** A signed-in, verified account. */
  signedIn: boolean;
  /** The signed-in account's dataset is in use for learning. */
  connected: boolean;
  /** Everything the account panel shows and calls back. */
  panel: AccountPanelProps;
}

const noop = () => undefined;
const OFF: AccountContextValue = {
  enabled: false,
  signedIn: false,
  connected: false,
  panel: {
    account: null,
    onSubmit: noop,
    onGuestCopy: noop,
    onGuestSkip: noop,
    onLinkProfile: noop,
    onCreateProfile: noop,
    onSyncNow: noop,
    onKeepLocalPrefs: noop,
    onUseServerPrefs: noop,
    onSignOut: noop,
  },
};

const Ctx = createContext<AccountContextValue>(OFF);

/** The account layer; outside an AccountProvider (or when the service is not configured) it is off. */
export function useAccount(): AccountContextValue {
  return useContext(Ctx);
}

const PREFERENCE_FIELDS = ['session_minutes', 'arabic_scale'] as const;
const PROFILE_LABEL = 'Profil dewasa';
const LOST_RESPONSE = 'Respons layanan akun belum diterima. Jawaban tetap tersimpan di perangkat ini; sinkronkan lagi untuk mengirim ulang permintaan yang sama.';
const ENDED = 'Sesi akun berakhir. Masuk lagi; data di perangkat ini tetap ada.';

/** The sign-in this work belonged to is gone (expired, or ended without this layer's sign-out): sign out visibly. */
const sessionEnded = (e: unknown): boolean => e instanceof AuthError && (e.code === 'expired' || e.code === 'signed_out' || e.code === 'superseded');

/** A fixed message for a sign-in failure: never the server's text, the address or the password. */
function authMessage(e: unknown): string {
  if (e instanceof AuthError) {
    switch (e.code) {
      case 'not_synthetic':
        return 'Pakai alamat email uji yang berakhiran .test.';
      case 'invalid_credentials':
        return 'Email atau kata sandi tidak cocok.';
      case 'email_exists':
        return 'Alamat ini sudah terdaftar di emulator lokal. Pilih «Sudah punya akun».';
      case 'weak_password':
        return 'Kata sandi minimal 6 karakter.';
      case 'network':
        return 'Layanan akun lokal tidak terjangkau. Belajar tetap bisa tanpa akun.';
      case 'expired':
        return ENDED;
      default:
        return 'Belum bisa masuk ke akun lokal. Belajar tetap bisa tanpa akun.';
    }
  }
  if (e instanceof ApiError && (e.code === 'network' || e.code === 'aborted')) return 'Layanan akun lokal tidak terjangkau. Belajar tetap bisa tanpa akun.';
  if (e instanceof ApiError) return 'Layanan akun lokal belum bisa memastikan akun ini. Coba lagi.';
  return 'Akun lokal belum bisa dibuka di perangkat ini. Data di perangkat ini tetap ada.';
}

/** A fixed, truthful status for a sync that stopped; local data is never touched by a failure. */
function syncFailure(e: unknown, view: JournalView): string {
  if (e instanceof ApiError && (e.code === 'network' || e.code === 'aborted')) {
    return view.sources.some((s) => s.frozen !== null) ? LOST_RESPONSE : 'Tidak ada koneksi ke layanan akun lokal. Jawaban tetap tersimpan di perangkat ini.';
  }
  if (e instanceof SyncError) {
    switch (e.code) {
      case 'unverified_receipt':
        return 'Tanda terima layanan akun tidak cocok; belum ada yang dianggap terkirim. Sinkronkan lagi.';
      case 'bad_response':
        return 'Balasan layanan akun tidak dikenali; belum ada yang dianggap terkirim.';
      case 'refused':
        return `Layanan akun menolak permintaan ini (${e.status}). Jawaban tetap tersimpan di perangkat ini.`;
      case 'account_mismatch':
        return 'Akun yang masuk bukan pemilik data ini; tidak ada yang dikirim.';
      default:
        break;
    }
  }
  return 'Sinkronisasi belum selesai. Jawaban tetap tersimpan di perangkat ini.';
}

/** What differs, in the learner's words: this device's choice and the account's. */
function conflictDetail(view: JournalView): string | undefined {
  const server = view.preferenceConflict?.settings;
  if (!server) return undefined;
  const parts: string[] = [];
  const minutes = view.changed.session_minutes;
  if (minutes !== undefined && typeof server.session_minutes === 'number') parts.push(`Lama sesi: ${minutes} menit di perangkat ini, ${server.session_minutes} menit di akun.`);
  const scale = view.changed.arabic_scale;
  if (scale !== undefined && typeof server.arabic_scale === 'number') parts.push(`Ukuran huruf Arab: ${scale}× di perangkat ini, ${server.arabic_scale}× di akun.`);
  return parts.length ? parts.join(' ') : undefined;
}

export function AccountProvider({
  children,
  openDataset = openAccountDataset,
}: {
  children: ReactNode;
  openDataset?: (namespace: Namespace) => Promise<OpenedAccountDataset>;
}) {
  const app = useApp();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  });

  const config = useMemo(() => loadAccountConfig(), []);
  const services = useMemo(() => {
    if (!config.enabled) return null;
    const auth = createEmulatorAuth({ config });
    const api = createApiClient({ baseUrl: config.apiBaseUrl });
    const session = createAccountSession({ auth, api });
    const conn: SyncConnection = { auth, session, api };
    return { auth, api, session, conn };
  }, [config]);

  const [account, setAccount] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState<AccountBusy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestCopy, setGuestCopy] = useState<AccountPanelProps['guestCopy']>(null);
  const [profiles, setProfiles] = useState<AccountProfileChoice[]>([]);
  const [connected, setConnectedState] = useState<ConnectedProfile | null>(null);
  const [prefsConflict, setPrefsConflict] = useState<{ detail?: string } | null>(null);
  const connectedRef = useRef<ConnectedProfile | null>(null);
  const opened = useRef<OpenedAccountDataset | null>(null);
  const journal = useRef<SyncJournal | null>(null);
  /** Each sign-in and sign-out starts a new turn; work of an earlier turn never publishes anything. */
  const turn = useRef(0);

  const setConnected = useCallback((next: ConnectedProfile | null) => {
    connectedRef.current = next;
    setConnectedState(next);
  }, []);

  const actions = useMemo(() => {
    const live = (t: number) => t === turn.current;
    const close = () => {
      const o = opened.current;
      opened.current = null;
      journal.current = null;
      o?.release();
    };
    const clear = () => {
      setAccount(null);
      setGuestCopy(null);
      setProfiles([]);
      setConnected(null);
      setPrefsConflict(null);
    };
    const showConnected = (syncStatus: string) =>
      setConnected({
        label: PROFILE_LABEL,
        syncStatus,
        savedAnswers: connectedRef.current?.savedAnswers ?? 0,
        otherDeviceAnswers: journal.current?.view().remote.length ?? 0,
      });
    /** Learning uses the account's dataset from now on; preference changes go through its journal. */
    const selectAccountDataset = (o: OpenedAccountDataset, j: SyncJournal | null) =>
      appRef.current.selectDataset({
        store: o.store,
        readOnly: o.access === 'owner' ? null : (o.reason ?? 'Akun ini sedang dipakai di tab lain; tab ini hanya bisa membaca.'),
        savePreferences: j
          ? async (patch) => {
              for (const field of PREFERENCE_FIELDS) {
                const value = patch[field];
                if (value !== undefined) await j.setPreference(field, value);
              }
            }
          : undefined,
      });

    async function signOut(message: string | null = null): Promise<void> {
      turn.current += 1;
      if (!services) return;
      setBusy('signout');
      services.auth.signOut();
      await appRef.current.selectDataset(null);
      close();
      clear();
      setError(message);
      setBusy(null);
    }

    async function sync(link: LinkChoice | null): Promise<void> {
      const j = journal.current;
      if (!j || !services) return;
      const t = turn.current;
      setBusy('sync');
      setError(null);
      showConnected('Menyinkronkan…');
      let status: string;
      try {
        const report = await j.sync(services.conn, link);
        const prefs = await j.pushPreferences(services.conn);
        const differs = report.conflicts.length > 0 && report.conflicts.length === report.pending;
        status =
          report.pending > 0
            ? `${report.pending} jawaban belum diterima akun${differs ? ' karena salinannya di akun berbeda' : ''}. Jawaban tetap tersimpan di perangkat ini.`
            : `${report.linked.length ? 'Profil tersambung. ' : ''}Semua jawaban terkirim.`;
        if (prefs === 'conflict') status += ' Pengaturan di akun berbeda; pilih yang dipakai.';
      } catch (e) {
        if (!live(t)) return;
        if (sessionEnded(e)) {
          await signOut(ENDED);
          return;
        }
        status = syncFailure(e, j.view());
      }
      let savedAnswers = connectedRef.current?.savedAnswers ?? 0;
      try {
        savedAnswers = (await j.readProgress(services.conn)).events;
      } catch {
        // Not linked yet, or unreachable: the last known count stays.
      }
      if (!live(t)) return;
      const view = j.view();
      setConnected({ label: PROFILE_LABEL, syncStatus: status, savedAnswers, otherDeviceAnswers: view.remote.length });
      setPrefsConflict(view.preferenceConflict ? { detail: conflictDetail(view) } : null);
      setBusy(null);
    }

    async function submit({ mode, email, password }: { mode: AccountMode; email: string; password: string }): Promise<void> {
      if (!services) return;
      const t = ++turn.current;
      // Learning returns to the guest's dataset (cancelling a selection still loading) before an earlier one is let go.
      await appRef.current.selectDataset(null);
      if (!live(t)) return;
      close();
      clear();
      setError(null);
      setBusy('auth');
      try {
        if (mode === 'create') await services.auth.createSyntheticAccount(email, password);
        else await services.auth.signIn(email, password);
        const verified = await services.session.verify();
        if (!live(t)) return;
        // The dataset is named by the verified account ID only.
        const o = await openDataset(verified.namespace);
        if (!live(t)) {
          o.release();
          return;
        }
        opened.current = o;
        let j: SyncJournal | null = null;
        if (o.access === 'owner') {
          j = await openJournal({ dataset: o, accountId: verified.accountId, appVersion: APP_VERSION });
          await j.reconcile();
          if (!live(t)) return;
          journal.current = j;
        }
        setAccount({ key: `signin-${t}`, label: email });
        const view = j?.view();
        if (!j || !view || view.profileId !== null || view.sources.some((s) => s.frozen !== null)) {
          // Linked before, or its first link is on its way: learning continues in the account's dataset.
          await selectAccountDataset(o, j);
          if (!live(t)) return;
          showConnected(
            !j ? 'Akun ini sedang dipakai di tab lain; tab ini hanya bisa membaca.' : view?.profileId ? 'Belum disinkronkan sejak masuk. Tekan «Sinkronkan sekarang».' : LOST_RESPONSE
          );
        } else {
          const guest = appRef.current.guestStore;
          const answers = guest ? (await guest.listAnswers()).length : 0;
          if (!live(t)) return;
          setGuestCopy(answers > 0 ? { answers } : null);
          setProfiles(verified.profiles.map((p) => ({ id: p.profileId, label: `${PROFILE_LABEL} · ${p.highSeq} jawaban tercatat di akun` })));
        }
        setBusy(null);
      } catch (e) {
        if (!live(t)) return;
        if (services.auth.status().state !== 'signed-out') services.auth.signOut();
        close();
        clear();
        setError(authMessage(e));
        setBusy(null);
      }
    }

    async function copyGuest(): Promise<void> {
      const o = opened.current;
      const j = journal.current;
      const guest = appRef.current.guestStore as (Store & { readRaw?: () => Promise<RawDataset | null> }) | null;
      if (!o || !j || !guest) return;
      const t = turn.current;
      setBusy('guest-copy');
      setError(null);
      try {
        // Read through the open guest store's own queue; written only through the account dataset's owner.
        const source: RawSource = { namespace: GUEST_NAMESPACE, readRaw: () => (guest.readRaw ? guest.readRaw() : Promise.resolve(null)) };
        const result = await copyGuestToAccount({ from: source, to: o.raw, consent: { copyGuestData: true, at: new Date().toISOString() } });
        await j.reconcile();
        if (!live(t)) return;
        setGuestCopy((c) => ({
          answers: c?.answers ?? result.answers,
          result:
            result.answers > 0
              ? `${result.answers} jawaban tamu disalin ke akun ini. Data tamu tetap tersimpan di perangkat ini.`
              : 'Tidak ada jawaban tamu baru untuk disalin. Data tamu tetap tersimpan di perangkat ini.',
        }));
      } catch {
        if (live(t)) setError('Data tamu belum bisa disalin. Data tamu tetap tersimpan di perangkat ini.');
      } finally {
        if (live(t)) setBusy(null);
      }
    }

    function skipGuest(): void {
      setGuestCopy((c) => ({ answers: c?.answers ?? 0, result: 'Data tamu tidak disalin. Data tamu tetap tersimpan di perangkat ini.' }));
    }

    /** The account dataset's own local learner, created only with an explicit consent; an existing learner is kept. */
    async function ensureLearner(o: OpenedAccountDataset, consent: { version: string; at: string }, settings: { session_minutes?: number; arabic_scale?: number } = {}) {
      if (await o.store.getLearner()) return;
      const now = new Date().toISOString();
      await o.store.saveLearner({
        learner_id: newId('lrn'),
        created_at: now,
        consent_version: consent.version,
        consent_at: consent.at,
        age_confirmed: true,
        session_minutes: settings.session_minutes ?? appRef.current.rules.default_session_minutes,
        arabic_scale: settings.arabic_scale ?? 1,
        screens_seen: [],
      });
    }

    async function createProfile(): Promise<void> {
      const o = opened.current;
      const j = journal.current;
      if (!o || !j || !services) return;
      const t = turn.current;
      setBusy('profile');
      setError(null);
      // The consent ticked in this panel, under its own version (not the guest's device-only consent).
      const consent = { version: LOCAL_ACCOUNT_CONSENT_VERSION, at: new Date().toISOString() };
      try {
        await ensureLearner(o, consent);
        await selectAccountDataset(o, j);
      } catch {
        if (live(t)) {
          setError('Profil belum bisa disiapkan. Data di perangkat ini tetap ada.');
          setBusy(null);
        }
        return;
      }
      if (!live(t)) return;
      await sync({ kind: 'new-profile', consent });
    }

    async function linkProfile(profileId: string): Promise<void> {
      const o = opened.current;
      const j = journal.current;
      if (!o || !j || !services) return;
      const t = turn.current;
      setBusy('profile');
      setError(null);
      try {
        if (!(await o.store.getLearner())) {
          // A device joining one of the account's adult profiles records that profile's consent and settings locally.
          if (!isCanonicalUuid(profileId)) throw new Error('not a profile ID');
          const reply = await services.auth.authorized(async (token, signal) => {
            const r = await services.api.request({ method: 'GET', path: `/v1/profiles/${profileId}`, token, signal });
            if (r.status === 401) throw new ApiError(401, 'unauthenticated'); // the auth layer reports it as expired
            return r;
          });
          const doc = reply.status === 200 ? (JSON.parse(reply.text) as { consent?: { version?: unknown; at?: unknown }; settings?: Record<string, unknown> }) : null;
          const version = doc?.consent?.version;
          const at = doc?.consent?.at;
          if (typeof version !== 'string' || typeof at !== 'string') throw new Error('profile without consent');
          const s = doc?.settings ?? {};
          const minutes = s.session_minutes;
          const scale = s.arabic_scale;
          await ensureLearner(
            o,
            { version, at },
            {
              session_minutes: typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : undefined,
              arabic_scale: typeof scale === 'number' && scale >= 0.8 && scale <= 2 ? scale : undefined,
            }
          );
        }
        await selectAccountDataset(o, j);
      } catch (e) {
        if (!live(t)) return;
        if (sessionEnded(e)) {
          await signOut(ENDED);
          return;
        }
        setError('Profil belum bisa dihubungkan. Data di perangkat ini tetap ada.');
        setBusy(null);
        return;
      }
      if (!live(t)) return;
      await sync({ kind: 'own-profile', profileId });
    }

    async function resolvePrefs(choice: 'keep-local' | 'use-server'): Promise<void> {
      const j = journal.current;
      if (!j) return;
      const t = turn.current;
      setBusy('prefs');
      setError(null);
      try {
        await j.resolvePreferences(choice);
        if (choice === 'use-server') await appRef.current.refreshLearner();
        if (!live(t)) return;
        setPrefsConflict(null);
        const c = connectedRef.current;
        if (c) {
          setConnected({
            ...c,
            syncStatus:
              choice === 'keep-local'
                ? 'Pilihan disimpan: pengaturan perangkat ini dipakai. Tekan «Sinkronkan sekarang» untuk mengirimnya.'
                : 'Pengaturan akun dipakai di perangkat ini.',
          });
        }
      } catch {
        if (live(t)) setError('Pilihan pengaturan belum tersimpan.');
      } finally {
        if (live(t)) setBusy(null);
      }
    }

    return { signOut, sync, submit, copyGuest, skipGuest, createProfile, linkProfile, resolvePrefs };
  }, [services, openDataset, setConnected]);

  // Leaving the app run (unmount) drops all account work and lets go of the account dataset; nothing is deleted.
  useEffect(
    () => () => {
      turn.current += 1;
      const o = opened.current;
      opened.current = null;
      journal.current = null;
      o?.release();
    },
    []
  );

  const value: AccountContextValue = services
    ? {
        enabled: true,
        signedIn: account !== null,
        connected: connected !== null,
        panel: {
          account,
          busy,
          error,
          guestCopy,
          profiles,
          connected,
          prefsConflict,
          onSubmit: (request) => void actions.submit(request),
          onGuestCopy: () => void actions.copyGuest(),
          onGuestSkip: actions.skipGuest,
          onLinkProfile: (id) => void actions.linkProfile(id),
          onCreateProfile: () => void actions.createProfile(),
          onSyncNow: () => void actions.sync(null),
          onKeepLocalPrefs: () => void actions.resolvePrefs('keep-local'),
          onUseServerPrefs: () => void actions.resolvePrefs('use-server'),
          onSignOut: () => void actions.signOut(),
        },
      }
    : OFF;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
