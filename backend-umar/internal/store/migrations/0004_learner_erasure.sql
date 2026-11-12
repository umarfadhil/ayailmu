-- An additive, source-only migration. Deploy only after backup and explicit rollout approval.
-- Retain opaque receipts/tombstones so retried creation cannot resurrect erased history.
CREATE TABLE server_deletions (
 deletion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 scope text NOT NULL CHECK(scope IN ('learner','account')),
 target_id uuid NOT NULL,
 request_id uuid NOT NULL,
 client_learner_key char(64),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,request_id),
 UNIQUE(owner_id,scope,target_id)
);
CREATE INDEX deleted_client_learner ON server_deletions(owner_id,client_learner_key)
 WHERE scope='learner';
CREATE TRIGGER immutable_deletion BEFORE UPDATE OR DELETE ON server_deletions
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

-- The runtime has neither table ownership nor DELETE. A caller-controlled GUC alone
-- cannot authorize erasure: the trigger also requires the table owner's privileges.
-- Direct history deletion stays rejected, including ordinary owner-session mistakes.
CREATE FUNCTION guard_learning_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE'
    AND current_setting('ayailmu.erasure_authorized',true)='on'
    AND pg_has_role(current_user,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=TG_RELID),'USAGE') THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'immutable record';
END; $$;
DROP TRIGGER immutable_answer ON answer_events;
DROP TRIGGER immutable_consent ON sync_consents;
CREATE TRIGGER immutable_answer BEFORE UPDATE OR DELETE ON answer_events
 FOR EACH ROW EXECUTE FUNCTION guard_learning_history();
CREATE TRIGGER immutable_consent BEFORE UPDATE OR DELETE ON sync_consents
 FOR EACH ROW EXECUTE FUNCTION guard_learning_history();

CREATE FUNCTION erase_learner(p_owner uuid,p_learner uuid,p_request uuid)
RETURNS TABLE(deletion_id uuid,scope text,target_id uuid,request_id uuid,completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 existing public.server_deletions%ROWTYPE;
 learner public.learners%ROWTYPE;
 previous_flag text;
BEGIN
 IF p_owner IS NULL OR p_learner IS NULL OR p_request IS NULL THEN
  RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0400';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 SELECT * INTO existing FROM public.server_deletions d
  WHERE d.owner_id=p_owner AND d.request_id=p_request;
 IF FOUND THEN
  IF existing.scope<>'learner' OR existing.target_id<>p_learner THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='P0409';
  END IF;
  RETURN QUERY SELECT existing.deletion_id,existing.scope,existing.target_id,existing.request_id,existing.completed_at;
  RETURN;
 END IF;
 SELECT * INTO learner FROM public.learners l
  WHERE l.id=p_learner AND l.owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0404'; END IF;
 IF EXISTS(SELECT 1 FROM public.learners l WHERE l.owner_id=p_owner AND l.created_by=p_learner) THEN
  RAISE EXCEPTION 'dependent_learners' USING ERRCODE='P0424';
 END IF;
 previous_flag:=coalesce(current_setting('ayailmu.erasure_authorized',true),'off');
 PERFORM set_config('ayailmu.erasure_authorized','on',true);
 DELETE FROM public.answer_events e WHERE e.learner_id=p_learner;
 DELETE FROM public.sync_consents c WHERE c.learner_id=p_learner AND c.owner_id=p_owner;
 DELETE FROM public.learners l WHERE l.id=p_learner AND l.owner_id=p_owner;
 PERFORM set_config('ayailmu.erasure_authorized',previous_flag,true);
 INSERT INTO public.server_deletions(owner_id,scope,target_id,request_id,client_learner_key)
 VALUES(p_owner,'learner',p_learner,p_request,encode(sha256(convert_to(learner.client_learner_id,'UTF8')),'hex'))
 RETURNING * INTO existing;
 RETURN QUERY SELECT existing.deletion_id,existing.scope,existing.target_id,existing.request_id,existing.completed_at;
END; $$;
REVOKE ALL ON FUNCTION erase_learner(uuid,uuid,uuid) FROM PUBLIC;
