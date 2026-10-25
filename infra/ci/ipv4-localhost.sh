#!/bin/sh
# Makes the name `localhost` resolve to IPv4 only on a Linux runner (a no-op elsewhere).
# Why: several backend tests start an IPv4-only loopback stub (net.Listen("tcp4", "127.0.0.1:0")) and dial it as `localhost`.
# On Ubuntu /etc/hosts also maps ::1 to `localhost`, pgx then tries both addresses, and
# backend/internal/store TestOpenAllowingVerifiesTheServerCertificateOnTheWire/only_the_explicit_private-network_exception_speaks_plaintext
# counts two plaintext startups instead of one (reproduced in ubuntu:24.04, gone once localhost has no ::1). The ::1 line keeps its
# ip6-localhost and ip6-loopback aliases. The original file is kept as /etc/hosts.aya-ci.orig. Runs on the disposable runner VM only.
set -eu
[ "$(uname -s)" = Linux ] || { echo "ipv4-localhost: nothing to do on $(uname -s)"; exit 0; }
sudo=""
[ "$(id -u)" = 0 ] || sudo=sudo
echo "localhost before: $(getent ahosts localhost | awk '{print $1}' | sort -u | tr '\n' ' ')"
tmp=$(mktemp)
awk '$1 == "::1" { out = "::1"; for (i = 2; i <= NF; i++) if ($i != "localhost") out = out " " $i; if (out != "::1") print out; next } { print }' /etc/hosts >"$tmp"
$sudo cp /etc/hosts /etc/hosts.aya-ci.orig
$sudo tee /etc/hosts <"$tmp" >/dev/null # written in place: /etc/hosts may be a bind mount
rm -f "$tmp"
after=$(getent ahosts localhost | awk '{print $1}' | sort -u | tr '\n' ' ')
echo "localhost after:  $after"
case "$after" in
  *:*) echo "ipv4-localhost: localhost still resolves to an IPv6 address" >&2; exit 1 ;;
  *127.0.0.1*) ;;
  *) echo "ipv4-localhost: localhost no longer resolves to 127.0.0.1" >&2; exit 1 ;;
esac
