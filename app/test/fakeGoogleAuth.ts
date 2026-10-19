// Test-only model of Continue with Google at the local GoTrue, as the maintained @supabase/auth-js SDK drives it with the
// authorization code + PKCE flow, in front of the fake GoTrue and account API of fakeAccountApi.ts. The browser's trip
// (GET /authorize at GoTrue, Google's consent screen, GET /callback at GoTrue, then GoTrue's redirect to the app's
// callback with ?code=…) is played by consent(), which checks the authorize URL as GoTrue would (its own endpoint, the
// Google provider, an allow-listed redirect, an S256 challenge) and returns the app's callback URL; a Google account
// GoTrue does not know gets GoTrue's signup_disabled refusal instead (sign-up is off, as at the prepared server). The
// app's POST /token?grant_type=pkce must then present, once, the verifier whose S256 hash is that challenge. A completed
// exchange is a session of the fake GoTrue for the matching prepared user (minted through its own password grant, which
// the app never sends: `requests` records only what the app sent), shown as Google's: its user carries Google's
// provider, profile metadata and a provider token. Every other request goes to the fake account API unchanged. No real
// Google, Auth server or credential is involved: this is local mocked protocol evidence, never a real Google sign-in.
import { createHash, randomUUID } from 'crypto';

import { FAKE_GOTRUE, type FakeAccountApi, type FakeUser } from './fakeAccountApi';

/** A Google account: the prepared fake-GoTrue user it signs in as, whose password only this fake ever uses. */
export interface GoogleAccount extends FakeUser {
  /** Google's subject for the account. */
  googleSub: string;
  /** The name Google shares under the profile scope: the app must neither show nor store it. */
  name: string;
}

/** The S256 code challenge of a PKCE verifier (RFC 7636): base64url of its SHA-256, without padding. */
export const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** How the fake GoTrue answered each PKCE exchange the app sent. */
export type ExchangeOutcome = 'issued' | 'bad_verifier' | 'unknown_code';

interface Flow {
  challenge: string;
  account: GoogleAccount;
  used: boolean;
}

type Step = { kind: 'offline' } | { kind: 'hold'; arrived: () => void; reply: Promise<'delivered' | 'lost'> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export function fakeGoogleGoTrue(fake: FakeAccountApi, options: { redirects: string[]; known: GoogleAccount[] }) {
  const flows = new Map<string, Flow>();
  /** Each request the app sent to the Auth root, in order, as «POST /token?grant_type=pkce»: never a body or a header. */
  const requests: string[] = [];
  const exchanges: ExchangeOutcome[] = [];
  const secrets = new Set<string>(options.known.map((account) => account.password));
  const steps: Step[] = [];

  const reply = (status: number, body: unknown, url: string): Response => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      url,
      redirected: false,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
    } as unknown as Response;
  };
  const refusal = (status: number, errorCode: string, msg: string, url: string) => reply(status, { code: status, error_code: errorCode, msg }, url);

  /** GoTrue's checks of GET /authorize as the browser reaches it; anything else would never come back to the app. */
  function authorize(authorizeUrl: string) {
    const url = new URL(authorizeUrl);
    const query = url.searchParams;
    const redirect = query.get('redirect_to') ?? '';
    const challenge = query.get('code_challenge') ?? '';
    if (`${url.origin}${url.pathname}` !== `${FAKE_GOTRUE}/authorize`) throw new Error('fake GoTrue: not its authorize endpoint');
    if (query.get('provider') !== 'google') throw new Error('fake GoTrue: not the Google provider');
    if (!options.redirects.includes(redirect)) throw new Error('fake GoTrue: redirect_to is not allow-listed (GoTrue would send the browser to its site URL)');
    if ((query.get('code_challenge_method') ?? '').toLowerCase() !== 's256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new Error('fake GoTrue: no S256 code challenge');
    }
    return { redirect, challenge };
  }

  /** A session of the fake GoTrue for the account's prepared user, shown as Google's. */
  async function mint(account: GoogleAccount) {
    const minted = await fake.fetch(`${FAKE_GOTRUE}/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    });
    if (minted.status !== 200) throw new Error('fake GoTrue: the Google account has no prepared user');
    const session = JSON.parse(await minted.text()) as Record<string, unknown> & { user: Record<string, unknown> };
    const providerToken = `ya29.fake-google-${randomUUID()}`;
    secrets.add(providerToken);
    const profile = {
      email: account.email,
      email_verified: true,
      full_name: account.name,
      name: account.name,
      picture: 'https://lh3.googleusercontent.com/a/fake-picture',
      iss: 'https://accounts.google.com',
      provider_id: account.googleSub,
      sub: account.googleSub,
    };
    return {
      ...session,
      provider_token: providerToken,
      user: {
        ...session.user,
        app_metadata: { provider: 'google', providers: ['google'] },
        user_metadata: profile,
        identities: [{ identity_id: randomUUID(), id: account.googleSub, user_id: session.user.id, identity_data: profile, provider: 'google', email: account.email }],
      },
    };
  }

  /** POST /token?grant_type=pkce: applied when it arrives; the code is used once, with the verifier of its challenge. */
  async function exchange(url: string, init: RequestInit | undefined): Promise<Response> {
    const step = steps.shift();
    if (step?.kind === 'offline') throw new TypeError('Network request failed');
    let body: { auth_code?: unknown; code_verifier?: unknown } = {};
    try {
      body = JSON.parse(String(init?.body)) as typeof body;
    } catch {
      body = {};
    }
    if (typeof body.code_verifier === 'string') secrets.add(body.code_verifier);
    const flow = typeof body.auth_code === 'string' ? flows.get(body.auth_code) : undefined;
    let answer: Response;
    if (!flow || flow.used) {
      exchanges.push('unknown_code');
      answer = refusal(404, 'flow_state_not_found', 'invalid flow state, no valid flow state found', url);
    } else if (typeof body.code_verifier !== 'string' || s256(body.code_verifier) !== flow.challenge) {
      exchanges.push('bad_verifier');
      answer = refusal(400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier', url);
    } else {
      flow.used = true;
      exchanges.push('issued');
      answer = reply(200, await mint(flow.account), url);
    }
    if (step?.kind === 'hold') {
      step.arrived();
      if ((await step.reply) === 'lost') throw new TypeError('Network request failed');
    }
    return answer;
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith(`${FAKE_GOTRUE}/`)) {
      const { pathname, search } = new URL(url);
      const method = init?.method ?? 'GET';
      requests.push(`${method} ${pathname}${search}`);
      if (method === 'POST' && pathname === '/token' && new URLSearchParams(search).get('grant_type') === 'pkce') return exchange(url, init);
    }
    return fake.fetch(input, init);
  };

  return {
    fetch: fetchImpl as typeof fetch,
    requests,
    exchanges,
    /** Every code, verifier, provider token, password and fake-GoTrue token so far: none may be logged or stored. */
    get secrets(): string[] {
      return [...secrets, ...fake.auth.issued()];
    },
    /** The learner consents at Google as `account`: the app's callback with a fresh code, or GoTrue's sign-up refusal. */
    consent(authorizeUrl: string, account: GoogleAccount): string {
      const { redirect, challenge } = authorize(authorizeUrl);
      if (!options.known.includes(account)) {
        return `${redirect}?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance`;
      }
      const code = randomUUID();
      flows.set(code, { challenge, account, used: false });
      secrets.add(code);
      return `${redirect}?code=${code}`;
    },
    /** The learner declines at Google: GoTrue sends the browser back with the refusal. */
    deny(authorizeUrl: string): string {
      const { redirect } = authorize(authorizeUrl);
      return `${redirect}?error=access_denied&error_description=The+user+denied+the+request`;
    },
    /** The next exchange is applied when it arrives (a session then exists at the server); its reply waits until released. */
    holdNextExchange() {
      const reply = deferred<'delivered' | 'lost'>();
      const arrived = deferred<void>();
      steps.push({ kind: 'hold', arrived: () => arrived.resolve(), reply: reply.promise });
      return { arrived: arrived.promise, release: (how: 'delivered' | 'lost' = 'delivered') => reply.resolve(how) };
    },
    /** The next exchange never reaches the server. */
    offlineNextExchange() {
      steps.push({ kind: 'offline' });
    },
  };
}

export type FakeGoogleGoTrue = ReturnType<typeof fakeGoogleGoTrue>;
