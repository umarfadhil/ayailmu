-- TEMPLATE ONLY. Apply after migrations, to an already approved non-owner runtime role:
-- psql ... -v runtime_role=APPROVED_EXISTING_ROLE -f deploy/runtime-grants.sql
-- This creates no role, login, password, membership or persistent credential.
-- Use a dedicated database. The role must have no inherited owner/admin/DDL privileges;
-- startup with UMAR_MIGRATE_ON_START=false verifies effective privileges and fails closed.
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT ON public.schema_migrations, public.pack_versions, public.accounts,
    public.learners, public.sync_consents, public.answer_events TO :"runtime_role";
GRANT INSERT ON public.accounts, public.learners, public.sync_consents,
    public.answer_events TO :"runtime_role";
GRANT UPDATE (next_sequence) ON public.learners TO :"runtime_role";
GRANT USAGE ON SEQUENCE public.sync_consents_id_seq TO :"runtime_role";
