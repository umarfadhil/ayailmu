#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")"
mkdir -p .local/gotrue
for key in db_password gotrue/db_password gotrue/jwt-secret; do
    if [ ! -e ".local/$key" ]; then openssl rand -hex 32 > ".local/$key"; fi
done
printf 'postgres://umar_gotrue:%s@gotrue-db:5432/umar_gotrue?sslmode=disable' "$(cat .local/gotrue/db_password)" > .local/gotrue/database-url
printf 'export UMAR_DATABASE_URL=postgres://umar:%s@127.0.0.1:6586/umar_native?sslmode=disable\nexport UMAR_LISTEN=127.0.0.1:8187\nexport UMAR_AUTH_PROVIDER=gotrue\nexport UMAR_OIDC_ISSUER=http://127.0.0.1:8287\nexport UMAR_OIDC_JWKS_URL=http://127.0.0.1:8287/.well-known/jwks.json\n' "$(cat .local/db_password)" > .local/gotrue-api.env
cd ../backend-umar
"${GO:-go}" run ./cmd/dev-auth-keys -dir ../integration/.local/gotrue
echo 'Isolated GoTrue credentials initialized privately; existing identity and app data retained.'
