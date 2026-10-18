#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .local/api.env ]; then echo 'Run scripts/init-local.sh first.' >&2; exit 1; fi
. ./.local/api.env
mkdir -p bin
"${GO:-go}" build -trimpath -o bin/umar-api ./cmd/server
exec bin/umar-api
