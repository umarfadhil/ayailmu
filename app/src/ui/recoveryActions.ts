// Password recovery's actions, apart from any React state: each step runs through the private auth.recovery only, and
// what it ends in is shown only while it is still the latest step. Every step, cancel, normal sign-in and dispose moves
// the epoch on, so a late result of an older step is dropped. Nothing here keeps an email, a password or a link.
import type { PasswordRecovery } from '@/auth/recovery';
import type { RecoveryPanelModel } from '@/ui/account/AccountPanel';
import { recoveryFailure } from '@/ui/recoveryMessages';

export type RecoveryView = Pick<RecoveryPanelModel, 'stage' | 'busy' | 'message'>;

export interface RecoveryActions {
  /** Opens the email step, dropping any recovery under way, and takes links again. */
  start(): void;
  /** Asks for a link, from the email step only and while nothing is on its way. */
  request(email: string): void;
  /** Takes a recovery link (already known to be one), unless recovery was cancelled or a normal sign-in began. */
  resume(url: string): void;
  /** The launch link could not be read or watched: shows it as a failed link (not as none), leaving the pending attempt. */
  launchFailed(error: unknown): void;
  /** Changes the password, from the ready step only and while nothing is on its way. */
  update(password: string): void;
  cancel(): void;
  /** A normal sign-in or sign-out is starting: recovery ends and takes no link until started again. */
  normalStarting(): void;
  /** Ends recovery for good, publishing nothing more. */
  dispose(): void;
  getEpoch(): number;
  /** Who hears that recovery has begun, from now on (none with undefined); it changes nothing else. */
  setOnIntent(listener?: () => void): void;
}

const SENT = 'Jika alamat ini terdaftar, ikuti tautan pemulihan di perangkat dan tab yang sama.';
const CHECKING = 'Memeriksa tautan pemulihan…';
const UPDATED = 'Kata sandi sudah diganti. Masuk dengan kata sandi baru.';
const NOT_REVOKED = ' Penutupan sesi pemulihan belum dapat dipastikan.';
const IDLE: RecoveryView = { stage: 'idle', busy: false, message: null };

export function createRecoveryActions(
  recovery: PasswordRecovery | undefined,
  publish: (view: RecoveryView) => void,
  onIntent?: () => void,
): RecoveryActions {
  let view: RecoveryView = IDLE;
  let epoch = 0;
  let active = true;
  let accepting = true;
  let notifyIntent = onIntent;

  const live = (at: number) => active && at === epoch;
  const emit = (next: RecoveryView) => {
    view = next;
    if (active) publish(next);
  };
  const unavailable = (): RecoveryView => ({ ...recoveryFailure(undefined, 'request'), busy: false });
  const intent = () => {
    try {
      notifyIntent?.();
    } catch {
      // The caller's own fence; recovery goes on regardless.
    }
  };
  /** Ends the core's recovery under way, invoked now so it is fenced before any later step; its outcome is not awaited. */
  const retire = () => {
    if (!recovery) return;
    try {
      recovery.cancel().catch(() => undefined);
    } catch {
      // Nothing more to end.
    }
  };
  /** Runs one step and shows how it ended, only while it is still the latest one. */
  const run = async <T>(
    at: number,
    step: () => Promise<T>,
    done: (result: T) => RecoveryView,
    operation: 'request' | 'resume' | 'update',
  ) => {
    try {
      const result = await step();
      if (live(at)) emit(done(result));
    } catch (error) {
      if (live(at)) emit({ ...recoveryFailure(error, operation), busy: false });
    }
  };
  const stop = () => {
    if (!active) return;
    epoch += 1;
    accepting = false;
    retire();
    if (view !== IDLE) emit(IDLE);
  };

  return {
    start() {
      if (!active) return;
      epoch += 1;
      accepting = true;
      retire();
      intent();
      emit(recovery ? { stage: 'email', busy: false, message: null } : unavailable());
    },
    request(email: string) {
      if (!active || !accepting || view.busy || view.stage !== 'email') return;
      const at = ++epoch;
      const core = recovery;
      if (!core) {
        emit(unavailable());
        return;
      }
      emit({ stage: 'email', busy: true, message: null });
      void run(at, () => core.request(email), () => ({ stage: 'sent', busy: false, message: SENT }), 'request');
    },
    resume(url: string) {
      if (!active || !accepting) return;
      const at = ++epoch;
      intent();
      const core = recovery;
      if (!core) {
        emit(unavailable());
        return;
      }
      emit({ stage: 'sent', busy: true, message: CHECKING });
      void run(at, () => core.resume(url), () => ({ stage: 'ready', busy: false, message: null }), 'resume');
    },
    launchFailed(error: unknown) {
      if (!active) return;
      epoch += 1;
      intent();
      emit({ ...recoveryFailure(error, 'resume'), busy: false });
    },
    update(password: string) {
      if (!active || !accepting || view.stage !== 'ready' || view.busy) return;
      const at = ++epoch;
      const core = recovery;
      if (!core) {
        emit(unavailable());
        return;
      }
      emit({ stage: 'ready', busy: true, message: null });
      void run(
        at,
        () => core.update(password),
        ({ revoked }) => ({ stage: 'done', busy: false, message: revoked === true ? UPDATED : UPDATED + NOT_REVOKED }),
        'update',
      );
    },
    cancel: stop,
    normalStarting: stop,
    dispose() {
      if (!active) return;
      active = false;
      epoch += 1;
      accepting = false;
      retire();
    },
    getEpoch() {
      return epoch;
    },
    setOnIntent(listener?: () => void) {
      notifyIntent = listener;
    },
  };
}
