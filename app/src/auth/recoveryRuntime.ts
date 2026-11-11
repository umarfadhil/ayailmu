// The platform's view of password recovery links: it only observes the app's own recovery callback, at launch and while
// open, and never opens a browser or sends mail.
export interface RecoveryRuntime {
  platform: { kind: 'web'; origin: string } | { kind: 'native'; unavailable: string | null };
  takeLaunchUrl(callbackUrl: string): string | null | Promise<string | null>;
  subscribe(onUrl: (url: string) => void): () => void;
}

/**
 * Whether `raw` is meant for the recovery callback: exactly `callbackUrl`, or it followed by a query or a fragment. This
 * only routes a link to recovery, leaving any other (a Google or account link, another origin or path) alone; it checks
 * nothing, so a malformed query or fragment still goes on to resume's strict check, which refuses it.
 */
export function ownsRecoveryUrl(raw: string, callbackUrl: string): boolean {
  return raw === callbackUrl || raw.startsWith(`${callbackUrl}?`) || raw.startsWith(`${callbackUrl}#`);
}
