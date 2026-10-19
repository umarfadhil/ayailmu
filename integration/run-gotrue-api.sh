#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./.local/gotrue-api.env
mkdir -p .local/bin
cd ../backend-umar
"${GO:-go}" build -trimpath -o ../integration/.local/bin/umar-gotrue-api ./cmd/server
exec ../integration/.local/bin/umar-gotrue-api
