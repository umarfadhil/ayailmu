#!/bin/sh
# Warms the Go module graph of each given clone root into the runner-owned AYA_CI_ROOT caches (the only step that uses the
# network). Everything afterwards runs with GOPROXY=off, so a module missing here fails the test step instead of fetching.
#   sh infra/ci/warm-go.sh SOURCE_ROOT PEER_ROOT
set -eu
here=$(cd "$(dirname "$0")" && pwd)
AYA_CI_GO_ONLINE=1
export AYA_CI_GO_ONLINE
. "$here/go-env.sh"
[ "$#" -gt 0 ] || ci_fail "usage: warm-go.sh CLONE_ROOT..."
for root in "$@"; do
  mod=$(ci_module_dir "$root")
  echo "== warming Go modules for $mod"
  (
    cd "$mod"
    go mod download
    go vet ./... # compiles every package and test dependency, so the test build graph is cached too
    # The real-auth fixture builds the pinned jose-util from this module's go-jose.
    if grep -q 'github.com/go-jose/go-jose/v4 ' go.mod; then
      go build -o /dev/null github.com/go-jose/go-jose/v4/jose-util
    fi
  )
done
echo "warm ok: $(du -sk "$GOMODCACHE" | cut -f1) KiB module cache"
