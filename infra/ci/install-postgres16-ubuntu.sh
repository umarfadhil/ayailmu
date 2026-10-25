#!/bin/sh
# Installs the PostgreSQL 16 server binaries on an Ubuntu runner from the distribution archive (free, no PGDG key, no service
# left running: no default cluster is created). The tests start their own disposable loopback cluster from PG_BIN.
#   sh infra/ci/install-postgres16-ubuntu.sh        # then PG_BIN=/usr/lib/postgresql/16/bin
set -eu
[ "$(uname -s)" = Linux ] || { echo "install-postgres16-ubuntu: Linux only; elsewhere set PG_BIN to a PostgreSQL 16 bin directory" >&2; exit 1; }
sudo=""
[ "$(id -u)" = 0 ] || sudo=sudo
export DEBIAN_FRONTEND=noninteractive
$sudo apt-get update -qq
$sudo apt-get install -y --no-install-recommends postgresql-common
echo 'create_main_cluster = false' | $sudo tee -a /etc/postgresql-common/createcluster.conf >/dev/null
$sudo apt-get install -y --no-install-recommends postgresql-16
[ -x /usr/lib/postgresql/16/bin/initdb ] || { echo "install-postgres16-ubuntu: postgresql-16 installed no /usr/lib/postgresql/16/bin/initdb" >&2; exit 1; }
/usr/lib/postgresql/16/bin/postgres --version
