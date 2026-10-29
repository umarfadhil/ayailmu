#!/bin/sh
set -eu
DATABASE_URL=$(cat /run/umar-auth/database-url)
GOTRUE_JWT_KEYS=$(cat /run/umar-auth/signing-keys.json)
GOTRUE_JWT_SECRET=$(cat /run/umar-auth/jwt-secret)
export DATABASE_URL GOTRUE_JWT_KEYS GOTRUE_JWT_SECRET
exec auth
