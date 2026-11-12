# aya-users (deploy/compose.yaml, profile ops): Auth's internal admin API for the prepared synthetic .test users, from
# the auth network only (the front never serves it). curl takes the admin header and every request body from files of
# this job's own volume, so nothing secret is in an argument. It prints one line per user: an action, a file name or user
# ID, the HTTP status and, on creation, the new user's ID. Never a reply body, an email address, a password or a token.
#
#   users.sh create             create every prepared user (email confirmed, role authenticated)
#   users.sh delete UUID...     hard-delete exactly these users; 404 means already absent
#   users.sh settings           Auth's public settings document (which providers and sign-up are enabled; no secret)
set -eu
umask 077
auth=http://aya-auth:9999
ops=/run/aya/ops
reply=/tmp/aya-users-reply

# call METHOD PATH BODYFILE: one bounded admin request without proxy or redirect, its reply in $reply; prints the HTTP
# status, 000 when there was no answer. curl's own messages are discarded: they could quote the request.
call() {
	code=$(curl -q -s --noproxy '*' --proto =http --max-time 15 --max-filesize 1048576 -o "$reply" -w '%{http_code}' \
		-X "$1" -H "@$ops/admin-header" -H 'Accept: application/json' -H 'Content-Type: application/json' \
		--data-binary "@$3" "$auth$2" 2>/dev/null) || true
	case "$code" in
	[1-5][0-9][0-9]) printf '%s' "$code" ;;
	*) printf '000' ;;
	esac
}

case "${1:-}" in
create)
	for body in "$ops"/users/*.json; do
		[ -e "$body" ] || continue
		status=$(call POST /admin/users "$body")
		id=$(grep -o '"id":"[0-9a-f-]\{36\}"' "$reply" 2>/dev/null | head -n 1 | cut -d '"' -f 4 || true)
		rm -f "$reply"
		echo "create ${body##*/} $status ${id:-none}"
	done
	;;
delete)
	shift
	printf '{"should_soft_delete":false}' > /tmp/aya-users-delete.json
	for id in "$@"; do
		case "$id" in
		*[!0-9a-f-]* | '')
			echo "delete refused-not-a-user-id 000"
			continue
			;;
		esac
		if [ "${#id}" -ne 36 ]; then
			echo "delete refused-not-a-user-id 000"
			continue
		fi
		status=$(call DELETE "/admin/users/$id" /tmp/aya-users-delete.json)
		rm -f "$reply"
		echo "delete $id $status"
	done
	;;
settings)
	status=$(curl -q -s --noproxy '*' --proto =http --max-time 15 --max-filesize 65536 -o "$reply" -w '%{http_code}' \
		-H 'Accept: application/json' "$auth/settings" 2>/dev/null) || true
	case "$status" in
	[1-5][0-9][0-9]) ;;
	*) status=000 ;;
	esac
	echo "settings $status"
	if [ "$status" = 200 ]; then
		cat "$reply"
		echo
	fi
	rm -f "$reply"
	;;
*)
	echo "usage: users.sh create | delete UUID... | settings" >&2
	exit 2
	;;
esac
