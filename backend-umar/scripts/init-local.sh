#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
if [ -e .local/compose.env ]; then echo 'Existing isolated configuration retained.'; exit 0; fi
mkdir -p .local
for key in db_password auth_db_password admin_password; do
 if [ ! -e ".local/$key" ]; then openssl rand -hex 32 > ".local/$key"; fi
done
printf 'export UMAR_AUTH_DB_PASSWORD=%s\nexport UMAR_AUTH_ADMIN_PASSWORD=%s\n' "$(cat .local/auth_db_password)" "$(cat .local/admin_password)" > .local/compose.env
printf 'export UMAR_DATABASE_URL=postgres://umar:%s@127.0.0.1:6585/umar_native?sslmode=disable\nexport UMAR_LISTEN=127.0.0.1:8185\n' "$(cat .local/db_password)" > .local/api.env
echo 'Created ignored local secrets. No user accounts were created.'
