// Boundary regression: a validated learning-beta profile is bounded starter access, not content approval. It must
// never reach the broader legacy routes or the learner navigation, even with a learner, projected content and a
// review claim present. Each route wrapper has to Redirect Home before HydrationGate (so before any legacy
// hydration or learning effect); a profile with the capability off keeps its routes and navigation unchanged.
import { render } from '@testing-library/react-native';
import type { ComponentType } from 'react';

import GuideRoute from '@/app/guide';
import NextLessonRoute from '@/app/next-lesson';
import ProgressRoute from '@/app/progress';
import SessionRoute from '@/app/session';
import SummaryRoute from '@/app/summary';
import { useLearnerNav } from '@/ui/Nav';

const mockRedirect = jest.fn((_props: { href: string }) => null);
const mockGate = jest.fn();
// Fixed ready, writable tester state with a learner and showable content: nothing here argues for the boundary.
const mockApp = {
  ready: true,
  error: null,
  readOnly: null,
  rules: { mode: 'tester' },
  learner: { learner_id: 'learner-1' },
  dataset: 'core',
  store: {},
  content: { empty: false },
};

jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
}));
jest.mock('@/ui/AppContext', () => ({ useApp: () => mockApp }));
// Rendering the gate is the failure: the sentinel makes a legacy mount a readable red, not a missing-setup error.
jest.mock('@/ui/Hydration', () => ({
  HydrationGate: () => {
    mockGate();
    throw new Error('legacy HydrationGate mounted');
  },
}));

const BETA_ENV: Record<string, string> = {
  AUTH_PROVIDER: 'local-supabase',
  ACCOUNT_ENV: 'learning-beta',
  LEARNING_BETA: 'on',
  APP_MODE: 'tester',
  PRODUCTION_ACCOUNTS: 'off',
  PRIVATE_QA: 'off',
  PRIVATE_BETA: 'off',
  ACCOUNT_REGISTRATION: 'off',
  GOOGLE_SIGN_IN: 'off',
  PASSWORD_RECOVERY: 'off',
  API_BASE_URL: 'https://api.beta.example.com',
  SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
};
const envKey = (name: string) => `EXPO_PUBLIC_${name}`;

const ROUTES: [string, ComponentType][] = [
  ['/guide', GuideRoute],
  ['/session', SessionRoute],
  ['/progress', ProgressRoute],
  ['/summary', SummaryRoute],
  ['/next-lesson', NextLessonRoute],
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  jest.clearAllMocks();
  saved = {};
  for (const [name, value] of Object.entries(BETA_ENV)) {
    saved[envKey(name)] = process.env[envKey(name)];
    process.env[envKey(name)] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('validated learning-beta boundary', () => {
  it.each(ROUTES)('%s redirects Home without mounting the legacy HydrationGate', async (_path, Route) => {
    const mounted = (async () => render(<Route />))();
    // A legacy mount rejects with the sentinel, so a missing boundary fails here with a meaningful message.
    await expect(mounted).resolves.toHaveProperty('unmount');
    (await mounted).unmount();

    expect(mockGate).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/' }));
  });

  it('hides the learner nav in learning-beta, and shows it for the same learner and content with the capability off', () => {
    expect(useLearnerNav()).toBe(false);

    process.env[envKey('LEARNING_BETA')] = 'off';
    expect(useLearnerNav()).toBe(true);
  });
});
