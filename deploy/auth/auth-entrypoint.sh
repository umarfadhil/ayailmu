# aya-auth entrypoint (deploy/compose.yaml), run by /bin/sh as GoTrue's own user 1000. It exports GoTrue's three secret
# settings from the private files of its own volume, then replaces itself with the vendor binary, so they exist only in
# that process's memory: never in the container's configured environment (docker inspect), an argument or a log. It
# prints nothing about a value and traces nothing.
set -eu
secrets=/run/aya/auth

for name in database-url jwt-keys.json jwt-secret; do
	if [ ! -f "$secrets/$name" ] || [ ! -r "$secrets/$name" ] || [ ! -s "$secrets/$name" ]; then
		echo "aya-auth-entrypoint: a private setting file is missing, unreadable or empty: $name" >&2
		exit 1
	fi
done

DATABASE_URL=$(cat "$secrets/database-url")
GOTRUE_JWT_KEYS=$(cat "$secrets/jwt-keys.json")
GOTRUE_JWT_SECRET=$(cat "$secrets/jwt-secret")
export DATABASE_URL GOTRUE_JWT_KEYS GOTRUE_JWT_SECRET

exec auth
