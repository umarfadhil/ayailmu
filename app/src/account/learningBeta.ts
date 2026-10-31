// The learning-beta account profile's fixed fact, in one place. A learning-beta build carries the exact profile
// ("learning-beta") and the exact capability (learningBeta: true), and talks only to two distinct public HTTPS root origins
// (account/staging.ts), never a local address and never a private QA root. Nothing here imports anything, so every module
// can share it.

/** The learning-beta profile, exactly as EXPO_PUBLIC_ACCOUNT_ENV and a configuration's environment spell it. */
export const LEARNING_BETA = 'learning-beta';
