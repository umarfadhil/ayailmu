// The registration flow as a small state machine over the registration adapter (auth/registration.ts), for a later hook
// and AccountPanel. It only orchestrates: email stage (register), code stage (confirm, resend) and confirmed, after which
// the learner signs in with the password elsewhere; no session, account or sign-in is ever taken here. Its state holds
// the saved synthetic address and a stable Indonesian message only, never a password, code, token or user id, and
// nothing is stored or logged. One request at a time: an action in another stage, while busy, while inactive or after
// dispose sends nothing. A newer start, cancel, an inactive owner or dispose drops the reply under way.
import { LOCAL_SUPABASE, type EnabledSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import { RegistrationError, type Registration, type RegistrationErrorCode } from '@/auth/registration';

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

/**
 * Whether the registration UI may be offered: the flag exactly "on", with an enabled local-supabase configuration in a
 * local build (no environment) or exactly staging. Never production, the production capability, or anything unknown.
 */
export function registrationAllowed(config: SupabaseConfig, flag: string | undefined = process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION): boolean {
  if (flag !== 'on' || typeof config !== 'object' || config === null) return false;
  const { enabled, provider, environment, productionAccounts } = config as Partial<EnabledSupabaseConfig>;
  return enabled === true && provider === LOCAL_SUPABASE && productionAccounts === undefined && (environment === undefined || environment === 'staging');
}

/** The adapter's rule: a .test domain, matched whole and untrimmed, checked here so nothing reaches the adapter otherwise. */
const SYNTHETIC_ADDRESS = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const isSyntheticAddress = (email: unknown): email is string => typeof email === 'string' && email.length <= 254 && SYNTHETIC_ADDRESS.test(email);

const CODE_NOTICE = 'Masukkan kode dari kotak masuk uji.';
const CONFIRMED_NOTICE = 'Email terkonfirmasi. Masuk dengan kata sandi Anda.';
const RESENT_NOTICE = 'Permintaan kode baru diterima. Periksa kotak masuk uji.';

const MESSAGES: Record<RegistrationErrorCode, string> = {
  not_synthetic: 'Gunakan alamat email uji yang berakhiran .test.',
  invalid_code: 'Kode tidak cocok atau sudah kedaluwarsa. Coba lagi.',
  weak_password: 'Kata sandi terlalu lemah. Gunakan kata sandi yang lebih panjang.',
  rate_limited: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  network: 'Server akun tidak terjangkau. Periksa koneksi lalu coba lagi.',
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

export function createRegistrationController({ registration, active, onChange }: RegistrationControllerOptions): RegistrationController {
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
      if (!isSyntheticAddress(email)) return set({ ...form, message: MESSAGES.not_synthetic, error: 'not_synthetic' });
      await request(
        { ...form, busy: true, message: null, error: null },
        () => registration.register(email, password),
        { stage: 'code', busy: false, email, message: CODE_NOTICE, error: null },
        form
      );
    },

    useCode(email) {
      if (!usable() || state.busy) return;
      if (!isSyntheticAddress(email)) {
        const stage = state.stage === 'email' ? 'email' : 'idle';
        return reset({ stage, busy: false, email: null, message: MESSAGES.not_synthetic, error: 'not_synthetic' }, false);
      }
      reset({ stage: 'code', busy: false, email, message: CODE_NOTICE, error: null }, false);
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
        { ...form, message: RESENT_NOTICE, error: null },
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
