// Whether the screens present as a released app rather than a prototype: only a tester build whose real account
// configuration is a validated production one. The decision always re-reads the environment through
// loadSupabaseConfig (which already requires local-supabase, the exact production profile and flag, and two distinct
// strict public HTTPS root origins); an account panel's projected environment is never trusted for it.
import { loadSupabaseConfig } from '@/account/supabaseConfig';
import type { AppMode } from '@/config/rules';

/** True only in tester mode with an enabled production account configuration that has productionAccounts exactly true. */
export function isReleasePresentation(mode: AppMode): boolean {
  if (mode !== 'tester') return false;
  const config = loadSupabaseConfig();
  return config.enabled === true && config.environment === 'production' && config.productionAccounts === true;
}
