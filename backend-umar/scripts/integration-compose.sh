#!/bin/sh
# An ephemeral synthetic test database in only this project's Postgres container.
set -eu
umask 077
cd "$(dirname "$0")/.."
. ./.local/compose.env
GO=${GO:-go}
test_db="umar_verify_$(date -u +%Y%m%d%H%M%S)_$$"
created=false
cleanup() { if [ "$created" = true ]; then docker compose exec -T db dropdb -U umar "$test_db" >/dev/null; fi; }
trap cleanup EXIT INT TERM
docker compose exec -T db createdb -U umar "$test_db"
created=true
password=$(cat .local/db_password)
export UMAR_TEST_DATABASE_URL="postgres://umar:$password@127.0.0.1:6585/$test_db?sslmode=disable"
"$GO" test -count=1 -race -v ./...
