#!/bin/bash
set -euo pipefail
if [ "$CONFIGURATION" = Release ]; then
  case " ${SWIFT_ACTIVE_COMPILATION_CONDITIONS:-} " in *PRIVATE_OWNER_QA*) echo 'error: PRIVATE_OWNER_QA is forbidden in Release'; exit 1;; esac
  if [ -z "${AYAILMU_ORIGIN:-}" ] && [ -z "${AYAILMU_RELEASE_APPROVED_ORIGIN:-}" ]; then
    # Account-free Release, as on Android: lessons on the device only, no sign-in and no network.
    [ -z "${AYAILMU_DECLARATION_VERSION:-}" ] && [ -z "${AYAILMU_SYNC_POLICY_VERSION:-}" ] || { echo 'error: Account values without an approved origin'; exit 1; }
  else
    [ -n "${AYAILMU_RELEASE_APPROVED_ORIGIN:-}" ] && [ "${AYAILMU_ORIGIN:-}" = "$AYAILMU_RELEASE_APPROVED_ORIGIN" ] && [ -n "${AYAILMU_DECLARATION_VERSION:-}" ] && [ -n "${AYAILMU_SYNC_POLICY_VERSION:-}" ] || { echo 'error: Release with accounts requires explicit approved HTTPS origin, declaration and sync policy from the infrastructure owner'; exit 1; }
    case "$AYAILMU_ORIGIN" in https://localhost*|https://127.*|https://\[*) echo 'error: Release rejects a localhost origin'; exit 1;; https://*) ;; *) echo 'error: Release requires HTTPS'; exit 1;; esac
  fi
fi

[[ "${AYAILMU_REGISTRY_SOURCE_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'error: A valid registry source commit for the bundled content is required'; exit 1; }
if [ -n "${AYAILMU_ORIGIN:-}" ] && [ "$CONFIGURATION" = Release ]; then
  [[ "${AYAILMU_SYNC_POLICY_VERSION:-}" =~ ^[a-z0-9-]{3,80}$ ]] || { echo 'error: Explicit valid sync policy is required'; exit 1; }
fi
