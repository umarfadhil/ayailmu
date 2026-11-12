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

-- Narrow, owner-scoped erasure only; direct history DELETE remains forbidden.
GRANT SELECT ON public.server_deletions TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.erase_learner(uuid,uuid,uuid) TO :"runtime_role";

-- Durable account erasure; mutable job state remains writable only through these functions.
GRANT EXECUTE ON FUNCTION public.begin_account_erasure(uuid,text,text,uuid,text),
 public.account_erasure_status(uuid,text),public.claim_account_erasure(text),
 public.finish_account_erasure(uuid,uuid,boolean) TO :"runtime_role";
