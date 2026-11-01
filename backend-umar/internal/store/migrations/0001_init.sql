CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
 declaration_version text NOT NULL CHECK(declaration_version='adult-owner-v1'),
 declared_at timestamptz NOT NULL DEFAULT now(), synthetic boolean NOT NULL CHECK(synthetic),
 UNIQUE(issuer,subject)
);
CREATE TABLE learners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id),
 client_learner_id varchar(128) NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ADULT','ANAK')),
 audience text NOT NULL CHECK((kind='ADULT' AND audience='adults') OR (kind='ANAK' AND audience='kids')),
 lang text NOT NULL CHECK(lang IN ('id','en')), created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), synthetic boolean NOT NULL CHECK(synthetic),
 next_sequence bigint NOT NULL DEFAULT 0 CHECK(next_sequence>=0),
 UNIQUE(owner_id,client_learner_id), UNIQUE(id,owner_id),
 CHECK((kind='ADULT' AND created_by IS NULL) OR (kind='ANAK' AND created_by IS NOT NULL)),
 FOREIGN KEY(created_by,owner_id) REFERENCES learners(id,owner_id)
);
CREATE FUNCTION check_adult_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='ANAK' AND NOT EXISTS(SELECT 1 FROM learners WHERE id=NEW.created_by AND owner_id=NEW.owner_id AND kind='ADULT') THEN
  RAISE EXCEPTION 'adult creator required';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER learner_creator BEFORE INSERT OR UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION check_adult_creator();
CREATE TABLE sync_consents (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 learner_id uuid NOT NULL, owner_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='synthetic-offline-sync'),
 version text NOT NULL CHECK(version='synthetic-sync-v1'), granted boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(learner_id,owner_id) REFERENCES learners(id,owner_id)
);
CREATE INDEX consent_latest ON sync_consents(learner_id,id DESC);
CREATE TABLE pack_versions (
 track text NOT NULL, content_version text NOT NULL, source_commit text NOT NULL,
 pack_sha256 char(64) NOT NULL, rules_sha256 char(64) NOT NULL, rules_version text NOT NULL,
 metadata jsonb NOT NULL, PRIMARY KEY(track,content_version)
);
CREATE TABLE answer_events (
 learner_id uuid NOT NULL REFERENCES learners(id), sequence bigint NOT NULL CHECK(sequence>0),
 answer_id varchar(128) NOT NULL, payload bytea NOT NULL CHECK(octet_length(payload)<=16384),
 sha256 char(64) NOT NULL, registry_status text NOT NULL CHECK(registry_status IN ('registered','unregistered')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(learner_id,sequence), UNIQUE(learner_id,answer_id)
);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable record'; END; $$;
CREATE TRIGGER immutable_answer BEFORE UPDATE OR DELETE ON answer_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_consent BEFORE UPDATE OR DELETE ON sync_consents FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_pack BEFORE UPDATE OR DELETE ON pack_versions FOR EACH ROW EXECUTE FUNCTION immutable_record();
