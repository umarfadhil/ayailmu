// Registration's lifecycle for the account provider: one registration adapter and controller per account service, only
// where registrationPolicy names a policy (synthetic: the flag exactly "on", local or staging; confirmed-email: the flag
// exactly "confirmed-email" in a validated production build; private-qa-confirmed-email: the private QA build, with its
// injected fetch only), read once from a snapshot of the configuration, and the
// panel's model over them. The flow itself is the controller's; this only wires it to React state, to the app's
// foreground and to the provider's lifetime. Each model carries the fence it was made under: a normal sign-in or
// sign-out, recovery, the app leaving the foreground, another account service or unmounting drops the flow, its late
// reply and every model handed out before. The state shown holds no password, code or token, and nothing is stored.
// Off, it builds, subscribes and touches nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import type { EnabledSupabaseConfig, SupabaseConfig } from '@/account/supabaseConfig';
import { createRegistration, type RegistrationEmailPolicy } from '@/auth/registration';
import type { RegistrationPanelModel } from '@/ui/account/RegistrationPanel';
import { createRegistrationController, registrationPolicy, type RegistrationController, type RegistrationState } from '@/ui/account/registrationController';

export interface AccountRegistrationOptions {
  config: SupabaseConfig;
  /** The provider's account services: registration belongs to them, and other services (or none) get their own. */
  owner: object | null;
  /** Whether registration may run now: signed out, no normal account work under way, no recovery shown. */
  available: boolean;
  /** A registration action is about to run: the caller fences its own late normal results first. */
  onIntent: () => void;
  /**
   * The account clients' transport, captured once per owner: the private QA build's bound fetch, which its policy
   * requires (without it nothing is built). Absent: the platform's fetch as this provider found it.
   */
  fetch?: typeof fetch;
}

export interface AccountRegistrationState {
  panel: RegistrationPanelModel | undefined;
  /** Ends any registration at once (a normal sign-in, sign-out or recovery is starting); every model so far does nothing more. */
  cancel: () => void;
}

/** What the panel's model is made from: the fence it belongs to, whether the app is in the foreground, and the flow. */
interface Snapshot {
  epoch: number;
  foreground: boolean;
  state: RegistrationState;
}

/** One account service's registration, apart from React: its controller, fence and flags live in this closure only. */
interface OwnedRegistration {
  /** The policy validated once when this service's registration was opened. */
  readonly emailPolicy: RegistrationEmailPolicy;
  read(): Snapshot;
  mount(): void;
  /** Disposes the adapter through the controller, once; nothing is published afterwards. */
  unmount(): void;
  setAvailable(available: boolean): void;
  setForeground(foreground: boolean): void;
  fence(): void;
  /** Runs `action` only for a model of the current fence, while mounted, available and in the foreground. */
  act(epoch: number, intent: () => void, action: (controller: RegistrationController) => unknown): void;
  /** Cancels the flow and fences every model so far, for a model of the current fence only. */
  drop(epoch: number): void;
}

const IDLE: RegistrationState = { stage: 'idle', busy: false, email: null, message: null, error: null };
const atRest = (state: RegistrationState) => state.stage === 'idle' && !state.busy && state.message === null && state.error === null;
const isForeground = (state: unknown) => state !== 'background' && state !== 'inactive';

function openRegistration(
  config: EnabledSupabaseConfig,
  emailPolicy: RegistrationEmailPolicy,
  fetchImpl: typeof fetch,
  publish: (view: Snapshot & { owned: OwnedRegistration }) => void
): OwnedRegistration {
  // Named only for confirmed-email and private QA: the synthetic default leaves the adapter's and controller's options as they were.
  const policy: { emailPolicy?: RegistrationEmailPolicy } = emailPolicy !== 'synthetic' ? { emailPolicy } : {};
  let epoch = 0;
  let mounted = false;
  let available = false;
  let foreground = true;
  let controller: RegistrationController | null = null;

  const snapshot = (): Snapshot => ({ epoch, foreground, state: controller?.read() ?? IDLE });
  const emit = () => {
    if (mounted) publish({ owned, ...snapshot() });
  };
  // Building sends nothing and holds nothing until a call; a disposed controller never calls onChange again.
  const build = () =>
    createRegistrationController({
      registration: createRegistration({ config, fetch: fetchImpl, ...policy }),
      active: () => mounted && available && foreground,
      onChange: (state) => {
        if (mounted) publish({ owned, epoch, foreground, state });
      },
      ...policy,
    });
  /** Clears the flow at once; the adapter's cancel goes unawaited, so a hung SDK never keeps the UI waiting. */
  const clear = () => {
    try {
      if (controller && !atRest(controller.read())) return controller.cancel();
    } catch {
      // Cleared regardless below.
    }
    emit();
  };

  const owned: OwnedRegistration = {
    emailPolicy,
    read: snapshot,
    mount() {
      if (mounted) return;
      // A mount undone at once (StrictMode) disposed the first controller and fenced its models: this mount gets its own,
      // published at once so the panel shown is this mount's and not one of the abandoned fence.
      const replaced = !controller;
      if (replaced) {
        try {
          controller = build();
        } catch {
          controller = null;
        }
      }
      mounted = true;
      if (replaced) emit();
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      epoch += 1;
      const own = controller;
      controller = null;
      try {
        own?.dispose();
      } catch {
        // Already gone.
      }
    },
    setAvailable(next) {
      if (next === available) return;
      available = next;
      // Losing it fences every model so far, even an idle one, so none revives once it is available again.
      if (!next) owned.fence();
    },
    setForeground(next) {
      if (next === foreground) return;
      foreground = next;
      if (next) emit();
      else owned.fence();
    },
    fence() {
      epoch += 1;
      clear();
    },
    act(at, intent, action) {
      if (!mounted || at !== epoch || !controller || !available || !foreground) return;
      intent();
      // The caller's fence never reaches registration; checked again all the same.
      const own = controller;
      if (!mounted || at !== epoch || !own) return;
      try {
        void Promise.resolve(action(own)).catch(() => undefined);
      } catch {
        // The controller reports its own failures through its state.
      }
    },
    drop(at) {
      if (mounted && at === epoch) owned.fence();
    },
  };
  controller = build();
  return owned;
}

export function useAccountRegistration({ config, owner, available, onIntent, fetch: injected }: AccountRegistrationOptions): AccountRegistrationState {
  const [view, setView] = useState<(Snapshot & { owned: OwnedRegistration }) | null>(null);
  // Once per account service and transport, with the validated configuration and the given fetch (else the platform's
  // as this provider found it). The configuration is copied and frozen first and the policy read from that copy once, so
  // a later change to the caller's object can switch neither the policy nor the endpoints, across a StrictMode remount
  // included. Off, an unknown policy, the private policy without its fetch, or refused by the adapter's own checks:
  // nothing is built.
  const owned = useMemo(() => {
    if (!owner || !config.enabled) return null;
    try {
      const settled = Object.freeze({ ...config });
      const policy = registrationPolicy(settled);
      if (policy !== 'synthetic' && policy !== 'confirmed-email' && policy !== PRIVATE_QA_REGISTRATION_POLICY) return null;
      if (policy === PRIVATE_QA_REGISTRATION_POLICY && typeof injected !== 'function') return null;
      return openRegistration(settled, policy, injected ?? globalThis.fetch, setView);
    } catch {
      return null;
    }
  }, [config, owner, injected]);

  useEffect(() => {
    if (!owned) return;
    owned.mount();
    owned.setForeground(isForeground(AppState.currentState));
    // Leaving the foreground clears the flow and its typed forms; back in it, the entry is usable again.
    const subscription = AppState.addEventListener('change', (next) => owned.setForeground(isForeground(next)));
    return () => {
      try {
        subscription?.remove();
      } catch {
        // Already gone.
      }
      owned.unmount();
    };
  }, [owned]);

  useEffect(() => {
    owned?.setAvailable(available);
  }, [owned, available]);

  const cancel = useCallback(() => owned?.fence(), [owned]);

  // The fence of the model shown: until this service's registration publishes, it is read as it stands.
  const epoch = owned ? (view?.owned === owned ? view : owned.read()).epoch : 0;
  // One cancel per service and fence: stage or busy rerenders keep it, so the route's focus cleanup never runs for them.
  const drop = useCallback(() => owned?.drop(epoch), [owned, epoch]);

  const panel = useMemo<RegistrationPanelModel | undefined>(() => {
    if (!owned) return undefined;
    const { foreground, state } = view?.owned === owned ? view : owned.read();
    const act = (action: (controller: RegistrationController) => unknown) => owned.act(epoch, onIntent, action);
    return {
      ...state,
      ...(owned.emailPolicy !== 'synthetic' ? { emailPolicy: owned.emailPolicy } : {}),
      available: available && foreground,
      onStart: () => act((controller) => controller.start()),
      onRegister: (email: string, password: string) => act((controller) => controller.register(email, password)),
      onUseCode: (email: string) => act((controller) => controller.useCode(email)),
      onConfirm: (code: string) => act((controller) => controller.confirm(code)),
      onResend: () => act((controller) => controller.resend()),
      onCancel: drop,
      onSignIn: drop,
    };
  }, [owned, view, epoch, drop, available, onIntent]);

  return { panel, cancel };
}
