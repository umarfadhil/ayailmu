# Ayangaji release runbook

Status: read-only preparation for a controlled release only. Nothing here has been built, signed, uploaded, submitted
or deployed, and nothing here is legal, privacy, content or store approval. Actual CI has NOT been run and no native
binary has been built. The last local result was quality 1134/118 with typecheck and lint passing, taken before the
queued content-review repairs. The workflow and `app/eas.json` stay unrun configuration until a first real GitHub run.

Ayangaji is distinct from Umar AyaIlmu. No Umar credential or identity is claimed reusable (pending non-secret
coordination); no ID, package or account is invented here. File paths keep the `arabic-app` names to avoid overlaps.

## 1. Kinds of evidence (do not conflate)

| Kind | What it proves | What it does not prove |
| --- | --- | --- |
| Local checks | Typecheck, lint and in-memory tests pass on one machine | Anything about a real service, device or store |
| GitHub CI | The same checks pass on a clean runner at a known SHA | Behaviour on a device or against live services |
| JS export | Metro bundles web, iOS and Android JS in each mode | An installable app; no native code is built |
| Native binary (EAS) | A cloud build compiled for one profile | That it is signed for release, or that it works |
| Signed binary | The owner's identities and credentials produced it | Device behaviour or store acceptance |
| Device proof | A named build ran the checklist on a physical phone | Backend readiness |
| Deploy | A service serves the build's mode, with provenance | Nothing here is deployed |

Today only local checks and earlier local exports/Expo Go runs exist. Those exports are not signed-release QA.

## 2. Commands (run from `app/`)

```sh
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand --ci
npm run export:dev      # EXPO_PUBLIC_APP_MODE=developer-demo -> dist/developer-demo
npm run export:tester   # EXPO_PUBLIC_APP_MODE=tester         -> dist/tester
```

CI sets `EXPO_PUBLIC_AUTH_PROVIDER=off`, `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=off`, `EXPO_NO_DOTENV=1`, `EXPO_OFFLINE=1`,
`EXPO_NO_TELEMETRY=1` for the same commands. Set them locally too, so a developer `.env` or shell cannot turn accounts
on or change an export. `dist/` is ignored by Jest; do not commit it.

## 3. CI: `.github/workflows/arabic-app-ci.yml`

- Triggers: `pull_request` (draft PRs included), `push` to `main` and `feature/rn-correctness-20261020`,
  `workflow_dispatch`. Pull-request and push runs are limited to `app/**`, the workflow file,
  this runbook and `docs/Unit_A_Pilot_Content_Review.md`.
- Check name: **`Ayangaji: checks and JS exports`** (workflow `Ayangaji CI`, job `checks`). Branch protection is
  NOT configured, so nothing requires it yet. If it is required later, note that a path-filtered workflow that
  does not run leaves a required check pending on PRs that touch no listed path.
- Untrusted PR security: `pull_request` only (never `pull_request_target`), `permissions: contents: read`, no secrets,
  OIDC or environments, `persist-credentials: false`, actions pinned to full SHAs, no publish step. Fork PRs get a
  read-only token. Do not add secrets, a deploy job or live-auth smoke checks to this workflow.
- SHA: it checks out `github.event.pull_request.head.sha || github.sha` (the default PR ref is a merge commit), fails if
  `HEAD` differs, and stamps that SHA as `EXPO_PUBLIC_BUILD_SHA`. A coordinator `rg` confirmed the app does NOT
  consume `EXPO_PUBLIC_BUILD_SHA` in `app/src` today. The artifact name and `JS_EXPORT_ONLY.txt` do prove the checked-out
  SHA; the bundle shows nothing of it, and no visual build badge exists or is implied.
- Node 22.16.0, `npm ci` against `app/package-lock.json`. One job runs the quality steps once, then both exports.
- Artifacts, kept 7 days: `arabic-app-js-export-developer-demo-<sha>` and `arabic-app-js-export-tester-<sha>`. Each is a
  JS export (web, iOS, Android bundles) with a `JS_EXPORT_ONLY.txt` note. Not a native binary.
- Concurrency group is repo + head branch, so a PR run and a push run of one checkpoint share it and stale runs are
  cancelled (no duplicate exports). `main` runs get a unique group and are never cancelled. A fork PR whose branch
  name matches a repo branch would share that branch's group. Timeout 30 minutes.
- Validity: coordinator local YAML/JSON config and security probes passed 26/26. An actual GitHub workflow run is NOT
  yet verified and no native binary is built. Unconfirmed: whether `EXPO_PUBLIC_ACCOUNT_ENV=staging` with the provider
  `off` exports cleanly.

## 4. Native build profiles: `app/eas.json`

Expo documents EAS Build as a hosted service that builds Android and iOS binaries from build profiles in `eas.json`
([docs](https://docs.expo.dev/build/introduction/)). The file declares profiles only: no `submit`, no auto-upload, no
OTA channels, no credentials. Versions are local and raised by hand; `autoIncrement` is off. No `expo-dev-client`.

| Profile | Mode | Account env | Accounts | Android | iOS |
| --- | --- | --- | --- | --- | --- |
| `developer-preview` | `developer-demo` | unset | explicit off | internal APK | internal, real device |
| `staging-tester` | `tester` | `staging` | explicit off | internal APK | internal, real device |
| `production` | `tester` | `production` | explicit off | app bundle | store |

Every profile sets `EXPO_PUBLIC_AUTH_PROVIDER=off`, `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=off`, `EXPO_NO_DOTENV=1` and
`EXPO_NO_TELEMETRY=1`. Off is explicit, not merely unset. An independent reviewer verified env precedence in the official
CLI source ([`evaluateConfigWithEnvVarsAsync.ts`](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/build/evaluateConfigWithEnvVarsAsync.ts)):
`resolveEnvVarsAsync` combines `...envVars` then `...buildProfile.env`, so checked-in profile values override a
same-named hosted variable. This is source review, not physical build proof; still check the first build.

Rules: the checked-in profiles stay OFF. Never set API/Auth origins, Google sign-in or recovery opt-ins, or any provider
or production-accounts value other than `off` in `eas.json` or an EAS environment used by these profiles. A SEPARATE,
specifically owner-approved staging configuration (staging-only secrets and origins) may be proposed and used after
staging host, identity and security approval and before the staging test gate (section 6), with the production opt-in
still OFF. This runbook grants no approval and configures nothing. Production activation still needs all production
gates plus explicit owner approval. Record the commit shown on the EAS build page, since `eas.json` cannot know it. No
auto-submit; uploads are manual.

This config alone yields no installable binary. It still needs: an Expo owner and project (`eas init` writes a project ID
to `app.json`), an iOS bundle identifier and Android package (both absent from `app.json`), and owner-held signing
credentials. Internal iOS installs also need registered devices. No build has been run; the `node` pin and CLI range are
unverified against EAS. Distribution prerequisites differ by route:
- A signed internal Android APK does NOT require Google Play Console; it needs the owner's approved signing key.
- A Google Play track (internal, closed or production) does require Play Console access.
- Apple Developer Program, TestFlight, app identity and signing are all still pending owner approval.

## 5. Current state (facts as of this runbook)

- Production profile is a client code checkpoint (`app/docs/PRODUCTION_PROFILE.md`); sign-up is off; the frontend
  production account gate is OFF. Do not enable accounts or public curriculum.
- That document's Settings notes are stale: account export and deletion UI exist as of `b009159`, but tested only
  in memory. No real service or device proof of them exists.
- Backend: it admits only its configured staging deployment. Production serving is NOT proven.
- Supabase sign-in was completed under the owner's existing organisation on the free plan. No database project is chosen
  or created. Hosted database only plus self-hosted GoTrue is a tentative preference, not a purchase or decision.
- Local tooling: `xcodebuild -checkFirstLaunchStatus` exits 69; no Android SDK or `adb`. This does NOT choose EAS
  cloud: the owner may approve a local native setup or EAS cloud, both with the current Expo/RN app, no rewrite.
- Physical iPhone and Android QA is pending: secure store, PKCE, restart, offline, large RTL text, deletion, export,
  privacy.
- All curriculum is a synthetic draft; tester mode is empty. The new 20-item bank is reviewable only and not wired to the UI.
  `docs/Unit_A_Pilot_Content_Review.md` lists risks awaiting human review and makes no efficacy claim.

## 6. Gates

A gate is met only with a recorded artifact (link, log or signed note), not a statement. These are proposed gates, not an
approved staging or production runbook, and no CD is implemented; approved procedures need a separate document.

**Staging (internal testers, `staging-tester` build)**
1. Approved SHA with `Ayangaji: checks and JS exports` passing on that exact SHA.
2. Owner approval of final bundle identifier, package name, Expo owner/project and signing custody; the build run by
   the owner or on their approval.
3. Backend provenance: the staging deployment's version/commit is known and matches the client contract.
4. SMTP and real disposable-account flows (sign-in, verification, reset), once enrolment is approved, using only the
   separately approved staging configuration from section 4.
5. Export and deletion reconcile end to end: client action, server record, and what remains afterwards.
6. Device QA from section 5 on the actual binary, on physical iPhone and Android.
7. Previous staged binary and its SHA kept and installable, for rollback.

**Controlled production (limited, owner-approved audience)**
0. Candidate verification, before the gates below are evaluated: after staging passes, the owner may SEPARATELY approve
   restricted production-candidate verification with named disposable prepared accounts, approved origins, deployment,
   signing and security custody, and no public enrolment. This runbook grants no authorization; checked-in profiles stay
   OFF; any new credentials, production resource or signing need separate approval; production sign-up stays OFF.
1. Everything above, on the exact production-profile binary (tested under step 0, not an audience release).
2. Qualified reviewers have signed off on content, plus consent, privacy, support and retention texts. The draft
   consent `draft-production-account-sync-consent-0.1` is unreviewed.
3. Backend: production serving proven; current provenance recorded; backup taken and a restore tested.
4. Domains, hosting, organisation and SMTP sender chosen by the owner; API and Auth origins meet the strict HTTPS rules in
   `PRODUCTION_PROFILE.md`.
5. Store account-deletion requirements checked (section 7); Data Safety form and web deletion link ready if required.
6. Rollback rehearsed: previous binary at the previous SHA, and `EXPO_PUBLIC_PRODUCTION_ACCOUNTS` back off.
7. Only after all recorded gates and explicit owner approval may the exact verified candidate be released to the intended
   audience. A config flag alone is not release approval. No CD or auto-submit exists; every release step is manual.

## 7. Store account-deletion rules (verify against current text)

- Apple, [App Review Guideline 5.1.1(v)](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion):
  an app that supports account creation must let users initiate deletion of the account within the app.
- Google Play, [account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111):
  an app that lets users create an account in-app must offer in-app deletion initiation and also a web link to
  request deletion, which is declared in the Data safety form.

Production sign-up is off today, but applicability is not an arbitrary owner call. Before claiming an exemption, verify
the actual in-app account creation AND any linked web account creation, against the current store policy text. This is
not legal certification, and meeting the rules is not store approval.

## 8. Owner decisions needed

1. **Identities, signing, build route:** iOS bundle identifier, Android package, Expo owner/project, who holds Apple and
   Play access and signing keys, and an approved local setup or EAS cloud.
2. **Hosting, domain, organisation, SMTP:** database organisation and host, API and Auth domains, SMTP provider and sender.
3. **Reviewers:** a qualified Arabic/curriculum reviewer, and a privacy/consent/retention and support-text reviewer.
