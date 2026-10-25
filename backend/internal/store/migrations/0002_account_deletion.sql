-- 0002: account deletion records. One transaction erases an account's profiles, device links, events and imports and
-- records the deletion here. The accounts row (account_id, auth_mode, issuer, subject, created_at) stays beside this
-- record: a token still in circulation then finds a deleted account instead of creating a new one, and a retry answers
-- the same deletion. Nothing else of the account remains. No retention period is decided for either row.

CREATE TABLE account_deletions (
    account_id               uuid PRIMARY KEY REFERENCES accounts,
    deletion_id              uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    requested_at             timestamptz NOT NULL DEFAULT now(),
    erased_profiles          integer NOT NULL CHECK (erased_profiles >= 0),
    erased_device_links      integer NOT NULL CHECK (erased_device_links >= 0),
    erased_events            bigint NOT NULL CHECK (erased_events >= 0),
    erased_imports           integer NOT NULL CHECK (erased_imports >= 0),
    identity_attempts        integer NOT NULL DEFAULT 0 CHECK (identity_attempts >= 0),
    identity_deleted_at      timestamptz,
    identity_last_failure_at timestamptz
);
