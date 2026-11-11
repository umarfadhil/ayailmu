// Normal email account policy for local native development. Transport trust is a
// separate capability: the device must supply the existing CA-pinned loopback bridge.
export const LOCAL_DEVELOPMENT = 'local-development';
export const LOCAL_DEVELOPMENT_API_ORIGIN = 'https://localhost:58444';
export const LOCAL_DEVELOPMENT_AUTH_ORIGIN = 'https://localhost:58445';

export function localDevelopmentOrigin(value: unknown, root: string, production: unknown, privateQa: unknown, learningBeta: unknown, capability: unknown): string | null {
  return capability === true && production === undefined && privateQa === undefined && learningBeta === undefined && value === root ? root : null;
}

export interface LocalDevelopmentAccountConfig {
  enabled: true; provider: 'local-supabase'; environment: typeof LOCAL_DEVELOPMENT;
  localDevelopment: true; apiBaseUrl: typeof LOCAL_DEVELOPMENT_API_ORIGIN; authUrl: typeof LOCAL_DEVELOPMENT_AUTH_ORIGIN;
  productionAccounts?: never; privateQa?: never; learningBeta?: never;
}

export function isLocalDevelopmentConfig(config: unknown): config is LocalDevelopmentAccountConfig {
  if (typeof config !== 'object' || config === null) return false;
  const c = config as Record<string, unknown>;
  return c.enabled === true && c.provider === 'local-supabase' && c.environment === LOCAL_DEVELOPMENT &&
    c.localDevelopment === true && c.productionAccounts === undefined && c.privateQa === undefined &&
    c.learningBeta === undefined && c.apiBaseUrl === LOCAL_DEVELOPMENT_API_ORIGIN && c.authUrl === LOCAL_DEVELOPMENT_AUTH_ORIGIN;
}
