# aya-probe (deploy/restore/target.yaml, profile drill): the restore target's own checks, from its internal networks
# only (the target publishes no port), with the drill users' old credentials, which aya-drill-init copied into this
# job's own volume. curl reads every credential, an Authorization header or a request body, from a file of that
# volume, so nothing secret is in an argument; a token Auth issues here stays in this container's private /tmp and is
# removed at once. It prints one line per check: the check, the HTTP status (000 without an answer) and one fixed word:
# Auth's error_code, the API's code, issued, ready, ok, match, mismatch, the SHA-256 of the reply body, or -. Never a
# reply, token, password or address.
#
#   probe.sh user HEADER [USER_ID]        GET  aya-auth /user, with the Authorization header in HEADER
#   probe.sh me HEADER [ACCOUNT_ID]       GET  aya-api  /v1/me
#   probe.sh api HEADER PATH              GET  aya-api  PATH; the word is the SHA-256 of the reply body
#   probe.sh refresh BODY                 POST aya-auth /token?grant_type=refresh_token, the refresh token in BODY
#   probe.sh password BODY [ACCOUNT_ID]   POST aya-auth /token?grant_type=password; given ACCOUNT_ID, then GET /v1/me
#                                         with the access token just issued
#   probe.sh ready                        GET  aya-api  /v1/readyz
set -eu
umask 077
auth=http://aya-auth:9999
api=http://aya-api:8080
dir=/run/aya/probe
reply=/tmp/aya-probe-reply
issued=/tmp/aya-probe-issued

refuse() {
	echo "$1 refused 000 -"
	exit 2
}

# private NAME: a file of this job's volume, named plainly.
private() {
	case "$1" in
	'' | .* | *[!a-z0-9.-]*) return 1 ;;
	esac
	[ -f "$dir/$1" ]
}

# uuid VALUE: a canonical lowercase UUID.
uuid() {
	case "$1" in
	'' | *[!0-9a-f-]*) return 1 ;;
	esac
	[ "${#1}" -eq 36 ]
}

code() {
	case "$1" in
	[1-5][0-9][0-9]) printf '%s' "$1" ;;
	*) printf '000' ;;
	esac
}

# auth_get PATH HEADER, auth_post PATH BODY, api_get PATH HEADER: one bounded request without proxy or redirect, its
# reply in $reply; each prints the status. curl's own messages are discarded: they could quote the request.
auth_get() {
	got=$(curl -q -s --noproxy '*' --proto =http --max-time 15 --max-filesize 1048576 -o "$reply" -w '%{http_code}' \
		-H "@$2" -H 'Accept: application/json' "$auth$1" 2>/dev/null) || true
	code "$got"
}

auth_post() {
	got=$(curl -q -s --noproxy '*' --proto =http --max-time 15 --max-filesize 1048576 -o "$reply" -w '%{http_code}' \
		-X POST -H 'Accept: application/json' -H 'Content-Type: application/json' --data-binary "@$2" "$auth$1" \
		2>/dev/null) || true
	code "$got"
}

api_get() {
	got=$(curl -q -s --noproxy '*' --proto =http --max-time 15 --max-filesize 4194304 -o "$reply" -w '%{http_code}' \
		-H "@$2" -H 'Accept: application/json' -H "Host: $AYA_PROBE_API_HOST" "$api$1" 2>/dev/null) || true
	code "$got"
}

# word NAME: the reply's first string member NAME when it is a plain word (an error code), or -.
word() {
	value=$(grep -o "\"$1\":\"[a-z_]*\"" "$reply" 2>/dev/null | head -n 1 | cut -d '"' -f 4) || true
	printf '%s' "${value:--}"
}

# match NAME WANT: ok without WANT; otherwise match or mismatch of the reply's first UUID member NAME and WANT.
match() {
	value=$(grep -o "\"$1\":\"[0-9a-f-]\{36\}\"" "$reply" 2>/dev/null | head -n 1 | cut -d '"' -f 4) || true
	if [ -z "$2" ]; then
		printf 'ok'
	elif [ "$value" = "$2" ]; then
		printf 'match'
	else
		printf 'mismatch'
	fi
}

command=${1:-}
if [ "$#" -gt 0 ]; then
	shift
fi
case "$command" in
user)
	private "${1:-}" || refuse user
	if [ -n "${2:-}" ]; then uuid "$2" || refuse user; fi
	status=$(auth_get /user "$dir/$1")
	if [ "$status" = 200 ]; then detail=$(match id "${2:-}"); else detail=$(word error_code); fi
	echo "user $status $detail"
	;;
me)
	private "${1:-}" || refuse me
	if [ -n "${2:-}" ]; then uuid "$2" || refuse me; fi
	status=$(api_get /v1/me "$dir/$1")
	if [ "$status" = 200 ]; then detail=$(match account_id "${2:-}"); else detail=$(word code); fi
	echo "me $status $detail"
	;;
api)
	private "${1:-}" || refuse api
	case "${2:-}" in
	/v1/*) ;;
	*) refuse api ;;
	esac
	case "$2" in
	*[!A-Za-z0-9/?=._-]*) refuse api ;;
	esac
	status=$(api_get "$2" "$dir/$1")
	digest=$(sha256sum "$reply" 2>/dev/null | cut -d ' ' -f 1) || true
	echo "api $status ${digest:--}"
	;;
refresh)
	private "${1:-}" || refuse refresh
	status=$(auth_post '/token?grant_type=refresh_token' "$dir/$1")
	if [ "$status" = 200 ]; then detail=issued; else detail=$(word error_code); fi
	echo "refresh $status $detail"
	;;
password)
	private "${1:-}" || refuse password
	if [ -n "${2:-}" ]; then uuid "$2" || refuse password; fi
	status=$(auth_post '/token?grant_type=password' "$dir/$1")
	if [ "$status" != 200 ]; then
		echo "password $status $(word error_code)"
	elif [ -z "${2:-}" ]; then
		echo "password 200 issued"
	else
		token=$(grep -o '"access_token":"[A-Za-z0-9._-]*"' "$reply" 2>/dev/null | head -n 1 | cut -d '"' -f 4) || true
		rm -f "$reply"
		if [ -z "$token" ]; then
			echo "password 200 no-token"
		else
			printf 'Authorization: Bearer %s\n' "$token" > "$issued"
			token=
			me=$(api_get /v1/me "$issued")
			rm -f "$issued"
			if [ "$me" = 200 ]; then detail=$(match account_id "$2"); else detail=$(word code); fi
			echo "password 200 issued me $me $detail"
		fi
	fi
	;;
ready)
	status=$(api_get /v1/readyz /dev/null)
	if [ "$status" = 200 ] && grep -q '"status":"ready"' "$reply" 2>/dev/null; then detail=ready; else detail=-; fi
	echo "ready $status $detail"
	;;
*)
	echo "usage: probe.sh user|me|api|refresh|password|ready ..." >&2
	exit 2
	;;
esac
rm -f "$reply" "$issued"
