# Private Native QA Implementation Plan

> **For agentic workers:** Use the preserved Claude Opus5.5 HIGH authoring route, test-first in small batches; Codex coordinates/verifies.

**Goal:** Install and exercise a private native account build without weakening production.
**Architecture:** Named private-qa capability at fixed localhost origins, owner-only email, and app-only designated-CA transport; existing account/recovery lifecycle reused. Runtime provisioned separately.
**Tech Stack:** Expo58, RN0.88, TypeScript, native Swift/Kotlin, Xcode27.1, task-local CocoaPods/Gradle9.4.1.
**Spec:** docs/superpowers/specs/2026-10-26-private-native-qa-design.md

## Global Constraints

- API https://localhost:58444; Auth https://localhost:58445; mailbox owner-qa@example.invalid only.
- No production/local/staging guard changes. No public source push or tunnels; no global trust/path changes.
- Preserve every frozen test assertion; test RED before implementation.
- No runtime credentials/CA keys/service work; await verified runtime handoff. Four emails maximum, coordinated before EACH send.

## Review Focus

- Unknown/malformed/mutated private profile rejects before network.
- Wrong origin/port/recipient and public-build flag drift do not gain QA access.
- Native transport verifies designated CA AND hostname; no redirects/cookies/cache/global fallback.
- Background/cancel/restart fences preserve account and secure-session isolation.
- PKCE warm/cold callback is tested on native build, not substituted by OTP HTTP proof.

### Task1: Private profile, owner guard and production invariants

- [x] Author focused failing regression against existing configuration/adapters; run RED and freeze.
- [x] Add private-qa profile and explicit capability/registration flag, exact origins and owner policy; propagate through API/auth/registration/secure persistence.
- [x] Verify new tests and full frozen suite; review and local checkpoint.

### Task2: App-only native trust and fetch integration

- [ ] Establish verified public CA path/hash from runtime owner; no private keys.
- [x] Implement the private-QA transport boundary, iOS/Android native sources and certificate build plugin; verify source guards, compiler checks and ordinary-build separation. Real certificate-chain/hostname acceptance remains pending below.
- [ ] Prebuild isolated native artifact with supplied public CA, build embedded-JS unsigned simulator app/local Android APK.

### Task3: Native account acceptance

- [ ] Confirm runtime/issuer/API mapping and shared email ledger before any send.
- [ ] Registration/confirmation/login, secure restart restoration, logout; warm/cold PKCE reset under total4email ceiling.
- [ ] Device screenshots and native/storage/network evidence; no actual account deletion or curriculum approval.
- [x] Full source checks and independent review; record precise local commits and remaining limits, no push.

## Verified source checkpoint — 2026-10-26

- Integrated suite: 1,702 tests in 166 suites pass. TypeScript and repository lint pass (three unchanged warnings); all 173 protected baseline test/helper files remain byte-identical.
- Private recovery now uses native S256, secure single-use cold persistence, strict wrapped verification URLs and HTTP 303 callbacks, with separate recovery authority, bounded digest/network waits, cancellation and expiry fences.
- iOS policy checks pass, and the new bridge compiles to an arm64 simulator object against the installed SDK and real Expo/RN frameworks. Android policy compiles against the installed Android API and pinned OkHttp/Okio; a host counter fixture verifies the one-HTTP-attempt guard. These are not device/TLS acceptance.
- iOS and Android Hermes exports pass under an ordinary tester profile. They are shared-code exports, not an enabled private-QA app or an installable release.
- Expo's actual prebuild configuration loads normally without QA trust metadata. The private profile fails closed without the real designated public CA and its DER SHA-256. No substitute certificate or fingerprint is used.

## Remaining acceptance boundary

The runtime owner has not supplied a verified public CA or running private endpoints. Its startup action and permitted retry did not execute after review timeouts; this task must not retry them. Enabled QA prebuild/build and real registration, restore, warm/cold recovery and TLS tests remain blocked. No email was sent in this pass. Android also still needs the previously approved Build Tools 37.0.0, NDK 27.1.12297006 and CMake 3.30.5 before a full native build. No OS trust, credentials, public tunnel, publication or production configuration was changed.
