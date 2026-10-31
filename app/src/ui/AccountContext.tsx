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
// Where a local or staging build turns it on, a signed-out learner may register and confirm a test account; that never
// signs in. A normal sign-in, sign-out, remembered restore or recovery ends any registration under way.
// A learning-beta build (its validated profile, which refuses registration, Google and recovery) is ordinary email sign-in
// to its own beta server only: the API client gets its learning-beta capability, the messages name the beta server, and a
// new adult profile records its own unreviewed draft consent version. It is not a production service.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createAccountDeletionController, type AccountDeletionController, type AccountDeletionState } from '@/account/accountDeletion';
import { accountNamespace, copyGuestToAccount, GUEST_NAMESPACE, type Namespace, type OpenedAccountDataset, type RawSource } from '@/account/datasets';
import { loadGoogleConfig } from '@/account/googleConfig';
import { isCanonicalUuid } from '@/account/ids';
import { LEARNING_BETA } from '@/account/learningBeta';
import { openAccountDataset } from '@/account/openAccountDataset';
import { PRIVATE_QA } from '@/account/privateQa';
import { rememberDeviceEnabled } from '@/account/rememberConfig';
import { createAccountSession, exportOwnAccountData } from '@/account/session';
import { STAGING } from '@/account/staging';
import { loadSupabaseConfig } from '@/account/supabaseConfig';
import { ApiError, createAccountControls, createApiClient, discoverOwnAccountDeletion, type AccountDeletion } from '@/api/client';
import { missingWebCrypto, type PendingGoogleStore } from '@/auth/google';
import type { GoogleBrowser, GoogleBrowserResult } from '@/auth/googleBrowser';
import { deviceGoogleBrowser, deviceGoogleStore } from '@/auth/googleDevice';
import { devicePrivateQaNetwork } from '@/auth/privateQaDevice';
import type { PrivateQaNetworkFailure } from '@/auth/privateQaNetwork';
import { prepareRecovery, type RecoveryAttemptStore, type RecoveryRuntime } from '@/auth/recoverySetup';
import { deviceSessionVault } from '@/auth/sessionVault';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthIdentity, type SessionVault } from '@/auth/types';
import { localDate, newId } from '@/engine/util';
import { drainPilotAnswers, PILOT_META_KEY } from '@/pilot/unitA/capture';
import { adoptGuestPilot, hasGuestPilotProgress, type GuestPilotAdoption } from '@/pilot/unitA/guestImport';
import { runCheckpoints } from '@/storage/checkpoints';
import type { RawDataset } from '@/storage/rawRecords';
import type { Store } from '@/storage/types';
import { projectAccountProgress, type AccountSyncProgress, type ProgressReceipt } from '@/sync/accountProgress';
import { openJournal, SyncError, type JournalView, type LinkChoice, type PreferencePush, type SyncConnection, type SyncJournal, type SyncReport } from '@/sync/journal';
import type { AccountBusy, AccountMode, AccountPanelProps, AccountProfileChoice, ConnectedProfile } from '@/ui/account/AccountPanel';
import { APP_VERSION, LOCAL_ACCOUNT_CONSENT_VERSION, STAGING_ACCOUNT_CONSENT_VERSION, useApp, type AnswerSaveNotice } from '@/ui/AppContext';
import { useAccountRegistration } from '@/ui/useAccountRegistration';
import { usePasswordRecovery } from '@/ui/usePasswordRecovery';

// Safe, already-worded notes for a production capability that was asked for and cannot run here: never an environment
// name, address, secret or provider detail, and never a claim that Expo Go can run the app's own callback scheme.
const GOOGLE_EXPO_GO_NOTE = 'Masuk dengan Google belum tersedia di Expo Go. Masuk dengan email dan kata sandi tetap bisa dipakai.';
const GOOGLE_UNAVAILABLE_NOTE = 'Masuk dengan Google belum tersedia di perangkat ini. Masuk dengan email dan kata sandi tetap bisa dipakai.';
const RECOVERY_UNAVAILABLE_NOTE = 'Pemulihan kata sandi belum tersedia di perangkat ini. Masuk dengan email dan kata sandi tetap bisa dipakai.';

/** The note for a Google configuration that is off: the honest Expo Go one for that native reason, else the generic one; never the reason itself. */
function googleUnavailableNote(settings: object): string {
  const reason = 'reason' in settings && typeof settings.reason === 'string' ? settings.reason : '';
  return /expo[\s_-]*go/i.test(reason) ? GOOGLE_EXPO_GO_NOTE : GOOGLE_UNAVAILABLE_NOTE;
}

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
  /** In-run deletion status survives navigation and sign-out; a new verified account gets its own status. */
  deletion?: AccountDeletionModel;
  /** Only in an explicitly private native QA build: never set for an ordinary or disabled one. */
  privateQa?: true;
  /** Only while that private build's transport is unavailable: why, as its preparation named it. Nothing was built. */
  unavailableReason?: PrivateQaNetworkFailure;
}

export interface AccountDeletionModel {
  key: string;
  state: AccountDeletionState;
  available: boolean;
  remove(password: string, confirmed: boolean): Promise<void>;
  check(): Promise<void>;
  retryIdentity(password: string, confirmed: boolean): Promise<void>;
  retryCleanup(): Promise<void>;
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
/** Some Unit A answers stayed only in the pilot document: never a claim that everything was sent. */
const CAPTURE_HELD = 'Jawaban tersimpan di perangkat. Pencatatan akun akan dicoba lagi.';
/** The account's dataset could not be re-read for learning after an account data operation: never a sync claim. */
const RELOAD_FAILED = 'Data akun di perangkat ini belum bisa dibuka lagi untuk belajar. Data di perangkat ini tetap ada.';

/**
 * The account service as this layer's messages name it, and the version its adult-profile consent records: the local
 * account service by default, or the remote staging server under the validated configuration's staging profile. The
 * private native QA profile names ordinary «layanan akun» and «akun», never the local service.
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
 * The private native QA build's account service: ordinary account names, never the local service's, and no claim that it is
 * production or reachable. Its adult-profile consent statement is still the local one's, so it records that version.
 */
const PRIVATE_QA_SERVICE: AccountService = { name: 'layanan akun', account: 'akun', consentVersion: LOCAL_ACCOUNT_CONSENT_VERSION };
/**
 * The production account service. Its consent version is a distinct, UNREVIEWED draft marker for keeping a learner's
 * answers and settings on the server: it needs the owner's and a privacy review's approval before any release, and a
 * production profile never records the local or staging consent instead.
 */
const PRODUCTION_SERVICE: AccountService = { name: 'layanan akun', account: 'akun', consentVersion: 'draft-production-account-sync-consent-0.1' };
/**
 * The learning-beta account service: ordinary account names, and the remote beta server by name. Its consent version is its
 * own UNREVIEWED draft marker, never the local, staging or production one: it needs the owner's and a privacy review's
 * approval before any release, and nothing here says the beta is a production service.
 */
const LEARNING_BETA_SERVICE: AccountService = { name: 'server akun beta', account: 'akun', consentVersion: 'draft-learning-beta-account-sync-consent-0.1' };

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

/**
 * A fixed message for a sign-in failure at service `s`: never the server's text, the address or the password. Only where
 * `guestLearning` (the isolated local developer case) does it say that learning goes on without an account; every other
 * profile gets a neutral retry and data-kept note instead.
 */
function authMessage(e: unknown, s: AccountService, guestLearning: boolean): string {
  const kept = guestLearning ? 'Belajar tetap bisa tanpa akun.' : 'Coba lagi nanti; data di perangkat ini tetap ada.';
  const unreachable = `${upperFirst(s.name)} tidak terjangkau. ${kept}`;
  if (e instanceof AuthError) {
    switch (e.code) {
      case 'not_synthetic':
        return 'Pakai alamat email uji yang berakhiran .test.';
      case 'invalid_email':
        return 'Periksa alamat email.';
      case 'private_recipient':
        // Refused before anything was sent: this build takes its one approved address only.
        return 'Gunakan email yang disetujui untuk build ini.';
      case 'invalid_credentials':
        return 'Email atau kata sandi tidak cocok.';
      case 'network':
        return unreachable;
      case 'expired':
        return ENDED;
      case 'cancelled':
        return `Masuk dengan Google dibatalkan. ${kept}`;
      case 'not_registered':
        return `Akun Google ini belum terdaftar di ${s.name}, dan pendaftaran baru tidak tersedia. ${kept}`;
      case 'bad_callback':
        return 'Masuk dengan Google tidak bisa diselesaikan. Mulai lagi dari tombol Google; data di perangkat ini tetap ada.';
      case 'provider_refused':
        return `Google atau ${s.name} menolak permintaan masuk ini. ${guestLearning ? 'Coba lagi nanti; belajar tetap bisa tanpa akun.' : kept}`;
      case 'unavailable':
        return `Masuk dengan Google belum bisa dipakai di perangkat ini. ${kept}`;
      case 'not_forgotten':
        // Refused before anything was sent for it: never a claim that the earlier sign-in was forgotten.
        return `${NOT_FORGOTTEN} Jadi masuk ini tidak dilanjutkan. Coba lagi nanti; data di perangkat ini tetap ada.`;
      default:
        return `Belum bisa masuk ke ${s.account}. ${kept}`;
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

const ALL_SENT = 'Semua jawaban terkirim.';

/** What the latest journal facts allow saying after a sync: never everything sent while an answer is queued, blocked or held. */
function progressStatus(p: AccountSyncProgress, linked: boolean): string {
  const notes: string[] = [];
  if (p.blocked > 0) notes.push(`${p.blocked} jawaban tersimpan di perangkat ini tetapi tidak bisa dikirim ke akun.`);
  if (p.capturePending) notes.push(CAPTURE_HELD);
  if (p.queued > 0) {
    const differs = p.conflicts > 0 && p.conflicts === p.queued;
    return [`${p.queued} jawaban belum diterima akun${differs ? ' karena salinannya di akun berbeda' : ''}. Jawaban tetap tersimpan di perangkat ini.`, ...notes].join(' ');
  }
  return `${linked ? 'Profil tersambung. ' : ''}${notes.length ? notes.join(' ') : ALL_SENT}`;
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
  deletionTurn?: number;
  /** The server's progress counts as last read for this account and its linked profile, and whether a later read failed. */
  receipt?: ProgressReceipt;
  receiptState?: 'verified' | 'stale';
  /** One manual sync at a time; set and cleared synchronously. */
  syncInFlight?: boolean;
  /** An answer was saved while a sync was in flight: the sync records it locally once all its network work has ended. */
  deferred?: boolean;
  /** Saved answers the journal may not hold yet: deferred, or their local recording failed. */
  capturePending?: boolean;
  /** Unit A captures the last sync could not append to the store yet, or the screen told are held. */
  held?: boolean;
  /**
   * The screen's own latest word on its capture (held, or fully saved) and how many were applied to this binding. Local
   * only, never stored: a sync whose drain began before the latest one never overrides it.
   */
  noticeHeld?: boolean;
  notices?: number;
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
  // in a production one, 'learning-beta' in a learning-beta one, else absent.
  const environment = config.enabled ? config.environment : undefined;
  const service =
    environment === 'production'
      ? PRODUCTION_SERVICE
      : environment === LEARNING_BETA
        ? LEARNING_BETA_SERVICE
        : environment === STAGING
          ? STAGING_SERVICE
          : environment === PRIVATE_QA
            ? PRIVATE_QA_SERVICE
            : LOCAL_SERVICE;
  // The private native QA transport, decided once per configuration by the device port: off for an ordinary or disabled
  // profile (its clients keep their usual transport), else the one bound fetch every account client gets, or unavailable.
  const privateNetwork = useMemo(() => devicePrivateQaNetwork(config), [config]);
  const privateFetch = privateNetwork.state === 'ready' ? privateNetwork.fetch : undefined;
  // An explicitly private profile builds no account client without that fetch: never a fallback to the global one.
  const privateProfile = privateNetwork.state !== 'off' || (config.enabled && (config.environment === PRIVATE_QA || config.privateQa !== undefined));
  const privateBlocked = privateProfile && privateFetch === undefined;
  // A normal production account service (never the private profile or the learning beta): the only one whose optional Google
  // and recovery check for secure crypto, and say safely why they cannot run. Only an explicit «on» asks for either.
  const productionService = config.enabled && !privateProfile && config.environment === 'production' && config.learningBeta !== true;
  const recoveryRequested = process.env.EXPO_PUBLIC_PASSWORD_RECOVERY === 'on';
  // Continue with Google: only with the account service on, in a build that turns it on, where its platform can run it;
  // never in the private profile. One setup makes the browser and the store once. A production build that asked for Google
  // and cannot run it keeps no service and a safe note instead (a missing or unsafe callback, browser, store or secure
  // crypto, or a setup that throws): its email sign-in and registration never depend on it. Elsewhere nothing is caught.
  const googleSetup = useMemo(() => {
    if (!config.enabled || privateProfile) return { service: null, note: undefined };
    const requested = productionService && process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN === 'on';
    if (productionService && !requested) return { service: null, note: undefined };
    const setup = () => {
      const browser = googleBrowser ?? deviceGoogleBrowser();
      if (!browser) return { service: null, note: requested ? GOOGLE_UNAVAILABLE_NOTE : undefined };
      const settings = loadGoogleConfig(browser.platform);
      if (!settings.enabled) return { service: null, note: requested ? googleUnavailableNote(settings) : undefined };
      // Never a shim: the production sign-in's entropy, SHA-256 and encoder are the platform's own, or Google is not offered.
      if (requested && missingWebCrypto()) return { service: null, note: GOOGLE_UNAVAILABLE_NOTE };
      const store = googleStore ?? deviceGoogleStore();
      if (!store) return { service: null, note: requested ? GOOGLE_UNAVAILABLE_NOTE : undefined };
      return { service: { browser, settings, store }, note: undefined };
    };
    if (!requested) return setup();
    try {
      return setup();
    } catch {
      return { service: null, note: GOOGLE_UNAVAILABLE_NOTE };
    }
  }, [config, googleBrowser, googleStore, privateProfile, productionService]);
  const google = googleSetup.service;
  // Remembering an email sign-in: only with the account service on, in a build that turns it on, with a secure vault.
  const vault = useMemo(() => {
    if (!config.enabled || privateBlocked || !rememberDeviceEnabled()) return null;
    return sessionVault === undefined ? deviceSessionVault() : sessionVault;
  }, [config, sessionVault, privateBlocked]);
  // Password recovery: only with the account service on, in a build that turns it on, with a callback this profile may use.
  // The private profile takes it only with its bound fetch; prepareRecovery then allows the native callback only, with
  // its secure store and native crypto port (never a store in RAM).
  const recoverySetup = useMemo(
    () => (privateBlocked ? null : prepareRecovery(config, recoveryRuntime, recoveryStore)),
    [config, recoveryRuntime, recoveryStore, privateBlocked]
  );
  /** The Auth adapter's recovery option: a store, and in the private profile also its native crypto port; otherwise none. */
  const recoveryOptions = useMemo(() => {
    const store = recoverySetup?.store;
    if (!recoverySetup || !store) return null;
    if (!privateProfile) {
      // Normal production recovery runs on the platform's secure WebCrypto, never a shim: without it the Auth adapter gets no
      // recovery, while recoverySetup still recognizes and fences every incoming link.
      if (productionService && missingWebCrypto()) return null;
      return { config: recoverySetup.config, store };
    }
    const nativeCrypto = recoverySetup.crypto;
    return privateFetch && nativeCrypto ? { config: recoverySetup.config, store, nativeCrypto } : null;
  }, [recoverySetup, privateProfile, privateFetch, productionService]);
  const services = useMemo(() => {
    if (!config.enabled || privateBlocked) return null;
    // The private profile's bound fetch, else the platform's fetch as this provider found it: a sign-out still on its way
    // after leaving uses the same one.
    const auth = createSupabaseAuth({
      config,
      fetch: privateFetch ?? globalThis.fetch,
      google: google ? { config: google.settings, store: google.store } : undefined,
      ...(vault ? { remember: { vault } } : {}),
      // Without a pending-attempt store (or, privately, a crypto port) the Auth adapter gets no recovery; recoverySetup
      // still recognizes its links.
      ...(recoveryOptions ? { recovery: recoveryOptions } : {}),
    });
    // The API client revalidates its address under the same profile the Auth adapter takes from `config`.
    // Only the private profile names its transport and capability, and only a learning-beta build its own; ordinary options
    // stay as they were.
    const api = createApiClient({
      baseUrl: config.apiBaseUrl,
      environment: config.environment,
      productionAccounts: config.productionAccounts,
      ...(privateFetch ? { fetch: privateFetch, privateQa: true } : {}),
      ...(config.learningBeta === true ? { learningBeta: true } : {}),
    });
    const session = createAccountSession({ auth, api });
    const conn: SyncConnection = { auth, session, api };
    return { auth, api, session, conn, google };
  }, [config, google, vault, recoveryOptions, privateBlocked, privateFetch]);
  // Production only, for a capability the build explicitly turned on that this device cannot run: one safe note each. Off
  // flags and available capabilities add none; nothing here reads a credential or provider detail, or fakes a success.
  const unavailableFeatures = useMemo(() => {
    if (!productionService || !services) return undefined;
    const googleNote = googleSetup.note;
    const recoveryNote = recoveryRequested && (!recoverySetup?.store || !services.auth.recovery) ? RECOVERY_UNAVAILABLE_NOTE : undefined;
    if (!googleNote && !recoveryNote) return undefined;
    return { ...(googleNote ? { google: googleNote } : {}), ...(recoveryNote ? { recovery: recoveryNote } : {}) };
  }, [productionService, services, googleSetup, recoveryRequested, recoverySetup]);

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
  const deletionController = useRef<AccountDeletionController | null>(null);
  const deletionQuiescing = useRef(false);
  const ordinaryTasks = useRef(new Set<Promise<void>>());
  const [deletionRecord, setDeletionRecord] = useState<{ key: string; state: AccountDeletionState } | null>(null);
  const track = (task: Promise<void>) => {
    ordinaryTasks.current.add(task);
    void task.then(() => ordinaryTasks.current.delete(task), () => ordinaryTasks.current.delete(task));
  };
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
  const { setIntentHandler, normalStarting: recoveryNormalStarting } = recoveryControl;

  // Test-account registration, through its own controller only: off (building nothing) unless registrationAllowed says so.
  /** A registration action while signed out: a normal sign-in still on its way publishes nothing more, and recovery ends. */
  const onRegistrationIntent = useCallback(() => {
    if (accountRef.current !== null) return;
    turn.current += 1;
    setBusy(null);
    setError(null);
    recoveryNormalStarting();
  }, [recoveryNormalStarting]);
  // Recovery shown (any stage but idle, or busy) keeps precedence: registration waits.
  const recoveryActive = recoveryControl.panel !== undefined && (recoveryControl.panel.stage !== 'idle' || recoveryControl.panel.busy);
  const registrationControl = useAccountRegistration({
    config,
    owner: services,
    available: account === null && busy === null && !recoveryActive,
    onIntent: onRegistrationIntent,
    // The private profile's one bound fetch; an ordinary build keeps the platform's.
    ...(privateFetch ? { fetch: privateFetch } : {}),
  });
  const { cancel: registrationNormalStarting } = registrationControl;

  /** Recovery began while signed out: a normal sign-in or registration still on its way publishes nothing more. A verified account stays. */
  const onRecoveryIntent = useCallback(() => {
    if (accountRef.current !== null) return;
    registrationNormalStarting();
    turn.current += 1;
    setBusy(null);
    setError(null);
  }, [registrationNormalStarting]);
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
    const deletionBlocked = () => deletionQuiescing.current || ['unknown', 'pending', 'completed'].includes(deletionController.current?.state().phase ?? 'idle');
    // A journal that started in an earlier turn may never borrow the later password grant for another request.
    const connectionFor = (t: number): SyncConnection => {
      if (!services) throw new AuthError('signed_out');
      const guard = () => { if (!live(t) || dataOp.current || deletionBlocked()) throw new AuthError('superseded'); };
      return { ...services.conn, auth: { ...services.auth,
        status: () => { guard(); return services.auth.status(); },
        authorized: async (call) => { guard(); const result = await services.auth.authorized((token, signal) => { guard(); return call(token, signal); }); guard(); return result; },
      }, session: {
        current: () => { guard(); return services.session.current(); },
        verify: async () => { guard(); const result = await services.session.verify(); guard(); return result; },
      } };
    };
    const close = () => {
      const o = opened.current;
      opened.current = null;
      journal.current = null;
      o?.release();
    };
    const clear = () => {
      binding.current = null;
      deletionController.current = null;
      deletionQuiescing.current = false;
      dataOp.current = null;
      setAccount(null);
      setGuestCopy(null);
      setProfiles([]);
      setConnected(null);
      setPrefsConflict(null);
    };
    /** `bound`'s factual progress from its own journal and its own receipt only. */
    const projectOf = (bound: Binding, j: SyncJournal): AccountSyncProgress =>
      projectAccountProgress({
        journal: j.view(),
        receipt: bound.receipt ?? null,
        receiptState: bound.receiptState,
        capturePending: bound.capturePending === true || bound.held === true,
      });
    /** The same, or null without a journal (a read-only tab has none). */
    const progressOf = (bound: Binding | null, j: SyncJournal | null): AccountSyncProgress | null => (bound && j ? projectOf(bound, j) : null);
    const showConnected = (syncStatus: string) =>
      setConnected({
        label: PROFILE_LABEL,
        syncStatus,
        savedAnswers: connectedRef.current?.savedAnswers ?? 0,
        otherDeviceAnswers: journal.current?.view().remote.length ?? 0,
        progress: progressOf(binding.current, journal.current),
      });
    /** Republishes the shown profile with `bound`'s latest progress (and a status derived from it), only while that binding is the one shown. */
    const refreshProgress = (bound: Binding, j: SyncJournal, status?: (current: string, progress: AccountSyncProgress) => string) => {
      const shown = connectedRef.current;
      if (!shown || binding.current !== bound) return;
      const progress = projectOf(bound, j);
      setConnected({ ...shown, progress, syncStatus: status ? status(shown.syncStatus, progress) : shown.syncStatus });
    };
    /**
     * Synchronous liveness of dataset `o` as published with `bound` in turn `t`: the same view, handle and turn, its
     * sign-in finished, no deletion or account data operation, and the sign-in in use neither signed out nor another
     * provider user or account. Turns false the moment a sign-out, another sign-in or a deletion starts its turn,
     * before any rerender. Reads the auth status and verified account only, never a credential.
     */
    const datasetLive = (bound: Binding | null, o: OpenedAccountDataset, t: number) => (): boolean => {
      try {
        if (!services || bound === null || !live(t) || binding.current !== bound || bound.opened !== o || opened.current !== o) return false;
        if (bound.ready !== true || deletionBlocked() || dataOp.current) return false;
        const now = services.auth.status();
        if (now.state === 'signed-out' || now.identity.uid !== bound.uid) return false;
        const verified = services.session.current();
        return verified === null || verified.accountId === bound.accountId;
      } catch {
        return false;
      }
    };
    /**
     * Locally, never over the network: the saved answers of `bound`'s dataset the journal does not hold yet join it, only
     * while the binding is live in turn `t` for journal `j` and `extra` holds (the journal's own writer guard). Returns how
     * many joined, or null when the guard was lost or the recording failed.
     */
    async function reconcileLocal(bound: Binding, j: SyncJournal, t: number, extra: () => boolean = () => true): Promise<number | null> {
      const live = datasetLive(bound, bound.opened, t);
      const holds = () => extra() === true && live() && journal.current === j;
      try {
        const added = await j.reconcile(holds);
        return holds() ? added : null;
      } catch {
        return null;
      }
    }
    /**
     * An answer was just saved to account dataset `o` (journal `j`, binding `bound`, turn `t`; `learnerId` is the learner
     * the selection began with). Only while the app's generation guard `active`, the binding and that learner all still
     * hold. With a sync in flight nothing is read or recorded: the answer is marked for the sync's own final local
     * recording, so it cannot ride the batch the sync already took. Otherwise it joins the journal locally, with no
     * request. A failed recording keeps the saved answer, says so truthfully and is retried by the next manual sync; the
     * answer itself is never written again.
     * With an explicit `notice` the screen states its capture: held (its row append failed) is marked at once, locally,
     * with nothing recorded or sent, even during a sync; saved clears a known held state before the recording above.
     * Without one nothing is stated, and a held capture stays as it is.
     */
    async function answerSaved(
      bound: Binding,
      o: OpenedAccountDataset,
      j: SyncJournal,
      t: number,
      learnerId: string,
      active: () => boolean,
      notice?: AnswerSaveNotice
    ): Promise<void> {
      const live = datasetLive(bound, o, t);
      const holds = () => active() === true && live() && journal.current === j;
      // Read before anything is awaited: only a literal boolean states anything about the capture.
      const stated = typeof notice?.capturePending === 'boolean' ? notice.capturePending : null;
      const defer = () => {
        bound.deferred = true;
        bound.capturePending = true;
        refreshProgress(bound, j);
      };
      /** The screen's latest word: kept on the binding, so a sync whose drain began earlier never overrides it. */
      const note = (held: boolean) => {
        bound.notices = (bound.notices ?? 0) + 1;
        bound.noticeHeld = held;
        bound.held = held;
      };
      if (!holds()) return;
      if (bound.syncInFlight && stated === null) {
        defer();
        return;
      }
      let added: number | null = null;
      try {
        const learner = await o.store.getLearner();
        if (!holds() || learner?.learner_id !== learnerId) return;
        if (stated !== null) note(stated);
        if (stated === true) {
          // Held: nothing is appended, recorded or sent; only an earlier claim that everything was sent is withdrawn.
          refreshProgress(bound, j, (current, progress) => (current.includes(ALL_SENT) ? progressStatus(progress, false) : current));
          return;
        }
        if (bound.syncInFlight) {
          defer();
          return;
        }
        // A sync starting meanwhile loses this guard and records the answer itself (or leaves it to its final recording).
        added = await reconcileLocal(bound, j, t, () => holds() && !bound.syncInFlight);
      } catch {
        added = null;
      }
      if (!holds()) return;
      if (bound.syncInFlight) {
        defer();
        return;
      }
      if (added === null) {
        bound.capturePending = true;
        refreshProgress(bound, j, () => CAPTURE_HELD);
        return;
      }
      bound.capturePending = false;
      const recorded = added;
      // A new answer makes an earlier claim that everything was sent untrue, and a held capture's note is out of date.
      refreshProgress(bound, j, (current, progress) => ((recorded > 0 && current.includes(ALL_SENT)) || current.includes(CAPTURE_HELD) ? progressStatus(progress, false) : current));
    }
    /** Learning uses the account's dataset from now on; preference changes go through its journal. */
    const selectAccountDataset = async (o: OpenedAccountDataset, j: SyncJournal | null): Promise<void> => {
      const blocked = () => opened.current !== o || deletionBlocked() || !!dataOp.current;
      if (blocked()) return;
      const bound = binding.current;
      const t = turn.current;
      // The learner this selection begins with: an answer of any other learner is never recorded through it.
      const original = j ? await o.store.getLearner() : null;
      if (blocked() || t !== turn.current) return;
      await appRef.current.selectDataset({
        store: o.store,
        readOnly: o.access === 'owner' ? null : (o.reason ?? 'Akun ini sedang dipakai di tab lain; tab ini hanya bisa membaca.'),
        active: datasetLive(bound, o, t),
        answersSaved: j && bound && original ? (active, notice) => answerSaved(bound, o, j, t, original.learner_id, active, notice) : undefined,
        savePreferences: j
          ? async (patch) => {
              for (const field of PREFERENCE_FIELDS) {
                const value = patch[field];
                if (value !== undefined) await j.setPreference(field, value);
              }
            }
          : undefined,
      });
    };
    /** Learning is live in `bound`'s own dataset right now; read before an account data operation sets its dataOp. */
    const learningIn = (bound: Binding): boolean => {
      const a = appRef.current;
      try {
        return a.dataset === 'account' && a.store === bound.opened.store && a.datasetActive?.() === true;
      } catch {
        return false;
      }
    };
    /**
     * After a non-destructive account data operation of turn `t` has ended (its own dataOp cleared): learning, live in
     * `bound`'s dataset before it, resumes there through a fresh selection, while the same ready view, handle and turn
     * are current and no deletion blocks it. Callbacks published earlier stay fenced; a newer turn owns everything and
     * is never touched. Never rejects: a failed re-read leaves the dataset inactive and says so, nothing more.
     */
    async function resumeLearning(t: number, bound: Binding, shown: ConnectedProfile | null): Promise<void> {
      const o = bound.opened;
      const own = () => live(t) && binding.current === bound && opened.current === o && bound.ready === true && !dataOp.current && !deletionBlocked();
      if (!own()) return;
      try {
        await selectAccountDataset(o, journal.current);
      } catch {
        if (live(t) && binding.current === bound) setError(RELOAD_FAILED);
        return;
      }
      // A failed deletion's quiescing hid the connected profile; it comes back with the dataset.
      if (own() && connectedRef.current === null && shown) setConnected({ ...shown, progress: progressOf(bound, journal.current) });
    }

    /**
     * Ends the sign-in at once: its work stops, no token is handed out again, a remembered sign-in is forgotten and
     * learning returns to the guest's dataset. Then, unless another sign-in has started meanwhile, it says when the
     * provider did not confirm the revocation, or when the secure vault would not let go of a remembered sign-in.
     */
    async function signOut(message: string | null = null): Promise<void> {
      normalWork.current = true;
      registrationNormalStarting();
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

    /**
     * Locally, before a sync of turn `t` sends anything: the account learner's saved Unit A intents are appended to the
     * account's own store, owned "account:<learner>", under the live binding only. Nothing is sent and nothing but
     * answers is written; a document without captures is left as it is. True when some may still be unrecorded.
     */
    async function drainCaptures(t: number): Promise<boolean> {
      const bound = binding.current;
      const o = bound?.opened;
      if (!bound || !o || opened.current !== o || o.access !== 'owner' || typeof o.store.getMeta !== 'function') return false;
      try {
        // Only a stored pilot document with captures has anything to record.
        const raw: unknown = await o.store.getMeta(PILOT_META_KEY);
        if (typeof raw !== 'string') return false;
        const doc: unknown = JSON.parse(raw);
        if (typeof doc === 'object' && doc !== null && !Object.prototype.hasOwnProperty.call(doc, 'captures')) return false;
        const learner = await o.store.getLearner();
        if (!learner) return true;
        await drainPilotAnswers({ store: o.store, owner: `account:${learner.learner_id}`, active: datasetLive(bound, o, t) });
        return false;
      } catch {
        return true;
      }
    }

    async function sync(link: LinkChoice | null): Promise<void> {
      const j = journal.current;
      const bound = binding.current;
      // Nothing ordinary starts while an account data operation is under way, and this binding syncs one at a time.
      if (!j || !services || !bound || bound.opened !== opened.current || bound.syncInFlight || dataOp.current || deletionBlocked()) return;
      bound.syncInFlight = true;
      try {
        await runSync(j, bound, link);
      } finally {
        bound.syncInFlight = false;
      }
    }

    /**
     * The one manual sync of `bound`, whose syncInFlight is set. An answer saved while it runs is only marked, so it never
     * rides a batch already taken; once ALL its network work (the progress read included) has ended, the answers saved
     * meanwhile are recorded locally under the same guard, and stay queued for the next manual sync.
     */
    async function runSync(j: SyncJournal, bound: Binding, link: LinkChoice | null): Promise<void> {
      const t = turn.current;
      setBusy('sync');
      setError(null);
      showConnected('Menyinkronkan…');
      let report: SyncReport | null = null;
      let prefs: PreferencePush | null = null;
      // Unit A captures held back stay claimed as held until a sync gets to append them.
      let held = bound.held === true;
      // How many capture notices of the screen this binding had when `held` was last known: a later one is newer than it.
      let seen = bound.notices ?? 0;
      let failure: string | null = null;
      try {
        await ensureFresh();
        // Refreshed first; the pilot's saved answers then join the account's store, before anything is sent.
        seen = bound.notices ?? 0;
        held = await drainCaptures(t);
        report = await j.sync(connectionFor(t), link);
        prefs = await j.pushPreferences(connectionFor(t));
      } catch (e) {
        if (!live(t)) return;
        if (ended(e)) {
          await signOut(ENDED);
          return;
        }
        failure = syncFailure(e, j.view(), service);
      }
      let savedAnswers = connectedRef.current?.savedAnswers ?? 0;
      try {
        const read = await j.readProgress(connectionFor(t));
        savedAnswers = read.events;
        if (live(t) && binding.current === bound) {
          bound.receipt = { accountId: bound.accountId, progress: read, checkedAt: new Date().toISOString() };
          bound.receiptState = 'verified';
        }
      } catch {
        // Not linked yet, or unreachable: the last count of this binding stays, now as stale; another binding never gets it.
        if (bound.receipt) bound.receiptState = 'stale';
      }
      if (!live(t)) return;
      // Only now, with every request done: the answers saved meanwhile join the journal, locally and under the same guard.
      let recorded: boolean;
      do {
        bound.deferred = false;
        recorded = (await reconcileLocal(bound, j, t)) !== null;
      } while (bound.deferred && recorded);
      if (!live(t)) return;
      bound.capturePending = !recorded;
      // A capture notice told after the drain began (held or saved, even while the upload ran) is newer than its result.
      bound.held = (bound.notices ?? 0) === seen ? held : bound.noticeHeld === true;
      // Nothing awaits between the last deferred check and the flag's end: an answer saved from now on finds the sync over.
      const view = j.view();
      const progress = projectOf(bound, j);
      bound.syncInFlight = false;
      let status = failure ?? progressStatus(progress, (report?.linked.length ?? 0) > 0);
      if (failure === null && prefs === 'conflict') status += ' Pengaturan di akun berbeda; pilih yang dipakai.';
      setConnected({ label: PROFILE_LABEL, syncStatus: status, savedAnswers, otherDeviceAnswers: view.remote.length, progress });
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
      registrationNormalStarting();
      recoveryNormalStarting();
      const t = ++turn.current;
      await appRef.current.selectDataset(null);
      if (!live(t)) return null;
      close();
      clear();
      setDeletionRecord(null);
      setError(null);
      setBusy('auth');
      return t;
    }

    function installDeletion(bound: Binding, t: number, initialProof?: AccountDeletion): boolean {
      if (!services) return false;
      const o = bound.opened;
      if (o.access !== 'owner' || !o.eraseAccountData) return false;
      const current = () => binding.current === bound && opened.current === o && bound.deletionTurn === turn.current;
      deletionController.current = createAccountDeletionController({
        initialProof, auth: services.auth, session: services.session, expected: { accountId: bound.accountId, uid: bound.uid },
        controls: createAccountControls(services.api, bound.accountId), isCurrent: current,
        onState: (state) => { if (current()) setDeletionRecord({ key: `signin-${t}`, state }); },
        quiesce: async () => {
          deletionQuiescing.current = true;
          // Capture/start registered pauses before a dataset change can unmount and unregister the session route.
          const learning = runCheckpoints();
          await appRef.current.selectDataset(null);
          if (!current()) throw new AuthError('superseded');
          setConnected(null); setProfiles([]); setGuestCopy(null); setPrefsConflict(null);
          await Promise.allSettled([...(learning ? [learning] : []), ...ordinaryTasks.current]);
          if (!current()) throw new AuthError('superseded');
        },
        erase: () => o.eraseAccountData!(bound.accountId),
      });
      setDeletionRecord({ key: `signin-${t}`, state: deletionController.current.state() });
      return true;
    }

    /** A fresh authenticated deletion-route proof replaces /me only for a deleted account, never for ordinary learning. */
    async function resumeDeleted(t: number, identity: AuthIdentity, restoredFor: string | null): Promise<void> {
      if (!services) return;
      const started = services.auth.status();
      if (!live(t) || started.state !== 'signed-in' || started.identity.uid !== identity.uid) throw new AuthError('superseded');
      const proof = await services.auth.authorized((token, signal) => discoverOwnAccountDeletion(services.api, token, signal));
      const now = services.auth.status();
      if (!live(t) || now.state !== 'signed-in' || now.session !== started.session || now.identity.uid !== identity.uid) throw new AuthError('superseded');
      if (!proof) {
        setDeletionRecord({ key: `signin-${t}`, state: { phase: 'unknown', local: 'kept', busy: false, issue: 'unavailable' } });
        throw new ApiError(410, 'account_deleted');
      }
      if (restoredFor !== null && restoredFor !== proof.account_id) throw new AuthError('superseded');
      const o = await openDataset(accountNamespace(proof.account_id));
      if (!live(t)) { o.release(); return; }
      opened.current = o; journal.current = null;
      const bound: Binding = { accountId: proof.account_id, uid: identity.uid, opened: o, ready: true };
      binding.current = bound;
      deletionQuiescing.current = true;
      if (!installDeletion(bound, t, proof)) {
        setDeletionRecord({ key: `signin-${t}`, state: { phase: proof.status === 'completed' ? 'completed' : 'pending', local: 'kept', busy: false, proof } });
        setBusy(null); return;
      }
      setAccount({ key: `signin-${t}`, label: identity.email });
      // Only the freshly authenticated own proof authorizes this captured local cleanup; no destructive POST is repeated.
      await deletionAction('retryCleanup');
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
      let verified;
      try { verified = await services.session.verify(); }
      catch (error) {
        if (error instanceof ApiError && error.status === 410 && error.code === 'account_deleted') { await resumeDeleted(t, identity, restoredFor); return; }
        throw error;
      }
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
        const guest = appRef.current.guestStore as (Store & { readRaw?: () => Promise<RawDataset | null> }) | null;
        const answers = guest ? (await guest.listAnswers()).length : 0;
        // Guest Unit A progress lives in the pilot document only: offered as well, even without answers. Its read never
        // fails this sign-in; unreadable, it is simply not offered.
        let pilotProgress = false;
        if (guest?.readRaw) {
          try {
            pilotProgress = hasGuestPilotProgress(await guest.readRaw(), localDate(Date.now()));
          } catch {
            pilotProgress = false;
          }
        }
        if (!live(t)) return;
        setGuestCopy(pilotProgress ? { answers, pilotProgress: true } : answers > 0 ? { answers } : null);
        setProfiles(verified.profiles.map((p) => ({ id: p.profileId, label: `${PROFILE_LABEL} · ${p.highSeq} jawaban tercatat di akun` })));
      }
      bound.ready = true;
      installDeletion(bound, t);
      setBusy(null);
      if (notSaved) setError(REMEMBER_NOT_SAVED);
    }

    /** The sign-in of turn `t` failed: a session it made is signed out, nothing of it stays, and a fixed message says why. */
    function signInFailed(t: number, e: unknown): void {
      if (!services || !live(t)) return;
      if (services.auth.status().state !== 'signed-out') void services.auth.signOut();
      close();
      clear();
      // The guest-learning promise is only the isolated local developer case's: no named profile, developer-demo rules.
      setError(authMessage(e, service, environment === undefined && appRef.current.rules.mode === 'developer-demo'));
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
      registrationNormalStarting();
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
      const bound = binding.current;
      if (!o || !j || !guest || !bound || bound.opened !== o || dataOp.current || deletionBlocked()) return;
      const t = turn.current;
      setBusy('guest-copy');
      setError(null);
      try {
        // Read through the open guest store's own queue; written only through the account dataset's owner. The exact
        // snapshot the copy read is the one whose Unit A progress is adopted below.
        let snapshot: RawDataset | null = null;
        const source: RawSource = {
          namespace: GUEST_NAMESPACE,
          readRaw: async () => {
            snapshot = guest.readRaw ? await guest.readRaw() : null;
            return snapshot;
          },
        };
        const consent = { copyGuestData: true as const, at: new Date().toISOString() };
        const result = await copyGuestToAccount({ from: source, to: o.raw, consent });
        // Only for this verified account's own handle, in this turn: the guest's Unit A document, owner only.
        let pilot: GuestPilotAdoption | 'failed' = 'none';
        try {
          pilot = await adoptGuestPilot({
            store: o.store,
            source: snapshot,
            consent,
            active: () => live(t) && binding.current === bound && opened.current === o && journal.current === j && !deletionBlocked(),
            today: localDate(Date.now()),
          });
        } catch {
          pilot = 'failed';
        }
        await j.reconcile();
        if (!live(t)) return;
        refreshProgress(bound, j);
        if (pilot === 'failed') {
          // The archive and the imported document stay for a retry; never a claim the progress was copied.
          setError('Kemajuan Unit A tamu belum bisa dipindahkan ke akun ini. Coba salin lagi; data tamu tetap tersimpan di perangkat ini.');
          return;
        }
        const answersCopied = result.answers > 0 ? `${result.answers} jawaban tamu disalin ke akun ini. ` : '';
        setGuestCopy((c) => ({
          answers: c?.answers ?? result.answers,
          ...(c?.pilotProgress ? { pilotProgress: true } : {}),
          result:
            pilot === 'adopted'
              ? `${answersCopied}Kemajuan Unit A tamu disalin ke akun ini. Data tamu tetap tersimpan di perangkat ini.`
              : // An earlier copy's snapshot resumed; the newer guest progress is only archived, never merged.
                pilot === 'restored'
                ? `${answersCopied}Kemajuan Unit A tamu yang disalin sebelumnya dilanjutkan di akun ini. Kemajuan tamu yang lebih baru disimpan sebagai arsip terpisah, tidak digabungkan. Data tamu tetap tersimpan di perangkat ini.`
                : pilot === 'archived'
                  ? `${answersCopied}Kemajuan Unit A tamu disimpan sebagai arsip terpisah di akun ini, tetapi tidak dilanjutkan sebagai kemajuan profil akun ini. Data tamu tetap tersimpan di perangkat ini.`
                  : pilot === 'unchanged'
                    ? `${answersCopied}Kemajuan Unit A tamu sudah tersimpan di akun ini sebelumnya. Data tamu tetap tersimpan di perangkat ini.`
                    : result.answers > 0
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
      if (dataOp.current || deletionBlocked()) return;
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
      if (!o || !j || !services || dataOp.current || deletionBlocked()) return;
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
      if (!o || !j || !services || dataOp.current || deletionBlocked()) return;
      const t = turn.current;
      setBusy('profile');
      setError(null);
      try {
        if (!(await o.store.getLearner())) {
          // A device joining one of the account's adult profiles records that profile's consent and settings locally.
          if (!isCanonicalUuid(profileId)) throw new Error('not a profile ID');
          await ensureFresh();
          if (!live(t) || dataOp.current || deletionBlocked()) throw new AuthError('superseded');
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
      if (!j || dataOp.current || deletionBlocked()) return;
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
            progress: progressOf(binding.current, j),
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
     * No additional explicit sign-out, remembering, erasure, copy or sync is requested; the server's recent-password check decides.
     */
    async function exportData(password: string): Promise<{ accountId: string; json: string }> {
      const bound = binding.current;
      if (!services || !bound || opened.current !== bound.opened) throw new AuthError('signed_out');
      if (!bound.ready || dataOp.current || deletionBlocked()) throw new Error('Another account request is still on its way; nothing was sent.');
      const resume = learningIn(bound);
      const shown = connectedRef.current;
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
        // The same view's learning resumes with a fresh selection; this never rejects, so the outcome above stands.
        if (resume) await resumeLearning(t, bound, shown);
        if (live(t)) setBusy(null);
      }
    }

    async function deletionAction(method: 'remove' | 'check' | 'retryIdentity' | 'retryCleanup', password = '', confirmed = false): Promise<void> {
      const bound = binding.current; const controller = deletionController.current;
      if (!services || !bound?.ready || !controller || opened.current !== bound.opened) throw new AuthError('signed_out');
      if (dataOp.current) throw new Error('Account operation already running');
      const resume = learningIn(bound); const shown = connectedRef.current;
      const op = {}; dataOp.current = op; const t = ++turn.current; bound.deletionTurn = t;
      normalWork.current = true; recoveryNormalStarting(); setBusy('data'); setError(null);
      try {
        if (method === 'remove') await controller.remove(password, confirmed);
        else if (method === 'retryIdentity') await controller.retryIdentity(password, confirmed);
        else await controller[method]();
        const ownView = () => live(t) && binding.current === bound && opened.current === bound.opened;
        const now = services.auth.status(); const verified = services.session.current();
        if (ownView() && ((now.state !== 'signed-out' && now.identity.uid !== bound.uid) || (verified !== null && verified.accountId !== bound.accountId))) {
          await appRef.current.selectDataset(null);
          // Never close, clear or revoke a replacement account that took over during the await.
          if (ownView()) { close(); clear(); }
        }
      } finally {
        if (dataOp.current === op) dataOp.current = null;
        if (live(t) && controller.state().phase === 'failed') deletionQuiescing.current = false;
        // Only an idle or failed deletion with local data kept and quiescing cleared resumes (resumeLearning checks the rest).
        if (resume && controller.state().local === 'kept') await resumeLearning(t, bound, shown);
        if (live(t)) setBusy(null);
      }
    }
    return { signOut, sync, submit, restoreRemembered, continueWithGoogle, resumeGoogle, copyGuest, skipGuest, createProfile, linkProfile, resolvePrefs, exportData, deletionAction };
  }, [services, service, environment, openDataset, setConnected, recoveryNormalStarting, registrationNormalStarting]);
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
      deletionController.current = null;
      deletionQuiescing.current = false;
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
        ...(privateProfile ? { privateQa: true as const } : {}),
        // Only for a signed-in, verified account: its own server data, never the guest's.
        ...(account !== null && !['unknown', 'pending', 'completed'].includes(deletionRecord?.state.phase ?? 'idle') ? { dataControls } : {}),
        ...(deletionRecord ? { deletion: { ...deletionRecord, available: account !== null, remove: (password: string, confirmed: boolean) => actions.deletionAction('remove', password, confirmed), check: () => actions.deletionAction('check'), retryIdentity: (password: string, confirmed: boolean) => actions.deletionAction('retryIdentity', password, confirmed), retryCleanup: () => actions.deletionAction('retryCleanup') } } : {}),
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
          // Only where registrationAllowed says so (local or staging, never production): its own flow, never a sign-in.
          ...(registrationControl.panel ? { registration: registrationControl.panel } : {}),
          // Only a production build's explicitly requested Google or recovery that cannot run: a safe note, never a control.
          ...(unavailableFeatures ? { unavailableFeatures } : {}),
          onSubmit: (request) => void actions.submit(request),
          // Only where the build turns Google on, with the account service, and the platform can run its browser and store.
          onGoogle: services.google && services.auth.google ? () => void actions.continueWithGoogle() : undefined,
          onGuestCopy: () => track(actions.copyGuest()),
          onGuestSkip: actions.skipGuest,
          onLinkProfile: (id) => track(actions.linkProfile(id)),
          onCreateProfile: () => track(actions.createProfile()),
          onSyncNow: () => track(actions.sync(null)),
          onKeepLocalPrefs: () => track(actions.resolvePrefs('keep-local')),
          onUseServerPrefs: () => track(actions.resolvePrefs('use-server')),
          onSignOut: () => void actions.signOut(),
        },
      }
    : privateProfile
      ? // Off, with only the reason preparation named: nothing was built, and nothing can reach any fetch.
        { ...OFF, privateQa: true, unavailableReason: privateNetwork.state === 'unavailable' ? privateNetwork.reason : 'configuration' }
      : OFF;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
