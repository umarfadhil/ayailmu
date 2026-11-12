# aya-secrets-init (deploy/compose.yaml): copies each service's own synthetic secret files from the private runtime
# directory, bind-mounted read-only at /in, into that service's volume at /out/<volume>, owned by the service's user
# with mode 0400; every volume root becomes 0700 and that user's. The file layout under /in is the volume layout, so a
# service can only ever receive its own directory. It prints file names only, never a content, and traces nothing.
set -eu
umask 077

# vol UID VOLUME: the volume's root, owned by the service's user and closed to everyone else.
vol() {
	chown "$1:$1" "/out/$2"
	chmod 0700 "/out/$2"
}

# put UID FILE: /in/FILE copied to /out/FILE, owned by the service's user, mode 0400.
put() {
	if [ ! -f "/in/$2" ] || [ -L "/in/$2" ]; then
		echo "aya-secrets-init: missing or not a regular file: $2" >&2
		exit 1
	fi
	install -m 0400 -o "$1" -g "$1" -- "/in/$2" "/out/$2"
}

# PostgreSQL (999): the bootstrap superuser's password and each role's password, read once by postgres/initdb.
vol 999 db
for name in postgres-password aya_owner.password aya_runtime.password aya_backup.password aya_auth_owner.password; do
	put 999 "db/$name"
done

# GoTrue (1000): its database URL as aya_auth_owner, its signing keys and its JWT secret.
vol 1000 auth
for name in database-url jwt-keys.json jwt-secret; do
	put 1000 "auth/$name"
done

# Migration job (65532): the app schema owner's database URL.
vol 65532 migrate
put 65532 migrate/database-url

# API (65532): the runtime role's database URL and the server-only admin credential.
vol 65532 api
put 65532 api/database-url
put 65532 api/admin-key

# Backup job (999): the read-only backup role's password file.
vol 999 backup
put 999 backup/pgpass

# Ops users job (65532): the admin header and the prepared .test users' admin-API request bodies.
vol 65532 ops
install -d -m 0700 -o 65532 -g 65532 /out/ops/users
put 65532 ops/admin-header
count=0
for path in /in/ops/users/*.json; do
	[ -e "$path" ] || continue
	put 65532 "ops/users/${path##*/}"
	count=$((count + 1))
done
if [ "$count" -eq 0 ]; then
	echo "aya-secrets-init: no prepared user" >&2
	exit 1
fi

# Front (65532): Caddy's data directory, where its local CA and certificates live.
vol 65532 proxy-data

echo "aya-secrets-init: copied each service's own private files ($count prepared users)"
