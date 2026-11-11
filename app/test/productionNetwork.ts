// The production network as the app would reach it, for tests only: the fictional production API and Auth root origins
// (example.org placeholders, never resolved or contacted) are answered by the frozen fakes of test/fakeAccountApi.ts.
import { FAKE_API, FAKE_GOTRUE } from './fakeAccountApi';

export const PRODUCTION_API = 'https://api.example.org';
export const PRODUCTION_AUTH = 'https://auth.example.org';

/**
 * A fetch that answers exactly the production API and Auth origins through `fetchImpl` (a fake's), each reply marked as
 * coming from the address asked for; anything else does not answer. Every request is noted by method and full URL only.
 */
export function productionNetwork(fetchImpl: typeof fetch) {
  const requests: string[] = [];
  const remapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const local = url.startsWith(`${PRODUCTION_API}/`)
      ? FAKE_API + url.slice(PRODUCTION_API.length)
      : url.startsWith(`${PRODUCTION_AUTH}/`)
        ? FAKE_GOTRUE + url.slice(PRODUCTION_AUTH.length)
        : null;
    if (local === null) throw new TypeError('Network request failed');
    const reply = (await fetchImpl(local, init)) as unknown as Record<string, unknown>;
    return { ...reply, url } as unknown as Response;
  };
  return { fetch: remapped as typeof fetch, requests };
}
