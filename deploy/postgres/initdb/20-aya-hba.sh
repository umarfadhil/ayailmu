#!/bin/sh
# EXECUTED (not sourced) once by the official PostgreSQL entrypoint, when the cluster is first initialised, after
# 10-aya-roles.sql. The entrypoint executes an init script that `test -x` reports executable and sources any other, and
# Docker Desktop's bind mounts report even a 0644 file as executable, whose direct execution the kernel then refuses
# (exit 126). So this file must really be mode 0755: `aya_stack.py prepare` and `up` (or `initdb-modes`) set and check
# exactly that, and `up` checks that the server then enforces these rules. It holds no secret and reads only PGDATA, from
# the image's environment. Its commands run in a subshell, so no shell option could leak into the entrypoint even if a
# host ever sourced it.
#
# It replaces the generated pg_hba.conf before the server's final start: the bootstrap superuser connects only over this
# container's own socket, as its own OS user (peer); each service role connects only to its own database, from the
# stack's data network, with SCRAM. No other user, database, address or method matches, so everything else is refused.
(
	set -eu
	: "${PGDATA:?PGDATA is not set}"
	cat > "$PGDATA/pg_hba.conf" <<'HBA'
# TYPE  DATABASE  USER            ADDRESS  METHOD
local   all       postgres                 peer
host    aya_app   aya_owner       samenet  scram-sha-256
host    aya_app   aya_runtime     samenet  scram-sha-256
host    aya_app   aya_backup      samenet  scram-sha-256
host    aya_auth  aya_auth_owner  samenet  scram-sha-256
host    aya_auth  aya_backup      samenet  scram-sha-256
HBA
	chmod 0600 "$PGDATA/pg_hba.conf"
)
