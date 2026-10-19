# aya-inspect (deploy/compose.yaml, profile ops): one line per file or directory of the secret volumes mounted read-only
# under /probe: relative path, owner UID, group GID, octal mode, type (f or d) and size. Never a content.
set -eu
cd /probe
find . -mindepth 1 -printf '%P|%U|%G|%m|%y|%s\n' | LC_ALL=C sort
