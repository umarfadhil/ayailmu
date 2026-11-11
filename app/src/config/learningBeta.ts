// The learning-beta starter gate: whether this build is a validated learning-beta build, and whether a tester build of
// either beta kind (the private beta or the learning beta) may reach the Unit A starter at all. It reads no setting of its
// own: the profile, the capability, the app mode and every flag are validated by loadSupabaseConfig (account/supabaseConfig.ts),
// the private beta by loadPrivateBetaConfig (config/privateBeta.ts, untouched). It never approves content: every caller
// still asks starterReviewAccess (pilot/unitA/review.ts) for that.
import { LEARNING_BETA } from '@/account/learningBeta';
import { loadSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';
import { loadPrivateBetaConfig, type PrivateBetaEnv } from '@/config/privateBeta';

/**
 * The build-time variables a learning-beta build reads. SupabaseEnv already names every one of them (the profile, the
 * learning-beta flag, the app mode, the off flags and the two origins), so this adds no key of its own.
 */
export type LearningBetaEnv = SupabaseEnv;

/**
 * True only for a validated learning-beta build: enabled, the exact 'learning-beta' environment with the exact learningBeta
 * capability, and neither the production nor the private QA capability. Undefined `env` lets loadSupabaseConfig read the
 * literal process.env variables Expo inlines.
 */
export function learningBetaEnabled(env?: LearningBetaEnv): boolean {
  const config = loadSupabaseConfig(env);
  return (
    config.enabled === true &&
    config.environment === LEARNING_BETA &&
    config.learningBeta === true &&
    config.productionAccounts === undefined &&
    config.privateQa === undefined
  );
}

/**
 * True for a validated private beta build or a validated learning-beta build; false otherwise. The two profiles cannot both
 * hold (the private beta needs the staging profile, the learning beta its own), so this never widens to a third.
 */
export function starterBetaBuild(env?: PrivateBetaEnv & LearningBetaEnv): boolean {
  return loadPrivateBetaConfig(env).enabled === true || learningBetaEnabled(env);
}
