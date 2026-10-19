-- 0003: an account's auth_mode may also name the local synthetic Supabase mode (AYA_MODE=local-supabase), whose
-- accounts are keyed by the configured local Auth's issuer and a verified token's subject. Existing rows keep their
-- mode, and an account's identity stays (issuer, subject): no account changes mode or is matched by anything else.

ALTER TABLE accounts DROP CONSTRAINT accounts_auth_mode_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_auth_mode_check CHECK (auth_mode IN ('emulator', 'local-supabase'));
