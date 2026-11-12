-- Source-only additive account erasure. No runtime account DELETE/UPDATE authority.
ALTER TABLE public.accounts ADD COLUMN erasure_requested_at timestamptz;
CREATE TABLE public.account_deletions (
 deletion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id),
 request_id uuid NOT NULL,
 recovery_hash char(64) NOT NULL CHECK(recovery_hash ~ '^[0-9a-f]{64}$'),
 app_data_erased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 identity_deleted_at timestamptz,
 attempts bigint NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_id uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,recovery_hash),
 CHECK ((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK (identity_deleted_at IS NULL OR lease_id IS NULL)
);
CREATE INDEX account_erasure_due ON public.account_deletions(next_attempt_at) WHERE identity_deleted_at IS NULL;
REVOKE ALL ON public.account_deletions FROM PUBLIC;

CREATE FUNCTION public.guard_account_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.erasure_requested_at IS NULL AND NEW.erasure_requested_at IS NOT NULL
  AND (to_jsonb(NEW)-'erasure_requested_at')=(to_jsonb(OLD)-'erasure_requested_at')
  AND current_setting('ayailmu.erasure_authorized',true)='on'
  AND pg_has_role(current_user,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=TG_RELID),'USAGE') THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'immutable account identity';
END; $$;
CREATE TRIGGER immutable_account_identity BEFORE UPDATE OR DELETE ON public.accounts
 FOR EACH ROW EXECUTE FUNCTION public.guard_account_tombstone();

CREATE FUNCTION public.guard_account_deletion_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.deletion_id=OLD.deletion_id AND NEW.owner_id=OLD.owner_id
  AND NEW.request_id=OLD.request_id AND NEW.recovery_hash=OLD.recovery_hash
  AND NEW.app_data_erased_at=OLD.app_data_erased_at
  AND (OLD.identity_deleted_at IS NULL OR NEW.identity_deleted_at=OLD.identity_deleted_at) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'immutable account deletion identity';
END; $$;
CREATE TRIGGER immutable_account_deletion_identity BEFORE UPDATE OR DELETE ON public.account_deletions
 FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_identity();

-- Also protect direct runtime profile insertion, not just the application helper.
CREATE FUNCTION public.reject_erased_account_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text,0));
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id=NEW.owner_id AND erasure_requested_at IS NOT NULL) THEN
  RAISE EXCEPTION 'account_deleted' USING ERRCODE='P0410';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER learner_active_account BEFORE INSERT ON public.learners
 FOR EACH ROW EXECUTE FUNCTION public.reject_erased_account_profile();

CREATE FUNCTION public.begin_account_erasure(p_owner uuid,p_issuer text,p_subject text,p_request uuid,p_recovery_hash text)
RETURNS TABLE(deletion_id uuid,request_id uuid,app_data_erased_at timestamptz,identity_deleted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 account public.accounts%ROWTYPE;
 existing public.account_deletions%ROWTYPE;
 previous_flag text;
BEGIN
 IF p_owner IS NULL OR p_request IS NULL OR p_issuer IS NULL OR p_subject IS NULL OR p_recovery_hash IS NULL
  OR p_recovery_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0400'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 SELECT * INTO account FROM public.accounts a WHERE a.id=p_owner AND a.issuer=p_issuer AND a.subject=p_subject FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0404'; END IF;
 SELECT * INTO existing FROM public.account_deletions d WHERE d.owner_id=p_owner;
 IF FOUND THEN
  IF existing.request_id<>p_request OR existing.recovery_hash<>p_recovery_hash THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='P0409';
  END IF;
  RETURN QUERY SELECT existing.deletion_id,existing.request_id,existing.app_data_erased_at,existing.identity_deleted_at;
  RETURN;
 END IF;
 IF account.erasure_requested_at IS NOT NULL THEN RAISE EXCEPTION 'account_deleted' USING ERRCODE='P0410'; END IF;
 IF EXISTS(SELECT 1 FROM public.server_deletions d WHERE d.owner_id=p_owner AND d.request_id=p_request) THEN
  RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='P0409';
 END IF;
 -- Same lock order as profile creation and learner erasure. Event/consent writes lock learners.
 PERFORM 1 FROM public.learners l WHERE l.owner_id=p_owner ORDER BY l.id FOR UPDATE;
 previous_flag:=coalesce(current_setting('ayailmu.erasure_authorized',true),'off');
 PERFORM set_config('ayailmu.erasure_authorized','on',true);
 DELETE FROM public.answer_events e USING public.learners l WHERE e.learner_id=l.id AND l.owner_id=p_owner;
 DELETE FROM public.sync_consents c WHERE c.owner_id=p_owner;
 DELETE FROM public.learners l WHERE l.owner_id=p_owner AND l.kind='ANAK';
 DELETE FROM public.learners l WHERE l.owner_id=p_owner;
 UPDATE public.accounts a SET erasure_requested_at=clock_timestamp() WHERE a.id=p_owner;
 PERFORM set_config('ayailmu.erasure_authorized',previous_flag,true);
 INSERT INTO public.account_deletions(owner_id,request_id,recovery_hash)
 VALUES(p_owner,p_request,p_recovery_hash) RETURNING * INTO existing;
 RETURN QUERY SELECT existing.deletion_id,existing.request_id,existing.app_data_erased_at,existing.identity_deleted_at;
END; $$;

-- A client-generated 256-bit proof permits only this minimal status after Auth is gone.
-- It is hashed before storage, never put in a URL and never authorizes an erasure action.
CREATE FUNCTION public.account_erasure_status(p_request uuid,p_recovery_hash text)
RETURNS TABLE(deletion_id uuid,request_id uuid,app_data_erased_at timestamptz,identity_deleted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT d.deletion_id,d.request_id,d.app_data_erased_at,d.identity_deleted_at FROM public.account_deletions d
 WHERE d.request_id=p_request AND d.recovery_hash=p_recovery_hash;
$$;

CREATE FUNCTION public.claim_account_erasure(p_issuer text)
RETURNS TABLE(deletion_id uuid,lease_id uuid,issuer text,subject text,attempts bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected uuid;
BEGIN
 SELECT d.deletion_id INTO selected FROM public.account_deletions d JOIN public.accounts a ON a.id=d.owner_id
 WHERE a.issuer=p_issuer AND NOT a.synthetic AND d.identity_deleted_at IS NULL AND d.next_attempt_at<=clock_timestamp()
  AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
 ORDER BY d.next_attempt_at,d.deletion_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.account_deletions d SET lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds',attempts=least(d.attempts,2147483646)+1
 FROM public.accounts a WHERE d.deletion_id=selected AND a.id=d.owner_id
 RETURNING d.deletion_id,d.lease_id,a.issuer,a.subject,d.attempts;
END; $$;

CREATE FUNCTION public.finish_account_erasure(p_deletion uuid,p_lease uuid,p_confirmed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.account_deletions d SET
  identity_deleted_at=CASE WHEN p_confirmed THEN greatest(clock_timestamp(),d.app_data_erased_at) ELSE NULL END,
  next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(greatest(d.attempts-1,0),6)))::double precision),
  lease_id=NULL,lease_until=NULL
 WHERE d.deletion_id=p_deletion AND d.lease_id=p_lease AND d.identity_deleted_at IS NULL AND p_confirmed IS NOT NULL;
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.begin_account_erasure(uuid,text,text,uuid,text),public.account_erasure_status(uuid,text),
 public.claim_account_erasure(text),public.finish_account_erasure(uuid,uuid,boolean) FROM PUBLIC;
