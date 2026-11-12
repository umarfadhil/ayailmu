-- 0001: accounts, adult profiles, linked device sources, immutable answer events and import receipts.
-- Tables are created unqualified: the connection search_path is the configured schema.

CREATE TABLE accounts (
    account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_mode  text NOT NULL CHECK (auth_mode = 'emulator'),
    issuer     text NOT NULL,
    subject    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);

CREATE TABLE profiles (
    profile_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       uuid NOT NULL REFERENCES accounts,
    kind             text NOT NULL CHECK (kind = 'adult'),
    instruction_lang text CHECK (instruction_lang IN ('id', 'en')),
    session_minutes  integer CHECK (session_minutes BETWEEN 1 AND 240),
    arabic_scale     double precision CHECK (arabic_scale BETWEEN 0.8 AND 2.0),
    consent_version  text NOT NULL,
    consent_at       timestamptz NOT NULL,
    revision         bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    high_seq         bigint NOT NULL DEFAULT 0 CHECK (high_seq >= 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, profile_id)
);

CREATE TABLE profile_sources (
    account_id       uuid NOT NULL,
    profile_id       uuid NOT NULL,
    app              text NOT NULL CHECK (app IN ('expo', 'android')),
    install_id       text NOT NULL,
    local_profile_id text NOT NULL,
    linked_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, app, install_id, local_profile_id),
    FOREIGN KEY (account_id, profile_id) REFERENCES profiles (account_id, profile_id)
);

CREATE TABLE events (
    profile_id              uuid NOT NULL REFERENCES profiles,
    seq                     bigint NOT NULL CHECK (seq >= 1),
    event_id                text COLLATE "C" NOT NULL CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    kind                    text NOT NULL CHECK (kind = 'answer'),
    record_schema           text NOT NULL,
    schema_version          integer NOT NULL,
    family                  text NOT NULL,
    track                   text NOT NULL,
    content_version         text NOT NULL,
    rules_version           text NOT NULL,
    curriculum_status       text NOT NULL CHECK (curriculum_status IN ('registered', 'unregistered')),
    occurred_at             timestamptz NOT NULL,
    local_date              date NOT NULL,
    clock_flags             text[] NOT NULL DEFAULT '{}',
    payload_raw             text NOT NULL CHECK (octet_length(payload_raw) <= 65536),
    semantic_sha256         bytea NOT NULL CHECK (octet_length(semantic_sha256) = 32),
    source_app              text NOT NULL,
    source_install_id       text NOT NULL,
    source_app_version      text NOT NULL,
    source_local_profile_id text NOT NULL,
    import_id               text,
    received_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, event_id),
    UNIQUE (profile_id, seq)
);

CREATE INDEX events_family_seq ON events (profile_id, family, seq);
CREATE INDEX events_learning_order ON events (profile_id, family, occurred_at, event_id);

CREATE TABLE imports (
    account_id     uuid NOT NULL REFERENCES accounts,
    import_id      text COLLATE "C" NOT NULL CHECK (import_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    profile_id     uuid NOT NULL,
    receipt        text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, import_id),
    FOREIGN KEY (account_id, profile_id) REFERENCES profiles (account_id, profile_id)
);
