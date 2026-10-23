// The local account layer of the developer pilot: password sign-in to the local Supabase Auth server through its
// maintained SDK (prepared accounts only, RAM only) and, where the build turns it on, Continue with Google through the
// same Auth server; the verified server account, its own local dataset (chosen only by the verified account ID), an
// explicit guest copy, the adult profile, manual sync through the durable journal and factual account counts. It drives
// the presentational AccountPanel and selects the account's dataset for learning only after an explicit profile choice;
// a Google identity is never consent. Both sign-ins end in the same verification and dataset opening. An expired session
// is refreshed before anything is verified or synced. Signing out (or another sign-in) drops every late result and
// returns learning to the guest's dataset at once; nothing stored is deleted. In a staging build (the validated
// configuration's staging profile) the same layer reaches the staging Auth server and API, names the remote staging
// server wherever it named the local service, and records the staging consent version for a new adult profile.
// Where a native build turns it on (EXPO_PUBLIC_REMEMBER_DEVICE=on, with the device's secure session vault), the learner
// may tick the choice to remember an email sign-in. It is saved only after the account API verified the account, and
// let go without a logout when the app run ends. The next run restores it through one refresh grant and continues as
// after a password sign-in, for the same verified account only. Signing out forgets it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { copyGuestToAccount, GUEST_NAMESPACE, type Namespace, type OpenedAccountDataset, type RawSource } from '@/account/datasets';
import { loadGoogleConfig } from '@/account/googleConfig';
import { isCanonicalUuid } from '@/account/ids';
import { openAccountDataset } from '@/account/openAccountDataset';
import { rememberDeviceEnabled } from '@/account/rememberConfig';
import { createAccountSession, exportOwnAccountData } from '@/account/session';
import { STAGING } from '@/account/staging';
import { loadSupabaseConfig } from '@/account/supabaseConfig';
import { ApiError, createAccountControls, createApiClient } from '@/api/client';
import type { PendingGoogleStore } from '@/auth/google';
import type { GoogleBrowser, GoogleBrowserResult } from '@/auth/googleBrowser';
import { deviceGoogleBrowser, deviceGoogleStore } from '@/auth/googleDevice';
import { prepareRecovery, type RecoveryAttemptStore, type RecoveryRuntime } from '@/auth/recoverySetup';
import { deviceSessionVault } from '@/auth/sessionVault';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthIdentity, type SessionVault } from '@/auth/types';
import { newId } from '@/engine/util';
import type { RawDataset } from '@/storage/rawRecords';
import type { Store } from '@/storage/types';
import { openJournal, SyncError, type JournalView, type LinkChoice, type SyncConnection, type SyncJournal } from '@/sync/journal';
import type { AccountBusy, AccountMode, AccountPanelProps, AccountProfileChoice, ConnectedProfile } from '@/ui/account/AccountPanel';
import { APP_VERSION, LOCAL_ACCOUNT_CONSENT_VERSION, STAGING_ACCOUNT_CONSENT_VERSION, useApp } from '@/ui/AppContext';
import { usePasswordRecovery } from '@/ui/usePasswordRecovery';

export interface AccountContextValue {
  /** The account service (the local one, or a staging build's staging server) is configured for this build. */
  enabled: boolean;
  /** A signed-in, verified account. */
  signedIn: boolean;
  /** The signed-in account's dataset is in use for learning. */
  connected: boolean;
  /** Everything the account panel shows and calls back. */
  panel: AccountPanelProps;
  /** The signed-in, verified account's own server data; absent while signed out or before verification. */
  dataControls?: AccountDataControls;
}

/** The signed-in account's server data as its server keeps it: never the guest's data or this device's unsent records. */
export interface AccountDataControls {
  /**
   * After a fresh password sign-in with `password`, the verified account's server export (GET /v1/me/export) as the
   * server's exact text. One account data operation at a time: another is refused before anything is sent.
   */
  exportData(password: string): Promise<{ accountId: string; json: string }>;
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

/**
 * The account service as this layer's messages name it, and the version its adult-profile consent records: the local
 * account service by default, or the remote staging server under the validated configuration's staging profile.
 */
interface AccountService {
  /** Mid-sentence, e.g. «layanan akun lokal». */
  name: string;
  /** Mid-sentence, e.g. «akun lokal». */
  account: string;
  consentVersion: string;
}
const LOCAL_SERVICE: AccountService = { name: 'layanan akun lokal', account: 'akun lokal', consentVersion: LOCAL_ACCOUNT_CONSENT_VERSION };
const STAGING_SERVICE: AccountService = { name: 'server akun staging', account: 'akun staging', consentVersion: STAGING_ACCOUNT_CONSENT_VERSION };
/**
 * The production account service. Its consent version is a distinct, UNREVIEWED draft marker for keeping a learner's
 * answers and settings on the server: it needs the owner's and a privacy review's approval before any release, and a
 * production profile never records the local or staging consent instead.
 */
const PRODUCTION_SERVICE: AccountService = { name: 'layanan akun', account: 'akun', consentVersion: 'draft-production-account-sync-consent-0.1' };

/** `text` starting a sentence. */
const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const notRevoked = (s: AccountService) => `Sudah keluar di perangkat ini, tetapi ${s.name} belum memastikan sesinya dicabut. Data di perangkat ini tetap ada.`;
const offline = (s: AccountService) => `Tidak ada koneksi ke ${s.name}. Jawaban tetap tersimpan di perangkat ini.`;

// A remembered email sign-in, in fixed words that never claim more than the vault confirmed.
const REMEMBER_NOT_SAVED = 'Masuk berhasil, tetapi sesi ini tidak bisa diingat di perangkat ini. Setelah aplikasi ditutup, masuk lagi dengan email dan kata sandi.';
const REMEMBERED_MISMATCH = 'Sesi yang diingat tidak cocok dengan akun yang diverifikasi, jadi tidak dipakai. Masuk lagi dengan email dan kata sandi.';
const REMEMBERED_ENDED = 'Sesi yang diingat sudah tidak berlaku. Masuk lagi dengan email dan kata sandi; data di perangkat ini tetap ada.';
const NOT_FORGOTTEN = 'Sesi yang diingat belum bisa dihapus dari penyimpanan aman perangkat ini.';
const rememberedOffline = (s: AccountService) =>
  `${upperFirst(s.name)} tidak terjangkau. Sesi yang diingat tetap tersimpan di perangkat ini; buka aplikasi lagi nanti untuk mencobanya.`;

/** The sign-in this work belonged to is gone (expired, or ended without this layer's sign-out): sign out visibly. */
const sessionEnded = (e: unknown): boolean => e instanceof AuthError && (e.code === 'expired' || e.code === 'signed_out' || e.code === 'superseded');

/** A fixed message for a sign-in failure at service `s`: never the server's text, the address or the password. */
function authMessage(e: unknown, s: AccountService): string {
  const unreachable = `${upperFirst(s.name)} tidak terjangkau. Belajar tetap bisa tanpa akun.`;
  if (e instanceof AuthError) {
    switch (e.code) {
      case 'not_synthetic':
        return 'Pakai alamat email uji yang berakhiran .test.';
      case 'invalid_email':
        return 'Periksa alamat email.';
      case 'invalid_credentials':
        return 'Email atau kata sandi tidak cocok.';
      case 'network':
        return unreachable;
      case 'expired':
        return ENDED;
      case 'cancelled':
        return 'Masuk dengan Google dibatalkan. Belajar tetap bisa tanpa akun.';
      case 'not_registered':
        return `Akun Google ini belum terdaftar di ${s.name}, dan pendaftaran baru tidak tersedia. Belajar tetap bisa tanpa akun.`;
      case 'bad_callback':
        return 'Masuk dengan Google tidak bisa diselesaikan. Mulai lagi dari tombol Google; data di perangkat ini tetap ada.';
      case 'provider_refused':
        return `Google atau ${s.name} menolak permintaan masuk ini. Coba lagi nanti; belajar tetap bisa tanpa akun.`;
      case 'unavailable':
        return 'Masuk dengan Google belum bisa dipakai di perangkat ini. Belajar tetap bisa tanpa akun.';
      case 'not_forgotten':
        // Refused before anything was sent for it: never a claim that the earlier sign-in was forgotten.
        return `${NOT_FORGOTTEN} Jadi masuk ini tidak dilanjutkan. Coba lagi nanti; data di perangkat ini tetap ada.`;
      default:
        return `Belum bisa masuk ke ${s.account}. Belajar tetap bisa tanpa akun.`;
    }
  }
  if (e instanceof ApiError && (e.code === 'network' || e.code === 'aborted')) return unreachable;
  if (e instanceof ApiError) return `${upperFirst(s.name)} belum bisa memastikan akun ini. Coba lagi.`;
  return `${upperFirst(s.account)} belum bisa dibuka di perangkat ini. Data di perangkat ini tetap ada.`;
}

/** A fixed, truthful status for a sync with service `s` that stopped; local data is never touched by a failure. */
function syncFailure(e: unknown, view: JournalView, s: AccountService): string {
  if (e instanceof ApiError && (e.code === 'network' || e.code === 'aborted')) {
    return view.sources.some((source) => source.frozen !== null) ? LOST_RESPONSE : offline(s);
  }
  // The session could not be refreshed for now: nothing was sent, and it may be tried again.
  if (e instanceof AuthError && e.code === 'network') return offline(s);
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

/** The verified account a published view belongs to: its own ID and provider user, never derived from an address. */
interface Binding {
  accountId: string;
  uid: string;
  /** The dataset handle the view was published with. */
  opened: OpenedAccountDataset;
  /** Set once the sign-in that published the view has finished its own work. */
  ready: boolean;
}

export function AccountProvider({
  children,
  openDataset = openAccountDataset,
  googleBrowser,
  googleStore,
  sessionVault,
  recoveryRuntime,
  recoveryStore,
}: {
  children: ReactNode;
  openDataset?: (namespace: Namespace) => Promise<OpenedAccountDataset>;
  /** Continue with Google's OS/browser boundary; the platform's own by default. */
  googleBrowser?: GoogleBrowser;
  /** The short-lived store of a pending Google attempt; the platform's own by default. */
  googleStore?: PendingGoogleStore;
  /**
   * Where a remembering build remembers an email sign-in: the platform's own secure vault by default (the web has
   * none). Null turns remembering off.
   */
  sessionVault?: SessionVault | null;
  /** Password recovery's link boundary, in a build that turns recovery on: the platform's own by default. Null turns it off. */
  recoveryRuntime?: RecoveryRuntime | null;
  /**
   * The short-lived store of a pending recovery attempt: the platform's own by default. Without one (null included),
   * a recovery link is still recognized, but recovery cannot go on.
   */
  recoveryStore?: RecoveryAttemptStore | null;
}) {
  const app = useApp();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  });

  const config = useMemo(() => loadSupabaseConfig(), []);
  // The validated configuration's own profile (never a guess from an address): 'staging' in a staging build, 'production'
  // in a production one, else absent.
  const environment = config.enabled ? config.environment : undefined;
  const service = environment === 'production' ? PRODUCTION_SERVICE : environment === STAGING ? STAGING_SERVICE : LOCAL_SERVICE;
  // Continue with Google: only with the account service on, in a build that turns it on, where its platform can run it.
  const google = useMemo(() => {
    if (!config.enabled) return null;
    const browser = googleBrowser ?? deviceGoogleBrowser();
    if (!browser) return null;
    const settings = loadGoogleConfig(browser.platform);
    if (!settings.enabled) return null;
    const store = googleStore ?? deviceGoogleStore();
    return store ? { browser, settings, store } : null;
  }, [config, googleBrowser, googleStore]);
  // Remembering an email sign-in: only with the account service on, in a build that turns it on, with a secure vault.
  const vault = useMemo(() => {
    if (!config.enabled || !rememberDeviceEnabled()) return null;
    return sessionVault === undefined ? deviceSessionVault() : sessionVault;
  }, [config, sessionVault]);
  // Password recovery: only with the account service on, in a build that turns it on, with a callback this profile may use.
  const recoverySetup = useMemo(() => prepareRecovery(config, recoveryRuntime, recoveryStore), [config, recoveryRuntime, recoveryStore]);
  const services = useMemo(() => {
    if (!config.enabled) return null;
    // The platform's fetch as this provider found it: a sign-out still on its way after leaving uses the same one.
    const auth = createSupabaseAuth({
      config,
      fetch: globalThis.fetch,
      google: google ? { config: google.settings, store: google.store } : undefined,
      ...(vault ? { remember: { vault } } : {}),
      // Without a pending-attempt store the Auth adapter gets no recovery; recoverySetup still recognizes its links.
      ...(recoverySetup?.store ? { recovery: { config: recoverySetup.config, store: recoverySetup.store } } : {}),
    });
    // The API client revalidates its address under the same profile the Auth adapter takes from `config`.
    const api = createApiClient({ baseUrl: config.apiBaseUrl, environment: config.environment, productionAccounts: config.productionAccounts });
    const session = createAccountSession({ auth, api });
    const conn: SyncConnection = { auth, session, api };
    return { auth, api, session, conn, google };
  }, [config, google, vault, recoverySetup]);

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
  /** The verified account of the published view, kept through an ordinary expiry; it goes with the view. */
  const binding = useRef<Binding | null>(null);
  /** The one account data operation under way, if any: another is refused before anything is sent. */
  const dataOp = useRef<object | null>(null);
  /** Whether this run already looked for its web Google callback (a page has one launch URL, taken once). */
  const resumed = useRef(false);
  /** Whether this run already looked for a remembered email sign-in (once per run). */
  const restored = useRef(false);
  /** Whether this run did normal sign-in work (a sign-in, a sign-out or a remembered restore): only then does leaving end it. */
  const normalWork = useRef(false);
  /** The signed-in account as last rendered, for recovery's fence (read after render only). */
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  // Password recovery, through its own controller only: off (touching nothing) unless recoverySetup gave a runtime.
  const recoveryControl = usePasswordRecovery({
    recovery: services?.auth.recovery,
    runtime: recoverySetup?.runtime ?? null,
    callbackUrl: recoverySetup?.config.callbackUrl ?? null,
  });
  /** Recovery began while signed out: a normal sign-in still on its way publishes nothing more. A verified account stays. */
  const onRecoveryIntent = useCallback(() => {
    if (accountRef.current !== null) return;
    turn.current += 1;
    setBusy(null);
    setError(null);
  }, []);
  const { setIntentHandler, normalStarting: recoveryNormalStarting } = recoveryControl;
  // Bound after render: the fence reads refs.
  useEffect(() => {
    setIntentHandler(onRecoveryIntent);
    return () => setIntentHandler(undefined);
  }, [setIntentHandler, onRecoveryIntent]);

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
      binding.current = null;
      dataOp.current = null;
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

    /**
     * Ends the sign-in at once: its work stops, no token is handed out again, a remembered sign-in is forgotten and
     * learning returns to the guest's dataset. Then, unless another sign-in has started meanwhile, it says when the
     * provider did not confirm the revocation, or when the secure vault would not let go of a remembered sign-in.
     */
    async function signOut(message: string | null = null): Promise<void> {
      normalWork.current = true;
      recoveryNormalStarting();
      const t = ++turn.current;
      if (!services) return;
      const hadSession = services.auth.status().state !== 'signed-out';
      const revocation = services.auth.signOut();
      setBusy('signout');
      await appRef.current.selectDataset(null);
      close();
      clear();
      setError(message);
      setBusy(null);
      const { revoked, forgotten } = await revocation;
      if (!live(t)) return;
      if (forgotten === false) {
        setError(`${message ?? (hadSession && !revoked ? notRevoked(service) : 'Sudah keluar di perangkat ini.')} ${NOT_FORGOTTEN}`);
      } else if (hadSession && !revoked && message === null) {
        setError(notRevoked(service));
      }
    }

    /**
     * Before verifying or syncing: an expired session is refreshed through the provider (same account and session),
     * then verified again if its verification lapsed with the expiry. Rejects as the refresh or the verification does.
     */
    async function ensureFresh(): Promise<void> {
      if (!services) return;
      if (services.auth.status().state === 'expired') await services.auth.refresh();
      if (!services.session.current()) await services.session.verify();
    }

    /** The sign-in this work belonged to is gone (expired, refused, replaced or signed out): sign out visibly. */
    const ended = (e: unknown) => sessionEnded(e) || services?.auth.status().state === 'signed-out';

    async function sync(link: LinkChoice | null): Promise<void> {
      const j = journal.current;
      // Nothing ordinary starts while an account data operation is under way.
      if (!j || !services || dataOp.current) return;
      const t = turn.current;
      setBusy('sync');
      setError(null);
      showConnected('Menyinkronkan…');
      let status: string;
      try {
        await ensureFresh();
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
        if (ended(e)) {
          await signOut(ENDED);
          return;
        }
        status = syncFailure(e, j.view(), service);
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

    /**
     * Starts a sign-in turn, password or Google: a newer turn (or a sign-out) drops every result of this one. Learning
     * returns to the guest's dataset (cancelling a selection still loading) before an earlier one is let go, and nothing
     * of the earlier account work stays shown. Null when another turn started meanwhile.
     */
    async function beginSignIn(): Promise<number | null> {
      normalWork.current = true;
      recoveryNormalStarting();
      const t = ++turn.current;
      await appRef.current.selectDataset(null);
      if (!live(t)) return null;
      close();
      clear();
      setError(null);
      setBusy('auth');
      return t;
    }

    /**
     * After the sign-in of turn `t`, whichever provider: the account API verifies it (GET /v1/me) and the account's own
     * dataset opens, named by the verified account ID only; the panel shows the signed-in identity's address and nothing
     * else of it. Linked before (or its first link on its way): learning continues in the account's dataset. Otherwise the
     * adult profile, its consent and any guest copy wait for the learner's explicit choices: no sign-in, a Google one
     * included, consents, creates a profile or copies guest data by itself. Rejects as the verification or opening does.
     * With `save`, a ticked email sign-in is remembered once verified, before anything opens. If the vault refuses, the
     * sign-in goes on unremembered, with a fixed message. With `restoredFor`, a restored sign-in must verify as exactly
     * that account. If not, it is signed out (forgotten and revoked) before either account's dataset opens.
     */
    async function afterSignIn(t: number, identity: AuthIdentity, { save = false, restoredFor = null }: { save?: boolean; restoredFor?: string | null } = {}): Promise<void> {
      if (!services) return;
      const verified = await services.session.verify();
      if (!live(t)) return;
      if (restoredFor !== null && verified.accountId !== restoredFor) {
        await signOut(REMEMBERED_MISMATCH);
        return;
      }
      let notSaved = false;
      if (save) {
        const remembered = services.auth.remembered;
        notSaved = !(remembered && (await remembered.save(verified.accountId)));
        if (!live(t)) return;
      }
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
      // The view is published for this verified account only: its own ID and provider user, and its own handle.
      const bound: Binding = { accountId: verified.accountId, uid: verified.uid, opened: o, ready: false };
      binding.current = bound;
      setAccount({ key: `signin-${t}`, label: identity.email });
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
      bound.ready = true;
      setBusy(null);
      if (notSaved) setError(REMEMBER_NOT_SAVED);
    }

    /** The sign-in of turn `t` failed: a session it made is signed out, nothing of it stays, and a fixed message says why. */
    function signInFailed(t: number, e: unknown): void {
      if (!services || !live(t)) return;
      if (services.auth.status().state !== 'signed-out') void services.auth.signOut();
      close();
      clear();
      setError(authMessage(e, service));
      setBusy(null);
    }

    /**
     * A password sign-in to a prepared account: the provider has sign-up off, so every submit signs in. It is remembered
     * only when the learner ticked the choice.
     */
    async function submit({ email, password, remember = false }: { mode: AccountMode; email: string; password: string; remember?: boolean }): Promise<void> {
      if (!services) return;
      const t = await beginSignIn();
      if (t === null) return;
      try {
        await afterSignIn(t, await services.auth.signIn(email, password), { save: remember });
      } catch (e) {
        signInFailed(t, e);
      }
    }

    /**
     * A new run, once: a remembered email sign-in is restored through one refresh grant. No turn starts until it is,
     * so the learner may type meanwhile, and a sign-in they start wins. It then continues as after a password sign-in,
     * provided the account API verifies the account it was remembered for.
     * - Unreachable: the record stays for a later run.
     * - Refused or no longer valid: the record is gone, and a fixed message says the session no longer counts.
     */
    async function restoreRemembered(): Promise<void> {
      const remembered = services?.auth.remembered;
      if (!remembered) return;
      normalWork.current = true;
      const started = turn.current;
      let restoredSignIn: { identity: AuthIdentity; accountId: string } | null;
      try {
        restoredSignIn = await remembered.restore();
      } catch (e) {
        if (!live(started) || (e instanceof AuthError && (e.code === 'signed_out' || e.code === 'superseded'))) return;
        setError(e instanceof AuthError && e.code === 'network' ? rememberedOffline(service) : REMEMBERED_ENDED);
        return;
      }
      if (!restoredSignIn || !live(started)) return;
      const t = await beginSignIn();
      if (t === null) return;
      try {
        await afterSignIn(t, restoredSignIn.identity, { restoredFor: restoredSignIn.accountId });
      } catch (e) {
        if (live(t) && e instanceof ApiError && (e.code === 'network' || e.code === 'aborted')) {
          // The account API is unreachable for now: the restored session is let go without a logout, its record kept.
          await remembered.release();
          if (!live(t)) return;
          close();
          clear();
          setError(rememberedOffline(service));
          setBusy(null);
          return;
        }
        signInFailed(t, e);
      }
    }

    /**
     * Continue with Google, a sign-in turn of its own. The adapter records the attempt, and only then does the platform's
     * browser open. Native: the auth session comes back with its callback, which is completed only while this turn is still
     * the latest (a callback arriving after another sign-in or a sign-out is never exchanged), then signs in as above. Web:
     * the page leaves for Google, and the next page load resumes the attempt (resumeGoogle). A browser closed without a
     * callback ends the attempt with a fixed message.
     */
    async function continueWithGoogle(): Promise<void> {
      const googleSignIn = services?.auth.google;
      const browser = services?.google?.browser;
      if (!googleSignIn || !browser) return;
      const t = await beginSignIn();
      if (t === null) return;
      try {
        const attempt = await googleSignIn.start();
        if (!live(t)) {
          attempt.cancel();
          return;
        }
        let result: GoogleBrowserResult;
        try {
          result = await browser.open(attempt.url, attempt.callbackUrl);
        } catch {
          attempt.cancel();
          throw new AuthError('unavailable');
        }
        if (!live(t) || result.type !== 'callback') {
          // Closed without a callback, or too late: the attempt ends, and nothing the browser brought back is exchanged.
          attempt.cancel();
          if (live(t)) throw new AuthError('cancelled');
          return;
        }
        await afterSignIn(t, await attempt.complete(result.url));
      } catch (e) {
        signInFailed(t, e);
      }
    }

    /**
     * A fresh web page, once: the Google callback it was loaded with (taken once; the boundary also removes it from the
     * address bar) completes the attempt this tab recorded before leaving, as a sign-in turn of its own. A missing,
     * replayed, foreign or expired one is refused with a fixed message. Loaded without a callback, any recorded attempt
     * just ends. Native never resumes here: its attempt belongs to the run that started it.
     */
    async function resumeGoogle(): Promise<void> {
      const googleSignIn = services?.auth.google;
      const settings = services?.google?.settings;
      const browser = services?.google?.browser;
      if (!googleSignIn || !settings || !browser || settings.platform !== 'web') return;
      const launchUrl = browser.takeLaunchUrl(settings.callbackUrl);
      if (launchUrl === null) {
        void googleSignIn.resume(null).catch(noop);
        return;
      }
      const t = await beginSignIn();
      if (t === null) return;
      try {
        const identity = await googleSignIn.resume(launchUrl);
        if (!identity) throw new AuthError('bad_callback');
        await afterSignIn(t, identity);
      } catch (e) {
        signInFailed(t, e);
      }
    }

    async function copyGuest(): Promise<void> {
      const o = opened.current;
      const j = journal.current;
      const guest = appRef.current.guestStore as (Store & { readRaw?: () => Promise<RawDataset | null> }) | null;
      if (!o || !j || !guest || dataOp.current) return;
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
      if (dataOp.current) return;
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
      if (!o || !j || !services || dataOp.current) return;
      const t = turn.current;
      setBusy('profile');
      setError(null);
      // The consent ticked in this panel, under its own version (not the guest's device-only consent): the local
      // account's, or in a staging build the staging one, whose statement names the remote staging server.
      const consent = { version: service.consentVersion, at: new Date().toISOString() };
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
      if (!o || !j || !services || dataOp.current) return;
      const t = turn.current;
      setBusy('profile');
      setError(null);
      try {
        if (!(await o.store.getLearner())) {
          // A device joining one of the account's adult profiles records that profile's consent and settings locally.
          if (!isCanonicalUuid(profileId)) throw new Error('not a profile ID');
          await ensureFresh();
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
        if (ended(e)) {
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
      if (!j || dataOp.current) return;
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

    /**
     * The verified account's server export after a fresh password sign-in, as the server's exact text: one data operation
     * at a time, for the account this view was published for only, and refused before anything is sent otherwise. It
     * starts a turn of its own, so earlier sync or preference work publishes nothing more, and a newer sign-in or a
     * sign-out drops it. A refused password or an unreachable service rejects as it did, and the view and its data stay.
     * Nothing is signed out, remembered, erased, copied or synced; the server's recent-password check decides.
     */
    async function exportData(password: string): Promise<{ accountId: string; json: string }> {
      const bound = binding.current;
      if (!services || !bound || opened.current !== bound.opened) throw new AuthError('signed_out');
      if (!bound.ready || dataOp.current) throw new Error('Another account request is still on its way; nothing was sent.');
      const op = {};
      dataOp.current = op;
      normalWork.current = true;
      recoveryNormalStarting();
      const t = ++turn.current;
      /** This very view is still shown, in this operation's own turn. */
      const ownView = () => live(t) && binding.current === bound && opened.current === bound.opened;
      const isCurrent = () => ownView() && dataOp.current === op;
      /** The sign-in in use belongs to another provider user, or verifies as another account. */
      const ownerChanged = () => {
        const now = services.auth.status();
        const verifiedNow = services.session.current();
        return (now.state !== 'signed-out' && now.identity.uid !== bound.uid) || (verifiedNow !== null && verifiedNow.accountId !== bound.accountId);
      };
      setBusy('data');
      setError(null);
      try {
        const result = await exportOwnAccountData({
          auth: services.auth,
          session: services.session,
          expected: { accountId: bound.accountId, uid: bound.uid },
          controls: createAccountControls(services.api, bound.accountId),
          password,
          isCurrent,
        });
        if (!isCurrent()) throw new AuthError('superseded');
        return result;
      } catch (e) {
        // This view still shown, but no longer its owner's sign-in: it fails closed. Learning returns to the guest's
        // dataset and only this view's own handle is let go; the session is left as it is, and a newer sign-in's view,
        // handle and session are never touched.
        if (ownView() && ownerChanged()) {
          await appRef.current.selectDataset(null);
          if (ownView()) {
            close();
            clear();
          }
        }
        throw e;
      } finally {
        // Only this operation's own turn ends what it started: a newer sign-in or a sign-out owns the panel from then on.
        if (dataOp.current === op) dataOp.current = null;
        if (live(t)) setBusy(null);
      }
    }

    return { signOut, sync, submit, restoreRemembered, continueWithGoogle, resumeGoogle, copyGuest, skipGuest, createProfile, linkProfile, resolvePrefs, exportData };
  }, [services, service, openDataset, setConnected, recoveryNormalStarting]);
  const dataControls = useMemo<AccountDataControls>(() => ({ exportData: actions.exportData }), [actions]);

  // Leaving the app run (unmount) drops all account work and lets go of the account dataset; nothing is deleted. Its
  // session is signed out, since no later run could use it. A remembered email sign-in is the exception: it is let go
  // without a logout, and its record is kept for the next run. With recovery on, a run that did no normal sign-in work
  // leaves the Auth adapter alone, so a remembered sign-in or pending Google attempt it never touched stays as it was
  // (recovery ends its own session itself).
  useEffect(
    () => () => {
      turn.current += 1;
      binding.current = null;
      dataOp.current = null;
      const auth = services?.auth;
      if (!recoverySetup || normalWork.current) void (auth?.remembered ? auth.remembered.release() : auth?.signOut());
      const o = opened.current;
      opened.current = null;
      journal.current = null;
      o?.release();
    },
    [services, recoverySetup]
  );

  // Both automatic startups below wait until recovery knows its launch link, and stay off once one came (or could not be read).
  const { allowNormalStartup, canAutoStart } = recoveryControl;

  // A fresh web page resumes the Google callback it was loaded with, once, after the app has opened the guest's dataset.
  useEffect(() => {
    if (!app.ready || !allowNormalStartup || !canAutoStart() || resumed.current) return;
    resumed.current = true;
    void actions.resumeGoogle();
  }, [app.ready, allowNormalStartup, canAutoStart, actions]);

  // A new run restores a remembered email sign-in, once, after the app has opened the guest's dataset.
  useEffect(() => {
    if (!app.ready || !allowNormalStartup || !canAutoStart() || restored.current) return;
    restored.current = true;
    void actions.restoreRemembered();
  }, [app.ready, allowNormalStartup, canAutoStart, actions]);

  const value: AccountContextValue = services
    ? {
        enabled: true,
        signedIn: account !== null,
        connected: connected !== null,
        // Only for a signed-in, verified account: its own server data, never the guest's.
        ...(account !== null ? { dataControls } : {}),
        panel: {
          account,
          busy,
          error,
          guestCopy,
          profiles,
          connected,
          prefsConflict,
          signUp: false,
          environment,
          // Only in a remembering build with a secure vault: the choice to remember an email sign-in, never a Google one.
          ...(services.auth.remembered ? { rememberChoice: true } : {}),
          // Only in a build that turns recovery on, with a runtime for its links: its own flow, never a normal sign-in.
          ...(recoveryControl.panel ? { recovery: recoveryControl.panel } : {}),
          onSubmit: (request) => void actions.submit(request),
          // Only where the build turns Google on, with the account service, and the platform can run its browser and store.
          onGoogle: services.google && services.auth.google ? () => void actions.continueWithGoogle() : undefined,
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
