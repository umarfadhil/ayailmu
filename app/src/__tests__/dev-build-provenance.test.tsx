// C3 in app/docs/plans/2026-10-20-correctness.md, written before the change: «Data pengembang» says which build the
// bundle reports. Two build-time public variables, EXPO_PUBLIC_BUILD_REVISION and EXPO_PUBLIC_BUILD_DIRTY, are read when
// the page renders and shown only once sanitized: a revision of 7 to 40 lowercase hex digits, and a dirty flag of
// exactly "true" or "false". Anything missing, malformed or unsafe (a path, a host, a line break) shows as unknown, and
// no raw value reaches the page. The line says the revision was reported at build time and claims nothing about HEAD,
// the runtime or the native app; in a development-server bundle (__DEV__) the page adds that the code may have changed
// since the server started. The real Dev route, AppProvider and KvStore run here; the test supplies the device storage
// and the build variables, and puts the process environment and __DEV__ back after each test.
import { screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { KvStore, memoryKv } from '@/storage/kvStore';
import { AppProvider } from '@/ui/AppContext';

import Dev from '@/app/dev';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

const FULL = '0123456789abcdef0123456789abcdef01234567';
const SHORT = '0123abc';
const LABEL = 'Revisi bundel (dilaporkan saat build)';
const CLEAN = 'tanpa perubahan yang belum di-commit';
const DIRTY = 'ada perubahan yang belum di-commit';
const STATUS_UNKNOWN = 'status perubahan tidak diketahui';
const UNKNOWN = 'tidak diketahui';
/** The page's provenance line for a revision (or unknown) and a change status. */
const line = (revision: string, status: string) => `${LABEL}: ${revision}; ${status}.`;
const DEV_SERVER = 'Bundel dari server pengembangan: kodenya bisa sudah berubah sejak server dimulai.';
/** Markers inside the unsafe values below: none may ever be shown. */
const UNSAFE_MARKERS = /secret-path-marker|build-host-marker/;

const KEYS = ['EXPO_PUBLIC_BUILD_REVISION', 'EXPO_PUBLIC_BUILD_DIRTY', 'EXPO_PUBLIC_APP_MODE'] as const;
/** The process's own values, put back after every test. */
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const devGlobal = globalThis as { __DEV__?: boolean };
const BASELINE_DEV = devGlobal.__DEV__;

/** The developer-demo build (where the page is shown) with these build values; undefined leaves a variable unset. */
function build(revision: string | undefined, dirty: string | undefined) {
  delete process.env.EXPO_PUBLIC_APP_MODE;
  if (revision === undefined) delete process.env.EXPO_PUBLIC_BUILD_REVISION;
  else process.env.EXPO_PUBLIC_BUILD_REVISION = revision;
  if (dirty === undefined) delete process.env.EXPO_PUBLIC_BUILD_DIRTY;
  else process.env.EXPO_PUBLIC_BUILD_DIRTY = dirty;
}

/** An empty guest dataset as the web build opens it (the AppProvider's store factory). */
async function openGuest() {
  const store = new KvStore(memoryKv());
  await store.init();
  return store;
}

function TestLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider storeFactory={openGuest}>
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function HomeStub() {
  return <Text testID="home-stub">Beranda</Text>;
}

async function openDev() {
  await renderRouter({ _layout: TestLayout, index: HomeStub, dev: Dev }, { initialUrl: '/dev' });
  await screen.findByText('Data pengembang', {}, { timeout: 5000 });
}

afterEach(() => {
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  devGlobal.__DEV__ = BASELINE_DEV;
});

const CASES: { case: string; revision?: string; dirty?: string; shown: string }[] = [
  { case: 'a full revision without uncommitted changes', revision: FULL, dirty: 'false', shown: line(FULL, CLEAN) },
  { case: 'a short revision with uncommitted changes', revision: SHORT, dirty: 'true', shown: line(SHORT, DIRTY) },
  { case: 'nothing reported at build time', shown: line(UNKNOWN, STATUS_UNKNOWN) },
  { case: 'an uppercase revision and a dirty flag that is not exactly true or false', revision: '0123ABC', dirty: 'TRUE', shown: line(UNKNOWN, STATUS_UNKNOWN) },
  { case: 'a revision of 41 hex digits beside a valid dirty flag', revision: `${FULL}0`, dirty: 'false', shown: line(UNKNOWN, CLEAN) },
  {
    case: 'unsafe values: a path for the revision, a line break and a host in the dirty flag',
    revision: '/Users/builder/secret-path-marker',
    dirty: 'false\nbuild-host-marker.internal',
    shown: line(UNKNOWN, STATUS_UNKNOWN),
  },
];

describe('Data pengembang: the build the bundle reports (C3)', () => {
  it.each(CASES)('$case', async ({ revision, dirty, shown }) => {
    build(revision, dirty);
    await openDev();

    expect(screen.getByTestId('build-provenance')).toHaveTextContent(shown);
    // Jest runs a development bundle: the page says the code may have changed since the server started.
    expect(screen.getByTestId('build-provenance-dev')).toHaveTextContent(DEV_SERVER);
    expect(screen.queryAllByText(UNSAFE_MARKERS)).toHaveLength(0);
  });

  // Last in this file: __DEV__ is false only for this test, and put back after it.
  it('an exported bundle (not __DEV__) shows the reported revision without the development-server note', async () => {
    devGlobal.__DEV__ = false;
    build(FULL, 'false');
    await openDev();

    expect(screen.getByTestId('build-provenance')).toHaveTextContent(line(FULL, CLEAN));
    expect(screen.queryByTestId('build-provenance-dev')).toBeNull();
  });
});
