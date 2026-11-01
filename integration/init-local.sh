#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")"
mkdir -p .local
if [ -e .local/stack.env ]; then echo 'Existing integration secrets retained.'; exit 0; fi
for key in db_password auth_db_password admin_password; do
 if [ ! -e ".local/$key" ]; then openssl rand -hex 32 > ".local/$key"; fi
done
printf 'export UMAR_INTEGRATION_AUTH_DB_PASSWORD=%s\nexport UMAR_INTEGRATION_ADMIN_PASSWORD=%s\n' "$(cat .local/auth_db_password)" "$(cat .local/admin_password)" > .local/stack.env
printf 'export UMAR_DATABASE_URL=postgres://umar:%s@127.0.0.1:6586/umar_native?sslmode=disable\nexport UMAR_LISTEN=127.0.0.1:8186\nexport UMAR_OIDC_ISSUER=http://127.0.0.1:8286/realms/umar-integration\nexport UMAR_OIDC_JWKS_URL=http://127.0.0.1:8286/realms/umar-integration/protocol/openid-connect/certs\n' "$(cat .local/db_password)" > .local/api.env
echo 'Created ignored integration-only secrets. No identities created.'
