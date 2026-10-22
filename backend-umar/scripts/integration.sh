#!/bin/sh
# Real, isolated Postgres; database and identities are fabricated and discarded.
set -eu
umask 077
cd "$(dirname "$0")/.."
PG_BIN=${PG_BIN:-/Applications/Postgres.app/Contents/Versions/16/bin}
GO=${GO:-go}
root=$(mktemp -d /tmp/umar-pg.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$root/data" -m fast -w stop >/dev/null 2>&1 || true; rm -rf "$root"; }
trap cleanup EXIT INT TERM
openssl rand -hex 24 > "$root/password"
"$PG_BIN/initdb" -D "$root/data" -U umar_test --auth-local=trust --auth-host=scram-sha-256 --pwfile="$root/password" --no-locale -E UTF8 > "$root/init.log"
"$PG_BIN/pg_ctl" -D "$root/data" -l "$root/server.log" -o "-h 127.0.0.1 -p 16585 -k $root" -w start >/dev/null
"$PG_BIN/createdb" -h "$root" -p 16585 -U umar_test umar_synthetic
password=$(cat "$root/password")
export UMAR_TEST_DATABASE_URL="postgres://umar_test:$password@127.0.0.1:16585/umar_synthetic?sslmode=disable"
"$GO" test -count=1 -race -v ./...
