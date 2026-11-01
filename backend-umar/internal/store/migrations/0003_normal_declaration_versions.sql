-- Preserve the synthetic declaration exactly; normal accounts persist the operator-approved version.
ALTER TABLE accounts DROP CONSTRAINT accounts_declaration_version_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_declaration_version_check CHECK(
 (synthetic AND declaration_version='adult-owner-v1') OR
 (NOT synthetic AND declaration_version ~ '^[a-z0-9][a-z0-9-]{2,79}$')
);
