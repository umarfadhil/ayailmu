// Server identifiers as the account API issues them.

/** A canonical UUID (lower-case and hyphenated), as PostgreSQL writes account and profile IDs. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isCanonicalUuid = (value: unknown): value is string => typeof value === 'string' && CANONICAL_UUID.test(value);
