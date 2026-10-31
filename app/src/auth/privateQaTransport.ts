// The private native QA transport: its contract and createPrivateQaFetch. A private QA build reaches its two fixed HTTPS
// loopback roots (API https://localhost:58444, Auth https://localhost:58445) through an injected native bridge that
// trusts only the designated CA for those exact origins and verifies the localhost hostname; that native check is the
// bridge's, not this module's, and nothing here proves it. This module never imports a native package: the bridge is
// handed in at run time, and there is never a fallback to the global fetch.
//
// The factory, createPrivateQaFetch({ bridge, expectedCaSha256, timeoutMs }), returns a function shaped like the
// global fetch for the Auth SDK and the account API client. Its rules:
//   - Construction: expectedCaSha256 is exactly 64 lowercase hex characters; timeoutMs, when given, is a whole number
//     of milliseconds from 1 to PrivateQaMaxTimeoutMs. Otherwise it throws with code 'options'.
//   - Binding: bridge.binding() must report exactly { enabled: true, apiOrigin: https://localhost:58444, authOrigin:
//     https://localhost:58445, caSha256: expectedCaSha256 }. Anything else (null, false, other origins, another or
//     differently cased hash) is refused with code 'binding', before bridge.request is ever called.
//   - Request: a string URL whose origin is exactly one of the two roots as written (https, localhost, the exact port),
//     with any path and query inside it; no credentials in the URL, no fragment. Request objects, credentials other than
//     'omit', a Cookie header, and a body other than an absent/null one or a string of JSON are refused with code
//     'request'. All refusals happen before the bridge sees anything.
//   - Exchange: one bridge.request per call, with a fresh id. The native session never follows redirects: a 3xx is
//     returned as it is, for a caller to inspect (the QA recovery resolver reads a 302's Location) and never followed.
//     The bridge's reply must name the URL that was requested, exactly; its body is at most PrivateQaMaxBodyBytes
//     UTF-8 bytes. Otherwise it is refused with code 'reply'. A bridge failure is code 'bridge'.
//   - Settling: one deadline, timeoutMs or PrivateQaMaxTimeoutMs by default, rejects with code 'deadline';
//     the caller's abort rejects at once with code 'aborted' (name 'AbortError'). Either way bridge.cancel(id) is called
//     and a later bridge outcome is never adopted.
//   - Reply: a stable fetch-like Response: status, ok, url (the requested URL), redirected false, case-insensitive
//     headers.get, text() and json() over the bridge's body.
import { PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';

/** The longest, and the default, deadline of one private QA request, reply body included: 10 seconds. */
export type PrivateQaMaxTimeoutMs = 10_000;

/** The largest reply body accepted from the bridge, in UTF-8 bytes: 2 MiB. */
export type PrivateQaMaxBodyBytes = 2_097_152;

/** What the native module reports it was built with. It is checked, never trusted: see the module comment. */
export interface PrivateQaBinding {
  enabled: true;
  /** Exactly https://localhost:58444. */
  apiOrigin: string;
  /** Exactly https://localhost:58445. */
  authOrigin: string;
  /** The designated CA certificate's SHA-256, 64 lowercase hex characters. */
  caSha256: string;
}

/** One request as the bridge receives it, after every check here has passed. */
export interface PrivateQaNativeRequest {
  /** Unique per request; the same id is what bridge.cancel receives. */
  id: string;
  /** Exactly the URL the caller asked for. */
  url: string;
  /** Upper case. */
  method: string;
  headers: Record<string, string>;
  /** The caller's JSON text exactly, or null when there is no body. */
  body: string | null;
}

/** The native reply to one request, unfollowed. */
export interface PrivateQaNativeReply {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The URL that answered; it must be the requested URL exactly. */
  url: string;
}

/** The injected native bridge: the only I/O this transport has. */
export interface PrivateQaBridge {
  /** The native build's binding, or null when the native module has none. */
  binding(): PrivateQaBinding | null;
  /** Performs one request over the CA-pinned session, never following redirects. */
  request(request: PrivateQaNativeRequest): Promise<PrivateQaNativeReply>;
  /** Stops the native call `id`; harmless when it already ended. */
  cancel(id: string): void;
}

export interface PrivateQaFetchOptions {
  bridge: PrivateQaBridge;
  /** The designated CA's SHA-256 this build expects, 64 lowercase hex characters. */
  expectedCaSha256: string;
  /** The deadline in milliseconds, 1 to 10000; 10000 when absent. */
  timeoutMs?: number;
}

/** Why the transport refused or failed, never with request or reply text in it. */
export type PrivateQaTransportFailure = 'options' | 'binding' | 'request' | 'bridge' | 'reply' | 'deadline' | 'aborted';

/** Every refusal or failure of the transport. */
export interface PrivateQaTransportError extends Error {
  readonly code: PrivateQaTransportFailure;
}

export type CreatePrivateQaFetch = (options: PrivateQaFetchOptions) => typeof fetch;

/** The module's runtime surface. */
export interface PrivateQaTransportFacade {
  createPrivateQaFetch: CreatePrivateQaFetch;
}

const MAX_TIMEOUT_MS: PrivateQaMaxTimeoutMs = 10_000;
const MAX_BODY_BYTES: PrivateQaMaxBodyBytes = 2_097_152;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const METHOD = /^[A-Za-z]+$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[^\r\n\0]*$/;
/** What may follow a root: printable ASCII without '#' (no fragment) or '\' (no reparsed authority). */
const URL_REST = /^[\x21\x22\x24-\x5b\x5d-\x7e]*$/;
/** Request headers that would add ambient state or retarget the exact origin. */
const REFUSED_HEADERS = new Set(['cookie', 'host']);

/** A generic error carrying only its code: never the URL, headers, body or the bridge's own error. */
function transportError(code: PrivateQaTransportFailure): PrivateQaTransportError {
  const error = new Error(`private QA transport: ${code}`) as Error & { code: PrivateQaTransportFailure };
  error.name = code === 'aborted' ? 'AbortError' : 'PrivateQaTransportError';
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

let nextId = 0;

function isBound(binding: unknown, expectedCaSha256: string): boolean {
  if (typeof binding !== 'object' || binding === null) return false;
  const { enabled, apiOrigin, authOrigin, caSha256 } = binding as Partial<PrivateQaBinding>;
  return enabled === true && apiOrigin === PRIVATE_QA_API_ORIGIN && authOrigin === PRIVATE_QA_AUTH_ORIGIN && caSha256 === expectedCaSha256;
}

/** Whether `url` is one of the two roots exactly as written, then only a path and/or query. */
function isPrivateQaUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const root = [PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN].find((origin) => url.startsWith(origin));
  if (root === undefined) return false;
  const rest = url.slice(root.length);
  return (rest === '' || rest[0] === '/' || rest[0] === '?') && URL_REST.test(rest);
}

/** The caller's headers as lower-case names, or null when any is malformed or refused. */
function requestHeaders(headers: HeadersInit | undefined): Record<string, string> | null {
  const pairs: [unknown, unknown][] = [];
  if (Array.isArray(headers)) {
    for (const pair of headers as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      pairs.push([pair[0], pair[1]]);
    }
  } else if (typeof headers === 'object' && headers !== null) {
    if (typeof (headers as Headers).forEach === 'function') (headers as Headers).forEach((value, name) => pairs.push([name, value]));
    else pairs.push(...Object.entries(headers));
  } else if (headers !== undefined && headers !== null) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [name, value] of pairs) {
    if (typeof name !== 'string' || typeof value !== 'string' || !HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) return null;
    const key = name.toLowerCase();
    if (REFUSED_HEADERS.has(key)) return null;
    out[key] = key in out ? `${out[key]}, ${value}` : value;
  }
  return out;
}

/** The checked native request, or null when the caller asked for anything outside the private QA contract. */
function nativeRequest(input: unknown, init: RequestInit | undefined): Omit<PrivateQaNativeRequest, 'id'> | null {
  if (!isPrivateQaUrl(input)) return null;
  const { method = 'GET', credentials, body = null } = init ?? ({} as RequestInit);
  if (credentials !== undefined && credentials !== 'omit') return null;
  if (typeof method !== 'string' || !METHOD.test(method)) return null;
  const upper = method.toUpperCase();
  const headers = requestHeaders(init?.headers);
  if (headers === null) return null;
  if (body !== null) {
    if (typeof body !== 'string' || upper === 'GET' || upper === 'HEAD') return null;
    try {
      JSON.parse(body);
    } catch {
      return null;
    }
  }
  return { url: input, method: upper, headers, body };
}

/** Whether `text` is at most MAX_BODY_BYTES once encoded as UTF-8 (a lone surrogate counts as U+FFFD, 3 bytes). */
function fitsBody(text: string): boolean {
  if (text.length > MAX_BODY_BYTES) return false;
  if (text.length * 3 <= MAX_BODY_BYTES) return true;
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
    if (bytes > MAX_BODY_BYTES) return false;
  }
  return true;
}

/** A frozen fetch-like Response over a checked reply, or null when the reply is not the one asked for. */
function fetchReply(answer: unknown, url: string): Response | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { status, headers, body, url: answered } = answer as Partial<PrivateQaNativeReply>;
  if (answered !== url || typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) return null;
  if (typeof body !== 'string' || !fitsBody(body) || typeof headers !== 'object' || headers === null) return null;
  const fields = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') return null;
    const key = name.toLowerCase();
    // A cookie set by the server is never handed on: this transport carries no cookies either way.
    if (key === 'set-cookie') continue;
    fields.set(key, fields.has(key) ? `${fields.get(key)}, ${value}` : value);
  }
  const replyHeaders = Object.freeze({
    get: (name: string) => fields.get(String(name).toLowerCase()) ?? null,
    has: (name: string) => fields.has(String(name).toLowerCase()),
    forEach: (each: (value: string, name: string) => void) => fields.forEach((value, name) => each(value, name)),
  });
  const text = async () => body;
  const json = async (): Promise<unknown> => {
    try {
      return JSON.parse(body);
    } catch {
      // The engine's message can quote the body; this one does not.
      throw new SyntaxError('private QA transport: the reply body is not JSON');
    }
  };
  const response: Response = Object.freeze({
    status,
    statusText: '',
    ok: status >= 200 && status < 300,
    url,
    redirected: false,
    type: 'basic',
    bodyUsed: false,
    headers: replyHeaders,
    text,
    json,
    clone: () => response,
  }) as unknown as Response;
  return response;
}

export const createPrivateQaFetch: CreatePrivateQaFetch = (options) => {
  const { bridge, expectedCaSha256, timeoutMs = MAX_TIMEOUT_MS } = options ?? ({} as PrivateQaFetchOptions);
  if (
    typeof bridge !== 'object' ||
    bridge === null ||
    typeof bridge.binding !== 'function' ||
    typeof bridge.request !== 'function' ||
    typeof bridge.cancel !== 'function' ||
    typeof expectedCaSha256 !== 'string' ||
    !SHA256_HEX.test(expectedCaSha256) ||
    typeof timeoutMs !== 'number' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw transportError('options');
  }

  const privateFetch = (input: unknown, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      let bound = false;
      try {
        bound = isBound(bridge.binding(), expectedCaSha256);
      } catch {
        bound = false;
      }
      if (!bound) throw transportError('binding');
      const asked = nativeRequest(input, init);
      if (asked === null) throw transportError('request');
      const signal = init?.signal ?? null;
      if (signal?.aborted) throw transportError('aborted');

      const id = `private-qa-${(nextId += 1)}`;
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        return true;
      };
      const retire = (code: 'deadline' | 'aborted') => {
        if (!settle()) return;
        try {
          bridge.cancel(id);
        } catch {
          // Cancelling is best effort; the call is retired here either way.
        }
        reject(transportError(code));
      };
      const onAbort = () => retire('aborted');
      const timer = setTimeout(() => retire('deadline'), timeoutMs);
      signal?.addEventListener('abort', onAbort);

      let exchange: Promise<PrivateQaNativeReply>;
      try {
        exchange = Promise.resolve(bridge.request({ id, ...asked }));
      } catch {
        exchange = Promise.reject(new Error('bridge'));
      }
      exchange.then(
        (answer) => {
          if (!settle()) return;
          const response = fetchReply(answer, asked.url);
          if (response === null) reject(transportError('reply'));
          else resolve(response);
        },
        () => {
          if (settle()) reject(transportError('bridge'));
        }
      );
    });

  return privateFetch as typeof fetch;
};
