#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
exec python3 integration/e2e.py android
