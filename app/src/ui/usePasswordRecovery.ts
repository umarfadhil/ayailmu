// Password recovery's lifecycle for the account provider: it watches the runtime's recovery links, says whether the normal
// automatic startup may go on, and gives the panel its recovery model. The steps themselves are recoveryActions'; this
// only wires them to React state and to the runtime. Off (no runtime or callback), it touches neither runtime nor core.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PasswordRecovery } from '@/auth/recovery';
import { ownsRecoveryUrl, type RecoveryRuntime } from '@/auth/recoveryRuntime';
import type { RecoveryPanelModel } from '@/ui/account/AccountPanel';
import { createRecoveryActions, type RecoveryView } from '@/ui/recoveryActions';

/** checking: the launch link is not known yet; normal: there is none, so the normal startup may go on; blocked: it may not. */
type Boot = 'checking' | 'normal' | 'blocked';

export interface PasswordRecoveryOptions {
  recovery?: PasswordRecovery;
  runtime: RecoveryRuntime | null;
  callbackUrl: string | null;
  /** Recovery has begun (a link or an explicit start): the caller fences its own late normal results. */
  onIntent?: () => void;
}

export interface PasswordRecoveryState {
  panel: RecoveryPanelModel | undefined;
  allowNormalStartup: boolean;
  /** The same as allowNormalStartup, read now: for effects and actions, not for rendering. */
  canAutoStart: () => boolean;
  /** An explicit normal sign-in or sign-out is starting: recovery ends and no older link reopens it. */
  normalStarting: () => void;
  /** Registers, from an effect, who hears that recovery has begun (in place of onIntent); undefined clears it. */
  setIntentHandler: (handler?: () => void) => void;
}

const IDLE_VIEW: RecoveryView = { stage: 'idle', busy: false, message: null };

export function usePasswordRecovery({ recovery, runtime, callbackUrl, onIntent }: PasswordRecoveryOptions): PasswordRecoveryState {
  const enabled = runtime !== null && callbackUrl !== null;
  const [view, setView] = useState<RecoveryView>(IDLE_VIEW);
  const [boot, setBoot] = useState<Boot>(enabled ? 'checking' : 'normal');
  const bootRef = useRef<Boot>(enabled ? 'checking' : 'normal');
  const onIntentRef = useRef(onIntent);
  useEffect(() => {
    onIntentRef.current = onIntent;
  }, [onIntent]);

  const gate = useCallback((next: Boot) => {
    bootRef.current = next;
    setBoot(next);
  }, []);
  const intent = useCallback(() => {
    gate('blocked');
    onIntentRef.current?.();
  }, [gate]);
  const actions = useMemo(() => createRecoveryActions(enabled ? recovery : undefined, setView), [enabled, recovery]);
  // Bound after render, before the runtime effect below, so a link it hands over is heard.
  useEffect(() => {
    actions.setOnIntent(intent);
    return () => actions.setOnIntent(undefined);
  }, [actions, intent]);

  useEffect(() => {
    if (!runtime || !callbackUrl) return;
    const epoch = actions.getEpoch();
    let closed = false;
    let started = false;
    let unsubscribe: (() => void) | null = null;
    /** Whether the launch link's outcome still decides: nothing newer came first. */
    const current = () => !closed && actions.getEpoch() === epoch && bootRef.current === 'checking';
    // Started a microtask later, so no state is set in this effect's body, and a mount undone at once starts nothing.
    Promise.resolve()
      .then(() => {
        if (closed) return null;
        started = true;
        unsubscribe = runtime.subscribe((raw) => {
          if (!closed && ownsRecoveryUrl(raw, callbackUrl)) actions.resume(raw);
        });
        return runtime.takeLaunchUrl(callbackUrl);
      })
      .then(
        (raw) => {
          if (!current()) return;
          if (raw !== null && ownsRecoveryUrl(raw, callbackUrl)) actions.resume(raw);
          else gate('normal');
        },
        (error: unknown) => {
          // Not knowing the launch link is not having none: the normal startup stays off.
          if (!current()) return;
          gate('blocked');
          actions.launchFailed(error);
        },
      )
      .catch(() => undefined);
    return () => {
      closed = true;
      try {
        unsubscribe?.();
      } catch {
        // Already gone.
      }
      // Only a run that started anything retires recovery: a mount undone at once (StrictMode) leaves the actions usable.
      if (started) actions.dispose();
    };
  }, [runtime, callbackUrl, actions, gate]);

  const canAutoStart = useCallback(() => !enabled || bootRef.current === 'normal', [enabled]);
  const normalStarting = useCallback(() => {
    if (!enabled) return;
    gate('blocked');
    actions.normalStarting();
  }, [enabled, gate, actions]);

  const panel = useMemo<RecoveryPanelModel | undefined>(() => {
    if (!runtime || !callbackUrl) return undefined;
    const reason = runtime.platform.kind === 'native' ? runtime.platform.unavailable : null;
    return {
      ...view,
      message: view.message ?? (reason !== null && view.stage !== 'idle' ? reason : null),
      available: Boolean(recovery) && reason === null,
      platform: runtime.platform.kind,
      onStart: () => actions.start(),
      onRequest: (email: string) => actions.request(email),
      onUpdate: (password: string) => actions.update(password),
      onCancel: () => actions.cancel(),
      onBack: () => actions.cancel(),
    };
  }, [view, runtime, callbackUrl, recovery, actions]);

  const setIntentHandler = useCallback((handler?: () => void) => {
    onIntentRef.current = handler;
  }, []);

  return { panel, allowNormalStartup: !enabled || boot === 'normal', canAutoStart, normalStarting, setIntentHandler };
}
