# UMAR release-candidate CI (2026-10-25)

Status: CI artifact preparation only. The output is an **unsigned, unapproved** candidate. This is not CD: `.github/workflows/umar-release-candidate.yml` does not sign, deploy, upload to a store, push images, use environments or secrets, or merge anything. There is deliberately no placeholder deploy job.

## What CI runs
- Triggers: scoped `pull_request`, `push` to `main`, `workflow_dispatch`. `contents: read`, older runs cancelled, 45 min timeout.
- Backend (`backend-umar`): `go test -count=1 -race ./...` against a disposable Postgres 17.11-alpine service (loopback `127.0.0.1:16585`, db `umar_synthetic`, trust auth, CI only), then `go vet ./...` and `go build ./cmd/...`.
- **Backend Go tests run fully with disposable Postgres and a test OIDC issuer; the native Kotlin/Robolectric sync cases that need real GoTrue skip without fixtures, and there is no hosted real-GoTrue CI coverage.**
- `integration/verify-endpoint-isolation.py` and the existing tunnel Python unit tests (no endpoint is opened).
- Android (`sh gradlew`): `core:model/engine/content` tests + `validatePacks`; `core:data:testDebugUnitTest`, `app:testDemoDebugUnitTest`, `core:sync:test`, `app:testSyncLabDebugUnitTest`; `app:lintProdRelease`, `app:bundleProdRelease`.
- Candidate: after `HEAD == GITHUB_SHA` and a clean `git status --porcelain`, builds linux amd64/arm64 `umar-api` and `umar-migrate` (CGO off) into `$RUNNER_TEMP/umar-candidate` (outside the checkout), checks `go version -m` (vcs.revision, vcs.modified=false, GOOS, GOARCH), checks the AAB, writes `manifest.json` and `SHA256SUMS`.
- Artifact `umar-release-candidate-unsigned` (7 days) holds exactly: `app-prod-release.aab`, `umar-api-linux-amd64`, `umar-migrate-linux-amd64`, `umar-api-linux-arm64`, `umar-migrate-linux-arm64`, plus `manifest.json` and `SHA256SUMS`.

## Local equivalent
```sh
git status --porcelain   # must print nothing
git rev-parse HEAD       # must match the revision you expect in manifest.json
PG_BIN=/Applications/Postgres.app/Contents/Versions/16/bin sh backend-umar/scripts/integration.sh
(cd backend-umar && go vet ./... && go build -o "$(mktemp -d)/" ./cmd/...)
(cd backend-umar && python3 -m unittest discover -s ../integration/tunnel -p 'test_*.py')
(cd android && python3 ../integration/verify-endpoint-isolation.py)
(cd android && sh gradlew :core:model:test :core:engine:test :core:content:test :core:content:validatePacks --stacktrace)
(cd android && sh gradlew :core:data:testDebugUnitTest :app:testDemoDebugUnitTest :core:sync:test :app:testSyncLabDebugUnitTest --stacktrace)
(cd android && sh gradlew :app:lintProdRelease :app:bundleProdRelease --stacktrace)
```
The existing `backend-umar/scripts/integration.sh` helper owns its own fresh disposable Postgres fixture and cleans up only its own path; do not create or remove existing containers for this. `PG_BIN` above is the Postgres.app path on this host; on other hosts set it to the bin directory of the installed Postgres version. No new dependency install is needed.

Then repeat the workflow's cross-build step with an output directory outside the checkout and run its Python verification. Spot checks:
```sh
go version -m "$out/umar-api-linux-arm64" | grep -E 'GOOS|GOARCH|CGO_ENABLED|vcs'
unzip -l "$out/app-prod-release.aab" | grep -E 'BundleConfig.pb|base/manifest/AndroidManifest.xml'
unzip -l "$out/app-prod-release.aab" | grep -Ei 'META-INF/.*[.](SF|RSA|DSA|EC)$'   # must print nothing
(cd "$out" && sha256sum -c SHA256SUMS)
```

## Unsigned AAB vs debug synthetic APK
- `app-prod-release.aab` is unsigned and cannot be installed directly on a device. It is a store-pipeline input only, and signing and approval do not exist yet.
- Physical-device beta today means the debug synthetic APK (demo flavor, `android-gate` artifact `ayailmu-demo-debug`). It is sideloaded and carries synthetic content only. The synthetic sync lab is a separate package.

## Facts, not claims
- AyaIlmu Android id `id.petalytix.ayailmu`, version `0.1.0`, versionCode `1`.
- `PROJECT_OVERVIEW` states store accounts already exist (AyaKasir publishes on Play). The plan is to create AyaIlmu inside the existing Petalytix account. Existing store app records, keys and Apple team metadata are unverified here, so do not claim new accounts are needed.
- `CODE_RULES` require a separate AyaIlmu keystore. Do not reuse the AyaKasir key.
- iOS: no native project exists. Expo is a prototype only, so there is no TestFlight build.
- Content: all 3162 items / 73 packs are draft, including 17 Arabic packs. The ordinary prod filter on approved content is currently empty. The Arabic app Ayangaji is separate and out of scope.
- No change here enables auth or sync in prod or demo. A public tunnel and production are not approved.

## Actual CD stays gated on
- Approved host: Supabase Postgres only plus self-hosted GoTrue/Go.
- Dedicated DB project, region and budget.
- Domain, TLS and SMTP.
- Separate app and auth DB backup plus a restore drill, and separate migration vs runtime DB identities.
- Reviewed content, and consent, export, deletion and retention policies.
- AyaIlmu signing key and store approval.
