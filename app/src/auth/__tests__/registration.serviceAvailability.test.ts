/** @jest-environment node */
import { inspect } from 'util';

import { createRegistration, RegistrationError, type Registration } from '@/auth/registration';
import {
  createRegistrationController,
  type RegistrationController,
  type RegistrationState,
} from '@/ui/account/registrationController';

// A received HTTP 503 means the Auth server answered, so it is service_unavailable and never network (unreachable). The
// maintained SDK runs under createRegistration and the controller against injected synthetic HTTP only: native Response
// objects carrying the address they answer, reserved example.org origins, no provider, mail or network.

const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const CONFIG = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: API,
  authUrl: AUTH,
} as const;

const EMAIL = 'learner@example.org';
const PASSWORD = 'Sentinel-Password-7391!';
const CODE = '48201793';
const PROVIDER_TEXT = 'gateway-sentinel-text-never-shown';
const UNAVAILABLE_MESSAGE = 'Layanan akun sedang tidak tersedia. Coba lagi nanti.';

/** The user GoTrue answers a sign-up with while the address still waits for its code: no session. */
const PENDING_USER = {
  id: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  aud: 'authenticated',
  role: '',
  email: EMAIL,
  phone: '',
  confirmation_sent_at: '2026-10-31T00:00:00Z',
  created_at: '2026-10-31T00:00:00Z',
  updated_at: '2026-10-31T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

type Answer = { status: number; body: unknown } | 'unreachable';

const UNAVAILABLE: Answer = { status: 503, body: { code: 503, error_code: 'unexpected_failure', msg: PROVIDER_TEXT } };

/** Answers each request in turn; a request beyond the script finds the network down. Every request is noted. */
function synthetic(...answers: Answer[]) {
  const calls: string[] = [];
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const answer = answers.shift();
    if (answer === undefined || answer === 'unreachable') throw new TypeError('Network request failed');
    const reply = new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    // A native Response has no url of its own, and the transport takes a reply only from the address it asked.
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  };
  return { fetch: send as typeof fetch, calls };
}

const registrationFor = (http: ReturnType<typeof synthetic>): Registration =>
  createRegistration({ config: CONFIG, emailPolicy: 'confirmed-email', fetch: http.fetch });

function controllerFor(registration: Registration) {
  const states: RegistrationState[] = [];
  const controller = createRegistrationController({
    registration,
    active: () => true,
    emailPolicy: 'confirmed-email',
    onChange: (state) => states.push(state),
  });
  return { controller, states };
}

const failure = (attempt: Promise<unknown>) => attempt.then(() => null, (error: unknown) => error);
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

function expectNoSecrets(visible: string) {
  for (const secret of [PASSWORD, CODE, PROVIDER_TEXT]) expect(visible).not.toContain(secret);
}

interface Operation {
  name: string;
  path: string;
  /** The controller stage its failure leaves the learner in. */
  stage: 'email' | 'code';
  direct: (registration: Registration) => Promise<unknown>;
  driven: (controller: RegistrationController) => Promise<void>;
}

const OPERATIONS: Operation[] = [
  {
    name: 'register',
    path: '/signup',
    stage: 'email',
    direct: (registration) => registration.register(EMAIL, PASSWORD),
    driven: async (controller) => {
      controller.start();
      await controller.register(EMAIL, PASSWORD);
    },
  },
  {
    name: 'confirm',
    path: '/verify',
    stage: 'code',
    direct: (registration) => registration.confirm(EMAIL, CODE),
    driven: async (controller) => {
      controller.useCode(EMAIL);
      await controller.confirm(CODE);
    },
  },
  {
    name: 'resend',
    path: '/resend',
    stage: 'code',
    direct: (registration) => registration.resend(EMAIL),
    driven: async (controller) => {
      controller.useCode(EMAIL);
      await controller.resend();
    },
  },
];

const globalFetch = jest.fn(async () => {
  throw new Error('unexpected global fetch');
});
let savedFetch: PropertyDescriptor | undefined;

beforeEach(() => {
  jest.useRealTimers();
  savedFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { value: globalFetch, configurable: true, writable: true });
});

afterEach(() => {
  if (savedFetch) Object.defineProperty(globalThis, 'fetch', savedFetch);
  else delete (globalThis as Record<string, unknown>).fetch;
  expect(globalFetch).not.toHaveBeenCalled();
});

describe('registration when the Auth server answers HTTP 503 (maintained SDK, injected HTTP)', () => {
  describe.each(OPERATIONS)('$name', ({ path, stage, direct, driven }) => {
    it('is service_unavailable after exactly one request, with no retry, logout or leaked text', async () => {
      const http = synthetic(UNAVAILABLE);
      const registration = registrationFor(http);

      const error = await failure(direct(registration));
      expect(error).toBeInstanceOf(RegistrationError);
      expect((error as RegistrationError).code).toBe('service_unavailable');

      await settled();
      expect(http.calls).toEqual([`POST ${AUTH}${path}`]);
      expectNoSecrets(inspect(error, { depth: 5 }));
      await registration.dispose();
    });

    it('leaves the controller in its stage, idle, with the unavailable message and no claim of success', async () => {
      const http = synthetic(UNAVAILABLE);
      const registration = registrationFor(http);
      const { controller, states } = controllerFor(registration);

      await driven(controller);
      await settled();

      expect(controller.read()).toMatchObject({ stage, busy: false, error: 'service_unavailable', message: UNAVAILABLE_MESSAGE });
      expect(states.map((state) => state.stage)).not.toContain('confirmed');
      expect(http.calls).toEqual([`POST ${AUTH}${path}`]);
      expectNoSecrets(JSON.stringify([...states, controller.read()]));
      controller.dispose();
    });
  });

  describe('a manual retry', () => {
    it('lets the adapter reach confirmation_required once the server is back', async () => {
      const http = synthetic(UNAVAILABLE, { status: 200, body: PENDING_USER });
      const registration = registrationFor(http);

      expect(((await failure(registration.register(EMAIL, PASSWORD))) as RegistrationError).code).toBe('service_unavailable');
      await settled();
      expect(http.calls).toHaveLength(1);

      await expect(registration.register(EMAIL, PASSWORD)).resolves.toEqual({ status: 'confirmation_required' });
      expect(http.calls).toEqual([`POST ${AUTH}/signup`, `POST ${AUTH}/signup`]);
      await registration.dispose();
    });

    it('lets the controller move on to the code stage, one request per attempt', async () => {
      const http = synthetic(UNAVAILABLE, { status: 200, body: PENDING_USER });
      const { controller } = controllerFor(registrationFor(http));

      controller.start();
      await controller.register(EMAIL, PASSWORD);
      await settled();
      expect(controller.read()).toMatchObject({ stage: 'email', busy: false, error: 'service_unavailable' });
      expect(http.calls).toHaveLength(1);

      await controller.register(EMAIL, PASSWORD);
      expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
      expect(http.calls).toEqual([`POST ${AUTH}/signup`, `POST ${AUTH}/signup`]);
      controller.dispose();
    });
  });

  describe('other failures keep their own codes', () => {
    const controls: { name: string; call: (registration: Registration) => Promise<unknown>; answer: Answer; code: string }[] = [
      {
        name: 'a thrown network failure',
        call: (registration) => registration.register(EMAIL, PASSWORD),
        answer: 'unreachable',
        code: 'network',
      },
      {
        name: 'HTTP 429',
        call: (registration) => registration.register(EMAIL, PASSWORD),
        answer: { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: PROVIDER_TEXT } },
        code: 'rate_limited',
      },
      {
        name: 'HTTP 400 for a wrong code',
        call: (registration) => registration.confirm(EMAIL, CODE),
        answer: { status: 400, body: { code: 400, error_code: 'otp_expired', msg: PROVIDER_TEXT } },
        code: 'invalid_code',
      },
      {
        name: 'a well-formed reply of the wrong shape',
        call: (registration) => registration.register(EMAIL, PASSWORD),
        answer: { status: 200, body: { unexpected: true } },
        code: 'bad_response',
      },
    ];

    it.each(controls)('$name stays $code', async ({ call, answer, code }) => {
      const registration = registrationFor(synthetic(answer));

      expect(((await failure(call(registration))) as RegistrationError).code).toBe(code);
      await registration.dispose();
    });
  });
});
