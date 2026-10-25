# Infra CI wiring (shared by the Ayangaji and AyaIlmu/Umar integration branches)

This directory is **byte-identical on both branches**. The workflows call these scripts and nothing else holds shell logic, so
the commands below are exactly what runs in CI. It tests only: no secrets, deployment, publish, paid runner or service.

| script | purpose |
| --- | --- |
| `check-tools.sh [--real-auth]` | fails with the exact missing piece: Go (exactly `go1.27.2`, `GOTOOLCHAIN=local`), python3, openssl, `PG_BIN` = a PostgreSQL 16 `bin` dir; `--real-auth` adds cc, docker CLI, explicit `DOCKER_HOST` on Linux, a reachable daemon |
| `install-postgres16-ubuntu.sh` | `apt` PostgreSQL 16 binaries on an Ubuntu runner, no cluster/service left running (`PG_BIN=/usr/lib/postgresql/16/bin`) |
| `ipv4-localhost.sh` | Linux runner only: drops `localhost` from the `::1` line of `/etc/hosts` (original kept). A backend transport test dials an IPv4-only stub as `localhost`; with `::1` also mapped it counts two plaintext startups instead of one (reproduced on ubuntu:24.04) |
| `warm-go.sh ROOT...` | the **only networked Go step**: `go mod download`, `go vet ./...`, jose-util build for each clone's module, into runner-owned caches |
| `run-readiness.sh --peer PEER [--fixtures DIR]` | logs source/peer SHAs, runs the full `sh infra/supabase/run-tests.sh` with `GOPROXY=off GOTOOLCHAIN=local GOENV=off`, fails on any skip |
| `run-real-auth.sh` | (Ayangaji only) pre-caches the two pinned public images, then `run_real_auth_tests.py --full --race`; fails unless `failed=0 skipped=0` and six real-GoTrue passes |
| `precache-images.py` | pulls exactly the two digest-pinned images named in `infra/real-auth/real_auth_fixture.py` (anonymous, empty throwaway `DOCKER_CONFIG`); the fixture helper itself never pulls |
| `go-env.sh` | sourced; the isolated Go world under `AYA_CI_ROOT` (default `$RUNNER_TEMP/aya-ci`). `HOME` is never repurposed |

Local parity (same scripts; macOS example, tool locations are yours):

    export PG_BIN=/Applications/Postgres.app/Contents/Versions/16/bin AYA_CI_ROOT=/some/empty/dir   # go1.27.2 first in PATH
    sh infra/ci/warm-go.sh "$PWD" ../peer-clone
    sh infra/ci/run-readiness.sh --peer ../peer-clone [--fixtures app/src/content/fixtures]   # fixtures: Ayangaji only
    DOCKER_HOST=unix://$HOME/.docker/run/docker.sock sh infra/ci/run-real-auth.sh             # Ayangaji only

`--peer` / `INFRA_PEER_CLONE` has **no default**: the old sibling checkout can never be tested by accident.

## Companion branches (publish together)

The cross-app isolation test needs both backends, so each readiness job checks out *its own* revision into `source/` and the
**companion integration branch of the same repository** (`${{ github.repository }}`, no other account) into `peer/`:

| branch | companion checked out as `peer/` |
| --- | --- |
| `integration/ayangaji-infra-ci-20261025` | `integration/ayailmu-infra-ci-20261025` |
| `integration/ayailmu-infra-ci-20261025` | `integration/ayangaji-infra-ci-20261025` |

Both refs must be published **together, preferably in one atomic two-ref push** (`git push --atomic`), after approval; until both
exist the other branch's readiness job cannot check out its peer and fails (it never falls back). These names are an intentional
companion *mapping*, not a claim to an immutable pair of commit hashes: each branch would have to contain the other's hash, which
is circular. Every run logs the resolved source and peer SHAs (job log and step summary) so a run is attributable. Changes to one
branch's backend are exercised by the other branch's workflow only when that workflow runs.

## Ayangaji branch: why a path-scoped merge

`integration/ayangaji-infra-ci-20261025` has two parents, `8b29a91` (current frontend-only tree) and `384b515` (verified adult
backend payload). The histories share only `f6d76e9`; a plain merge would import the legacy `android/`, `prototype-expo/`,
`ai-memory/` and `.idea/` trees and rename the current `app/` to `prototype-expo/`. The merge therefore used
`--strategy=ours --no-commit --no-ff` and restored only `backend/`, `deploy/` and `infra/` from the payload, plus the infra bytecode
ignore entries in `.gitignore`. Everything else is byte-identical to `8b29a91`.

Consequence found while wiring CI: `TestRegistryPinsExactPackBytesAndHonestStatus` reads two **Android** packs from
`android/content/...` of the repository, which this frontend-only tree does not have. They are archived byte-exact in
`infra/catalog/pinned-android-packs/` (see its `PROVENANCE.md`) and the test takes the root from `AYA_TEST_ANDROID_PACKS_ROOT`
(unset: unchanged default). `run-readiness.sh` and `run-real-auth.sh` verify the archive's `SHA256SUMS` and set it. No pin changed.
The AyaIlmu/Umar branch's own `android/.../matematika/mat/v1.json` differs from that pin; this is recorded, not altered.

## What is not covered

No hosted GitHub Actions run of these workflows has happened. See the integration report for the local evidence and its limits.
