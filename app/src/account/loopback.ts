// Loopback addresses of the local account services, whichever sign-in provider is configured: the account API's port
// and the check that an address is exactly a local origin on a given port. Nothing provider-specific lives here.

/** The local account API's port. */
export const PILOT_API_PORT = 8092;

/**
 * http, a loopback host, a port, and at most a root slash. Matched whole, so credentials, another host, a path,
 * a query or a fragment can never match (no URL parsing: React Native's URL does not implement its parts).
 */
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})\/?$/;

/** The normalized origin (http://host:port) when `value` is exactly the local pilot address on `port`; otherwise null. */
export function localPilotOrigin(value: unknown, port: number): string | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_ORIGIN.exec(value);
  return match !== null && match[2] === String(port) ? `http://${match[1]}:${port}` : null;
}
