#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./.local/api.env
mkdir -p .local/bin
cd ../backend-umar
"${GO:-go}" build -trimpath -o ../integration/.local/bin/umar-integration-api ./cmd/server
exec ../integration/.local/bin/umar-integration-api
