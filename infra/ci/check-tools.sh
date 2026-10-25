#!/bin/sh
# Fails loudly, with the exact missing piece, instead of letting a later step skip or misbehave.
#   sh infra/ci/check-tools.sh [--real-auth] [--android]
# Needs in PATH/env: go (exactly AYA_CI_GO_VERSION, default go1.27.2), python3, openssl, PG_BIN = a PostgreSQL 16 bin directory.
# --real-auth adds: a C compiler (go test -race), a docker CLI and an explicit DOCKER_HOST on Linux, a reachable daemon.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/go-env.sh"
want_go="${AYA_CI_GO_VERSION:-go1.27.2}"
real_auth=0
for arg in "$@"; do
  case "$arg" in
    --real-auth) real_auth=1 ;;
    *) ci_fail "unknown option: $arg" ;;
  esac
done

command -v go >/dev/null 2>&1 || ci_fail "go not found in PATH (need $want_go; the macOS default path is not used in CI)"
have_go=$(go version | awk '{print $3}')
[ "$have_go" = "$want_go" ] || ci_fail "need $want_go, found $have_go (GOTOOLCHAIN=local, so no toolchain is downloaded)"
command -v python3 >/dev/null 2>&1 || ci_fail "python3 not found in PATH"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || ci_fail "python3 >= 3.9 required"
command -v openssl >/dev/null 2>&1 || ci_fail "openssl not found in PATH"
[ -n "${PG_BIN:-}" ] || ci_fail "PG_BIN is not set (explicit PostgreSQL 16 bin directory, e.g. /usr/lib/postgresql/16/bin on Ubuntu)"
for bin in initdb pg_ctl psql postgres; do
  [ -x "$PG_BIN/$bin" ] || ci_fail "PG_BIN=$PG_BIN has no executable $bin"
done
pg_major=$("$PG_BIN/postgres" --version | sed -n 's/^postgres (PostgreSQL) \([0-9][0-9]*\).*/\1/p')
[ "$pg_major" = 16 ] || ci_fail "PG_BIN=$PG_BIN is PostgreSQL ${pg_major:-unknown}, need 16"

if [ "$real_auth" = 1 ]; then
  command -v cc >/dev/null 2>&1 || ci_fail "no C compiler (cc) in PATH; go test -race needs cgo"
  docker_cli="${AYA_DOCKER:-$(command -v docker || true)}"
  [ -n "$docker_cli" ] && [ -x "$docker_cli" ] || ci_fail "docker CLI not found (set AYA_DOCKER or put docker in PATH)"
  if [ "$(uname -s)" = Linux ] && [ -z "${DOCKER_HOST:-}" ]; then
    ci_fail "DOCKER_HOST is not set; on Linux use DOCKER_HOST=unix:///var/run/docker.sock"
  fi
  "$docker_cli" version --format '{{.Server.Version}}' >/dev/null 2>&1 || ci_fail "docker daemon not reachable via ${DOCKER_HOST:-the default socket}"
fi

echo "tools ok: $(go version | cut -d' ' -f3-) | $(python3 --version) | $(openssl version | cut -d' ' -f1-2) | PostgreSQL $("$PG_BIN/postgres" --version | awk '{print $3}') at $PG_BIN | AYA_CI_ROOT=$AYA_CI_ROOT"
