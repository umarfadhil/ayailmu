// The registration flow as a small state machine over the registration adapter (auth/registration.ts), for a later hook
// and AccountPanel. It only orchestrates: email stage (register), code stage (confirm, resend) and confirmed, after which
// the learner signs in with the password elsewhere; no session, account or sign-in is ever taken here. Its state holds
// the saved address (as its email policy takes it) and a stable Indonesian message only, never a password, code, token or user id, and
// nothing is stored or logged. One request at a time: an action in another stage, while busy, while inactive or after
// dispose sends nothing. A newer start, cancel, an inactive owner or dispose drops the reply under way.
import { PRIVATE_QA, PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import { accountApiOrigin } from '@/account/staging';
import { accountAuthOrigin, LOCAL_SUPABASE, type EnabledSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import {
  RegistrationError,
  registrationEmailRefusal,
  type Registration,
  type RegistrationEmailPolicy,
  type RegistrationErrorCode,
} from '@/auth/registration';

export type RegistrationStage = 'idle' | 'email' | 'code' | 'confirmed';

export interface RegistrationState {
  stage: RegistrationStage;
  busy: boolean;
  /** The synthetic address the code belongs to, once registration (or useCode) accepted it. */
  email: string | null;
  message: string | null;
  error: RegistrationErrorCode | null;
}

export interface RegistrationControllerOptions {
  registration: Registration;
  /** False once the owner is gone (account changed, route blurred, app backgrounded): every action and reply is dropped. */
  active: () => boolean;
  onChange?: (state: RegistrationState) => void;
  /** Which addresses the flow takes, read once at creation; 'synthetic' by default. Anything else sends nothing. */
  emailPolicy?: RegistrationEmailPolicy;
}

export interface RegistrationController {
  read(): RegistrationState;
  start(): void;
  register(email: string, password: string): Promise<void>;
  /** Re-enters the code stage for an address (e.g. after a reload) without signing up or sending anything. */
  useCode(email: string): void;
  confirm(code: string): Promise<void>;
  resend(): Promise<void>;
  cancel(): void;
  dispose(): void;
}

/** A validated origin, or null when the helper refuses it in any way. */
const originOf = (check: () => unknown): string | null => {
  try {
    const origin = check();
    return typeof origin === 'string' && origin.startsWith('https://') ? origin : null;
  } catch {
    return null;
  }
};

/**
 * Which registration the UI may offer, or null for none. The flag exactly "on": the synthetic policy, with an enabled
 * local-supabase configuration in a local build (no environment) or exactly staging, never the production capability.
 * The flag exactly "confirmed-email": the confirmed-email policy, only with an enabled local-supabase configuration in a
 * production build with productionAccounts, whose API and Auth roots are validated, distinct public HTTPS origins.
 * The flag exactly "private-qa-confirmed-email": the private QA policy, only with an enabled local-supabase configuration
 * of the private-qa profile with its capability (privateQa exactly true, never productionAccounts), whose API and Auth
 * roots are exactly the fixed private ones, as the origin helpers validate them with that capability. The private
 * capability never widens another flag or profile.
 */
export function registrationPolicy(
  config: SupabaseConfig,
  flag: string | undefined = process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION
): RegistrationEmailPolicy | null {
  if ((flag !== 'on' && flag !== 'confirmed-email' && flag !== PRIVATE_QA_REGISTRATION_POLICY) || typeof config !== 'object' || config === null) return null;
  const { enabled, provider, environment, productionAccounts, privateQa, apiBaseUrl, authUrl } = config as Partial<EnabledSupabaseConfig>;
  if (enabled !== true || provider !== LOCAL_SUPABASE) return null;
  if (flag === PRIVATE_QA_REGISTRATION_POLICY) {
    if (environment !== PRIVATE_QA || privateQa !== true || productionAccounts !== undefined) return null;
    const api = originOf(() => accountApiOrigin(apiBaseUrl, PRIVATE_QA, undefined, true));
    const auth = originOf(() => accountAuthOrigin(authUrl, PRIVATE_QA, undefined, true));
    return api !== null && auth !== null && api !== auth ? PRIVATE_QA_REGISTRATION_POLICY : null;
  }
  if (privateQa !== undefined) return null;
  if (flag === 'on') return productionAccounts === undefined && (environment === undefined || environment === 'staging') ? 'synthetic' : null;
  if (environment !== 'production' || productionAccounts !== true) return null;
  const api = originOf(() => accountApiOrigin(apiBaseUrl as string, 'production', true));
  const auth = originOf(() => accountAuthOrigin(authUrl as string, 'production', true));
  return api !== null && auth !== null && api !== auth ? 'confirmed-email' : null;
}

/** Whether the registration UI may be offered: whenever registrationPolicy names a policy. */
export function registrationAllowed(config: SupabaseConfig, flag: string | undefined = process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION): boolean {
  return registrationPolicy(config, flag) !== null;
}

const CODE_NOTICE = 'Masukkan kode dari kotak masuk uji.';
const CONFIRMED_NOTICE = 'Email terkonfirmasi. Masuk dengan kata sandi Anda.';
const RESENT_NOTICE = 'Permintaan kode baru diterima. Periksa kotak masuk uji.';
/** The confirmed-email and private QA policies' notices: a request accepted, never a claim that an email was delivered. */
const EMAIL_CODE_NOTICE = 'Periksa email Anda, lalu masukkan kode konfirmasi.';
const EMAIL_RESENT_NOTICE = 'Permintaan kode baru diterima. Periksa email Anda.';

const MESSAGES: Record<RegistrationErrorCode, string> = {
  not_synthetic: 'Gunakan alamat email uji yang berakhiran .test.',
  invalid_email: 'Isi alamat email yang valid.',
  private_recipient: 'Build uji ini hanya menerima alamat email yang sudah disetujui.',
  invalid_code: 'Kode tidak cocok atau sudah kedaluwarsa. Coba lagi.',
  weak_password: 'Kata sandi terlalu lemah. Gunakan kata sandi yang lebih panjang.',
  rate_limited: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  network: 'Server akun tidak terjangkau. Periksa koneksi lalu coba lagi.',
  service_unavailable: 'Layanan akun sedang tidak tersedia. Coba lagi nanti.',
  auto_confirm_refused: 'Server akun tidak meminta konfirmasi email, jadi pendaftaran dihentikan.',
  provider_refused: 'Server akun menolak permintaan ini.',
  bad_response: 'Jawaban server akun tidak dikenali. Coba lagi.',
  cancelled: 'Permintaan dibatalkan.',
  superseded: 'Permintaan digantikan oleh yang lebih baru.',
  disposed: 'Pendaftaran sudah ditutup.',
};

/** A refusal's stable code; anything that is not a RegistrationError is a bad response, and its text is never read. */
const codeOf = (error: unknown): RegistrationErrorCode =>
  error instanceof RegistrationError && Object.prototype.hasOwnProperty.call(MESSAGES, error.code) ? error.code : 'bad_response';

const IDLE: RegistrationState = { stage: 'idle', busy: false, email: null, message: null, error: null };

/** Lets an adapter call settle on its own: never awaited for the UI, and a rejection is never unhandled. */
function settle(call: () => Promise<unknown>): void {
  try {
    void Promise.resolve(call()).catch(() => undefined);
  } catch {
    // A synchronous throw changes nothing either.
  }
}

export function createRegistrationController({
  registration,
  active,
  onChange,
  emailPolicy = 'synthetic',
}: RegistrationControllerOptions): RegistrationController {
  // Read once: an unknown runtime value takes no address at all, so nothing reaches the adapter.
  const policy = emailPolicy;
  const emailed = policy === 'confirmed-email' || policy === PRIVATE_QA_REGISTRATION_POLICY;
  const codeNotice = emailed ? EMAIL_CODE_NOTICE : CODE_NOTICE;
  const resentNotice = emailed ? EMAIL_RESENT_NOTICE : RESENT_NOTICE;
  /** Why the policy refuses the address (the adapter's own rule), or null when it takes it. */
  const refusalOf = (email: unknown): RegistrationErrorCode | null => registrationEmailRefusal(email, policy);
  let state: RegistrationState = { ...IDLE };
  let generation = 0;
  let disposed = false;

  const set = (next: RegistrationState) => {
    state = { ...next };
    onChange?.({ ...state });
  };

  /** Drops the flow under way (its late reply writes nothing) and sets `next`; the adapter's call is cancelled, unawaited. */
  const reset = (next: RegistrationState, cancelAdapter: boolean) => {
    generation += 1;
    if (cancelAdapter) settle(() => registration.cancel());
    set(next);
  };

  /** Whether an action may run now; while inactive the flow is cleared to idle and nothing is sent. */
  const usable = (): boolean => {
    if (disposed) return false;
    if (active()) return true;
    if (state.busy || state.stage !== 'idle' || state.error !== null) reset(IDLE, state.busy);
    return false;
  };

  /** One adapter request: busy at once, then its outcome, unless a newer flow, an inactive owner or dispose came first. */
  const request = async (busy: RegistrationState, send: () => Promise<unknown>, success: RegistrationState, failure: Omit<RegistrationState, 'message' | 'error'>) => {
    const mine = generation;
    set(busy);
    let code: RegistrationErrorCode | null = null;
    try {
      await send();
    } catch (error) {
      code = codeOf(error);
    }
    if (disposed || mine !== generation) return;
    if (!active()) return reset(IDLE, true);
    set(code === null ? success : { ...failure, message: MESSAGES[code], error: code });
  };

  return {
    read: () => ({ ...state }),

    start() {
      if (!usable()) return;
      reset({ ...IDLE, stage: 'email' }, state.busy);
    },

    async register(email, password) {
      if (!usable() || state.stage !== 'email' || state.busy) return;
      const form = { stage: 'email' as const, busy: false, email: null };
      const refusal = refusalOf(email);
      if (refusal !== null) return set({ ...form, message: MESSAGES[refusal], error: refusal });
      await request(
        { ...form, busy: true, message: null, error: null },
        () => registration.register(email, password),
        { stage: 'code', busy: false, email, message: codeNotice, error: null },
        form
      );
    },

    useCode(email) {
      if (!usable() || state.busy) return;
      const refusal = refusalOf(email);
      if (refusal !== null) {
        const stage = state.stage === 'email' ? 'email' : 'idle';
        return reset({ stage, busy: false, email: null, message: MESSAGES[refusal], error: refusal }, false);
      }
      reset({ stage: 'code', busy: false, email, message: codeNotice, error: null }, false);
    },

    async confirm(code) {
      if (!usable() || state.stage !== 'code' || state.busy || state.email === null) return;
      const email = state.email;
      const form = { stage: 'code' as const, busy: false, email };
      await request(
        { ...form, busy: true, message: null, error: null },
        () => registration.confirm(email, code),
        { stage: 'confirmed', busy: false, email, message: CONFIRMED_NOTICE, error: null },
        form
      );
    },

    async resend() {
      if (!usable() || state.stage !== 'code' || state.busy || state.email === null) return;
      const email = state.email;
      const form = { stage: 'code' as const, busy: false, email };
      await request(
        { ...form, busy: true, message: null, error: null },
        () => registration.resend(email),
        { ...form, message: resentNotice, error: null },
        form
      );
    },

    cancel() {
      if (disposed) return;
      reset(IDLE, true);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      state = { ...IDLE };
      settle(() => registration.dispose());
    },
  };
}
