# Private normal account QA

The `normalQa` Android flavor exercises the native normal account and lesson paths against a separately verified private runtime. It has no release variant. This is a private QA activation mechanism; `umar.normalQa.approved=true` does not approve production auth, policy, curriculum, deployment, or distribution. See [normal auth readiness](NORMAL_AUTH_READINESS.md) for the release gates.

## Identity and isolation

The debug package is `id.petalytix.ayailmu.normalqa`, version name `0.1.0-normalqa`, version code `1`. Its separate application ID isolates Room, settings, no-backup credential/journal storage, and Android Keystore from demo, prod, and syncLab. It uses the non-lab native account implementation, with developer demo, syncLab, and billing flags disabled. No Google sign-in flow or Google CTA is implemented.

QA debug tasks are absent unless `umar.normalQa.buildEnabled=true`. The `normalQaRelease` variant is always disabled, including with that opt-in. Normal production `umar.normalAuth.*` defaults remain unchanged and off. QA inputs do not activate demo/prod auth.

## Verified-runtime prerequisites

Before enabling QA auth, obtain a verified handoff from the runtime owner covering:

- The exact same-origin HTTPS auth and normal API gateway at `https://localhost:58443`, reachable from the chosen Android device or emulator through the approved private route. Android loopback is the device's own loopback; a host listener alone does not establish device reachability.
- The designated public CA certificate and its independently verified SHA-256 certificate fingerprint. Supply only the public certificate, never private keys or a credential bundle. The runtime's server certificate must be valid for `localhost` and chain to this CA.
- The actual runtime `ownerDeclarationVersion`, `syncPolicyVersion`, and `registrySourceCommit`, with matching native pack/rules provenance and backend registry. Obtain these values from the runtime owner; do not invent policy identifiers or substitute an unrelated source commit.
- The approved test identities, mail execution ledger, email templates, allowed test operations, and runtime/data isolation. Coordinate confirmation and recovery mail with the runtime owner and the shared ledger before sending; check previous sends to avoid duplicate attempts. Record outcomes without passwords, session tokens, or codes. Earlier SMTP evidence does not prove the native flow or authorize another send.

Runtime startup, routing, database migrations/grants, SMTP changes, certificate issuance, and mail delivery require their own authorized infrastructure work. This guide does not start services, generate a CA, install global/device trust, bypass TLS, create a tunnel, or distribute an APK.

## Exact build properties

All inputs use the `umar.normalQa.` prefix. Values are supplied locally through the verified handoff; no real paths, certificates, credentials, or policy version values belong in this document.

| Property | Meaning and validation |
| --- | --- |
| `umar.normalQa.buildEnabled` | Defaults to `false`; exactly `true` exposes the debug variant. This is a build opt-in, separate from auth activation. |
| `umar.normalQa.approved` | Defaults to `false`; use exactly `true` only after runtime verification and matching configuration. Activates private QA normal auth only. |
| `umar.normalQa.publicOrigin` | Empty by default; the only accepted nonempty value is exactly `https://localhost:58443`, without a trailing slash. Required for activation. |
| `umar.normalQa.publicCaFile` | Local file containing exactly one designated public X.509 CA certificate. Required when preparing/building QA trust. |
| `umar.normalQa.publicCaSha256` | Exactly 64 lowercase hexadecimal characters: SHA-256 of the certificate's DER encoding, without colons. This is not the hash of a PEM file's text. Compare against the independently verified handoff fingerprint. |
| `umar.normalQa.ownerDeclarationVersion` | Runtime-supplied declaration identifier; must match `[a-z0-9][a-z0-9-]{2,79}`. Required for activation. |
| `umar.normalQa.syncPolicyVersion` | Runtime-supplied consent policy identifier; same format as declaration version. Required for activation. |
| `umar.normalQa.registrySourceCommit` | Runtime-supplied exact registry source commit, 40 lowercase hexadecimal characters. Required for activation. |

`prepareNormalQaTrust` requires a regular certificate file of 1–65,536 bytes, rejects private-key markers, requires exactly one certificate, checks its validity interval and CA basic constraints, and requires certificate-signing usage when key usage is present. It compares the SHA-256 of `certificate.encoded` (DER) to `publicCaSha256`, then copies only the public DER certificate into the generated QA resource `raw/qa_public_ca`. The task validates on each execution and runs before QA debug resource merging/packaging.

The QA manifest selects `normal_qa_network_security`: cleartext is disabled; the designated bundled CA is trusted for `localhost` only, excluding subdomains. The normal account configuration additionally requires the exact origin and port above. No global trust change or hostname-verification bypass is involved. Production/demo/syncLab do not bundle the QA trust resource or evaluate the certificate during their ordinary builds.

## Build and verification commands

Run from `android/` with JDK 17, the configured Android SDK, and cached dependencies for offline builds. These commands assume the quoted `AYAILMU_QA_*` variables were populated from the verified handoff. The shell rejects missing values. Run the activation command only after the prerequisites above are verified; it has not been executed successfully for the currently blocked runtime.

```sh
sh ./gradlew --offline --console=plain --max-workers=2 -Dorg.gradle.parallel=false \
  -Pumar.normalQa.buildEnabled=true \
  -Pumar.normalQa.approved=true \
  -Pumar.normalQa.publicOrigin=https://localhost:58443 \
  "-Pumar.normalQa.publicCaFile=${AYAILMU_QA_PUBLIC_CA_FILE:?Set from verified handoff}" \
  "-Pumar.normalQa.publicCaSha256=${AYAILMU_QA_PUBLIC_CA_SHA256:?Set verified DER fingerprint}" \
  "-Pumar.normalQa.ownerDeclarationVersion=${AYAILMU_QA_OWNER_DECLARATION_VERSION:?Set runtime value}" \
  "-Pumar.normalQa.syncPolicyVersion=${AYAILMU_QA_SYNC_POLICY_VERSION:?Set runtime value}" \
  "-Pumar.normalQa.registrySourceCommit=${AYAILMU_QA_REGISTRY_SOURCE_COMMIT:?Set runtime value}" \
  :app:assembleNormalQaDebug
```

The resulting local build output, after a successful build, is `app/build/outputs/apk/normalQa/debug/app-normalQa-debug.apk`. Building is separate from permission to install or distribute it. Missing public CA input intentionally fails the build; do not replace it with a generated certificate or skip `prepareNormalQaTrust`.

Source/fixture and production checks can run without QA activation or a CA:

```sh
sh ./gradlew --offline --console=plain --max-workers=2 -Dorg.gradle.parallel=false \
  :app:testDemoDebugUnitTest :app:ktlintCheck \
  :app:lintProdRelease :app:assembleProdRelease
```

A task-graph inspection can expose the opted-in debug build without starting the trust task:

```sh
sh ./gradlew --offline --console=plain \
  -Pumar.normalQa.buildEnabled=true :app:assembleNormalQaDebug --dry-run
```

A dry run verifies dependencies only. It cannot establish certificate validity, runtime readiness, native E2E success, or the existence of a QA APK.

## QA lesson fixture boundary

The QA-only `config/catalog.json` selects one `normal-qa-arithmetic` track. Its pack and rules live under `app/src/normalQa/assets/`. The pack contains two manually checked arithmetic multiple-choice items, `2 + 3 = 5` and `7 - 4 = 3`, marked approved solely for this private QA fixture. The private runtime must serve the matching approved QA registry/proofs and accept normal native answer events.

These two items do not approve release content. All 73 release packs remain draft. The production catalog and original release assets remain unchanged; the QA catalog, fixture pack/rules, CA resource, and network configuration are excluded from production packaging. QA fixture approval is not curriculum or production release approval.

## Current evidence and remaining acceptance

As of 2026-10-26, local verification passed 343 demo unit tests with zero failures/skips, ktlint, production release lint, and production release assembly. Guard checks confirmed that QA debug is absent by default, the explicit debug opt-in schedules trust preparation before packaging, QA release tasks remain absent, another origin is rejected, and an actual opted-in debug build fails explicitly without the designated public CA. Production APK inspection confirmed the original 73-track catalog and absence of QA assets, QA trust/network resources, and the private localhost origin in DEX.

No designated public CA is available in the current handoff. Runtime startup remains separately blocked by execution-review timeouts. No QA APK or actual native E2E result has been produced. Unit tests, a production build, earlier SMTP checks, and a task graph do not close those gaps.

After the runtime owner resolves those prerequisites and authorizes the session, actual native E2E must cover registration, real authorized confirmation delivery and code entry, wrong-code rejection, no pre-confirmation session, sign-in, adult learner creation/selection, native fixture lessons, explicit sync opt-in, offline queue/retry/deduplication, process restart/session restoration, logout/relogin, second-owner isolation, recovery/reset, and policy-change re-consent. Coordinate every mail-producing step through the shared mail ledger. Keep resulting QA evidence separate from production policy/content approval, signing, physical-device acceptance, and distribution decisions.
