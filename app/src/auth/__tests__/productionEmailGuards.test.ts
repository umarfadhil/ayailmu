// Production email guards, RED. In a production build (environment 'production' with the productionAccounts capability)
// the password sign-in takes a conventional address only, checked by its format alone before anything is built or sent.
// Any other address is refused with the neutral invalid_email code (never advice to use a .test address): the session
// stays signed out and nothing is sent. The hosts are fictional placeholders (example.org) and the values fixtures only:
// nothing here contacts anything, and no address or password appears in a case name or a failure message.
import { createSupabaseAuth } from '@/auth/supabaseAuth';

const CONFIG = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: 'https://api.example.org',
  authUrl: 'https://auth.example.org',
} as const;

const PASSWORD = 'fixture-password-only';

it.each([
  ['a final line feed', 'learner@example.org\n'],
  ['a final carriage return and line feed', 'learner@example.org\r\n'],
  ['a leading space', ' learner@example.org'],
  ['a trailing space', 'learner@example.org '],
  ['an embedded control character', 'lear\u0000ner@example.org'],
  ['an embedded line feed', 'lear\nner@example.org'],
  ['an empty address', ''],
  ['no @', 'learner.example.org'],
  ['a doubled @', 'learner@@example.org'],
  ['a second @', 'lear@ner@example.org'],
  ['a leading dot in the local part', '.learner@example.org'],
  ['a trailing dot in the local part', 'learner.@example.org'],
  ['consecutive dots in the local part', 'lear..ner@example.org'],
  ['a 65-character local part', `${'a'.repeat(65)}@example.org`],
  ['an empty domain label', 'learner@example..org'],
  ['a 64-character domain label', `learner@${'a'.repeat(64)}.example.org`],
  ['a leading hyphen in a domain label', 'learner@-example.org'],
  ['a trailing hyphen in a domain label', 'learner@example-.org'],
  ['localhost', 'learner@localhost'],
  ['an IP address literal', 'learner@[127.0.0.1]'],
  ['a bare IP address', 'learner@127.0.0.1'],
])('a production sign-in with %s is refused as invalid_email, stays signed out and sends nothing', async (_case, email) => {
  const probe = jest.fn(() => {
    throw new Error('nothing may be sent');
  });
  const auth = createSupabaseAuth({ config: CONFIG, fetch: probe as unknown as typeof fetch });

  await expect(auth.signIn(email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_email' });
  expect(auth.status()).toEqual({ state: 'signed-out' });
  // Counted, not listed: a failure never prints a request, so never the address or the password.
  expect(probe).toHaveBeenCalledTimes(0);
});
