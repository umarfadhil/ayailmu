-- Additive normal-mode contract. Existing synthetic rows and immutable history remain unchanged.
ALTER TABLE accounts DROP CONSTRAINT accounts_synthetic_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_synthetic_check CHECK(synthetic IN (TRUE,FALSE));
ALTER TABLE learners DROP CONSTRAINT learners_synthetic_check;
ALTER TABLE learners ADD CONSTRAINT learners_synthetic_check CHECK(synthetic IN (TRUE,FALSE));
ALTER TABLE sync_consents DROP CONSTRAINT sync_consents_purpose_check;
ALTER TABLE sync_consents DROP CONSTRAINT sync_consents_version_check;
ALTER TABLE sync_consents ADD CONSTRAINT sync_consents_purpose_check
 CHECK(purpose IN ('synthetic-offline-sync','normal-owner-learning-sync'));
ALTER TABLE sync_consents ADD CONSTRAINT sync_consents_version_check CHECK(
 (purpose='synthetic-offline-sync' AND version='synthetic-sync-v1') OR
 (purpose='normal-owner-learning-sync' AND version ~ '^[a-z0-9][a-z0-9-]{2,79}$')
);
CREATE INDEX normal_owner_profiles ON learners(owner_id,synthetic,id);
