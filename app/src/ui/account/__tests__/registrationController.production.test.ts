import type { SupabaseConfig } from '@/account/supabaseConfig';
import type { Registration } from '@/auth/registration';
import {
  createRegistrationController,
  registrationAllowed,
  type RegistrationController,
  type RegistrationControllerOptions,
} from '@/ui/account/registrationController';

// Mock-only: the Registration port is a fake, so this proves the controller's confirmed-email flow, never real SMTP
// delivery, phone confirmation or a reachable production Auth server. The fixture roots are reserved and never requested.
const EMAIL = 'learner@example.org';
const PASSWORD = 'Fixture-password-2026';
const CODE = '482913';

const config = (overrides: Record<string, unknown>) => overrides as unknown as SupabaseConfig;
const PRODUCTION = config({
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: 'https://api.example.org',
  authUrl: 'https://auth.example.org',
});
const LOCAL = config({ enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' });
const STAGING = config({ ...(LOCAL as object), environment: 'staging', apiBaseUrl: 'https://api.example.org', authUrl: 'https://auth.example.org' });

function fakePort() {
  const port = {
    register: jest.fn((_email: string, _password: string) => Promise.resolve({ status: 'confirmation_required' })),
    confirm: jest.fn((_email: string, _code: string) => Promise.resolve({ status: 'confirmed', signInRequired: true })),
    resend: jest.fn((_email: string) => Promise.resolve({ status: 'resent' })),
    cancel: jest.fn(() => Promise.resolve(undefined)),
    dispose: jest.fn(() => Promise.resolve(undefined)),
  };
  return { port, registration: port as unknown as Registration };
}

const created: RegistrationController[] = [];
function confirmedController(registration: Registration): RegistrationController {
  const options = { registration, active: () => true, emailPolicy: 'confirmed-email' } as RegistrationControllerOptions & {
    emailPolicy: 'confirmed-email';
  };
  const controller = createRegistrationController(options);
  created.push(controller);
  return controller;
}

const savedFlag = process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION;
beforeEach(() => {
  delete process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION;
});
afterEach(() => {
  created.splice(0).forEach((controller) => controller.dispose());
  if (savedFlag === undefined) delete process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION;
  else process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION = savedFlag;
});

describe('registration controller, confirmed-email policy (mock port only; no SMTP or phone proof)', () => {
  it('allows confirmed-email only for an explicit, validated production configuration', () => {
    expect(registrationAllowed(PRODUCTION, 'confirmed-email')).toBe(true);
    expect(registrationAllowed(PRODUCTION, 'on')).toBe(false);
    expect(registrationAllowed(PRODUCTION, 'off')).toBe(false);
    expect(registrationAllowed(PRODUCTION, undefined)).toBe(false);

    expect(registrationAllowed(LOCAL, 'on')).toBe(true);
    expect(registrationAllowed(STAGING, 'on')).toBe(true);
    expect(registrationAllowed(LOCAL, 'confirmed-email')).toBe(false);
    expect(registrationAllowed(STAGING, 'confirmed-email')).toBe(false);

    const unsafe = [
      config({ ...(PRODUCTION as object), apiBaseUrl: 'http://api.example.org' }),
      config({ ...(PRODUCTION as object), authUrl: 'https://user:secret@auth.example.org' }),
      config({ ...(PRODUCTION as object), productionAccounts: undefined }),
      config({ ...(PRODUCTION as object), authUrl: 'https://api.example.org' }),
      config({ ...(PRODUCTION as object), provider: 'hosted-other' }),
    ];
    for (const candidate of unsafe) expect(registrationAllowed(candidate, 'confirmed-email')).toBe(false);
  });

  it('registers a conventional address and points to the email inbox without keeping the password', async () => {
    const { port, registration } = fakePort();
    const controller = confirmedController(registration);
    controller.start();
    await controller.register(EMAIL, PASSWORD);

    const state = controller.read();
    expect(state).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
    expect(port.register).toHaveBeenCalledTimes(1);
    expect(port.register).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(state.message).toMatch(/email/i);
    expect(state.message).not.toMatch(/uji/i);
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
  });

  it.each(['', ` ${EMAIL}`, 'learner..x@example.org', 'learner@127.0.0.1', `${'a'.repeat(65)}@example.org`])(
    'refuses %j as invalid_email before the port is called',
    async (address) => {
      const { port, registration } = fakePort();
      const controller = confirmedController(registration);
      controller.start();
      await controller.register(address, PASSWORD);

      expect(controller.read()).toMatchObject({ stage: 'email', busy: false, email: null, error: 'invalid_email' });
      expect(port.register).not.toHaveBeenCalled();
    },
  );

  it('re-enters the code stage, resends and confirms with the saved address, retaining no password or code', async () => {
    const { port, registration } = fakePort();
    const controller = confirmedController(registration);
    controller.useCode(EMAIL);
    expect(controller.read()).toMatchObject({ stage: 'code', email: EMAIL, error: null });
    expect(port.register).not.toHaveBeenCalled();
    expect(port.resend).not.toHaveBeenCalled();

    await controller.resend();
    expect(port.resend).toHaveBeenCalledWith(EMAIL);
    expect(controller.read()).toMatchObject({ stage: 'code', email: EMAIL, error: null });
    expect(controller.read().message).not.toMatch(/uji/i);

    await controller.confirm(CODE);
    expect(port.confirm).toHaveBeenCalledWith(EMAIL, CODE);
    const state = controller.read();
    expect(state).toMatchObject({ stage: 'confirmed', busy: false, email: EMAIL, error: null });
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
    expect(JSON.stringify(state)).not.toContain(CODE);
  });

  it('does not revive the flow when a deferred register reply arrives after cancel', async () => {
    const { port, registration } = fakePort();
    let resolve: (value: { status: string }) => void = () => undefined;
    port.register.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const controller = confirmedController(registration);
    controller.start();

    const pending = controller.register(EMAIL, PASSWORD);
    expect(controller.read().busy).toBe(true);
    controller.cancel();
    expect(controller.read()).toMatchObject({ stage: 'idle', busy: false, email: null });

    resolve({ status: 'confirmation_required' });
    await pending;
    expect(controller.read()).toMatchObject({ stage: 'idle', busy: false, email: null, error: null });
    expect(port.cancel).toHaveBeenCalled();
  });
});
