#!/bin/sh
set -eu
cd "$(dirname "$0")"
umar_public_origin=${UMAR_PUBLIC_ORIGIN:-}
umar_explicit_issuer=${UMAR_OIDC_ISSUER:-}
if [ -n "$umar_public_origin" ] && [ -n "$umar_explicit_issuer" ] && [ "$umar_public_origin" != "$umar_explicit_issuer" ]; then
    echo 'Public origin and explicit OIDC issuer disagree' >&2
    exit 1
fi
. ./.local/gotrue-api.env
if [ -n "$umar_public_origin" ]; then
    export UMAR_OIDC_ISSUER="$umar_public_origin"
fi
mkdir -p .local/bin
cd ../backend-umar
"${GO:-go}" build -trimpath -o ../integration/.local/bin/umar-gotrue-api ./cmd/server
exec ../integration/.local/bin/umar-gotrue-api
