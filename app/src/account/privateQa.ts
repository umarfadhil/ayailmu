// The private native QA profile's fixed facts, in one place. A private QA build carries the exact profile ("private-qa")
// and the exact capability (privateQa: true), talks only to two fixed HTTPS loopback roots, taken exactly as written, and
// signs in or registers one approved recipient only. Nothing here imports anything, so every module can share it.

/** The private native QA profile, exactly as EXPO_PUBLIC_ACCOUNT_ENV and a configuration's environment spell it. */
export const PRIVATE_QA = 'private-qa';

/** The private QA build's account API: one fixed HTTPS loopback root, matched exactly as written. */
export const PRIVATE_QA_API_ORIGIN = 'https://localhost:58444';

/** The private QA build's Auth server: one fixed HTTPS loopback root, distinct from the API's, matched exactly as written. */
export const PRIVATE_QA_AUTH_ORIGIN = 'https://localhost:58445';

/** The one recipient a private QA build signs in or registers, matched exactly as written (no case folding, no aliases). */
// Public-source fixture only. Live owner QA uses the retained excluded local binding.
export const PRIVATE_QA_RECIPIENT = 'owner-qa@example.invalid';

/** The registration policy (and its EXPO_PUBLIC_ACCOUNT_REGISTRATION flag, exactly) of a private QA build. */
export const PRIVATE_QA_REGISTRATION_POLICY = 'private-qa-confirmed-email';

/** Whether `email` is exactly the approved private QA recipient. */
export const isPrivateQaRecipient = (email: unknown): boolean => email === PRIVATE_QA_RECIPIENT;

/**
 * `value` exactly as written when it is the private QA root `root` under the private profile with its exact capability
 * (privateQa exactly true) and never the production one; otherwise null.
 */
export function privateQaOrigin(value: unknown, root: typeof PRIVATE_QA_API_ORIGIN | typeof PRIVATE_QA_AUTH_ORIGIN, productionAccounts: unknown, privateQa: unknown): string | null {
  return privateQa === true && productionAccounts === undefined && value === root ? root : null;
}
