# AyaFasih normal-email registration implementation plan

> **For agentic workers:** Use the approved Claude Code Opus 5.5 HIGH authoring route. Codex coordinates, executes checks and verifies each small task. Preserve the frozen-test procedure.

**Goal:** Implement normal-email signup, required confirmation and resend in the actual account flow, without weakening the existing synthetic test profiles.

**Architecture:** Extend the existing registration adapter/controller/lifecycle/panel rather than create another auth stack. A separate `confirmed-email` capability is accepted only with the already validated production profile and distinct HTTPS API/Auth roots; existing `on` builds stay synthetic-only. Confirmation sessions remain ephemeral and require subsequent normal password sign-in.

**Tech stack:** Expo 58, React Native 0.88, TypeScript, maintained `@supabase/auth-js` 2.118.0, existing GoTrue root-endpoint contract.

**Spec:** The owner's normal-user acceptance path: signup and real inbox confirmation, login, exercises/progress save, restart, logout/login, account isolation, usable mobile beta. The detailed execution dependencies are recorded in the task's `phase101-real-registration-20261026/COMPLETE-PATH-BACKLOG.md`.

## Global constraints

- Use the approved existing Claude subscription, Opus 5.5 HIGH, fast mode off, no paid extra usage or substitute authoring model. This slice used Team throughout; the owner later allowed weekday Max, with no switch needed.
- Preserve all 157 existing protected test/helper files and newly frozen regressions.
- Preserve account/progress keys, bundle identifiers, auth redirects, consent and refresh-before-sync boundaries.
- Do not activate real-email enrollment, configure SMTP/credentials, change live resources, publish a new public payload, merge or deploy without the applicable approval.
- Mocked SDK tests prove source behavior only; Mailpit is not real inbox delivery, Mac native transport is not an iPhone launch, JS exports are not signed APK/IPA builds.

## Review focus

1. Missing/forged capability, unsafe or same API/Auth origin, unknown policy: reject before any client or request.
2. Profile or flag changes and mutable caller config: no stale owner may enable a flow or redirect an in-flight operation.
3. Invalid conventional addresses and wrong/expired codes: stable learner-facing errors, no token/password/provider-text exposure.
4. Background, cancel, back navigation, owner replacement and repeat submits: preserve existing fences and dispose all stale sessions.
5. Accepted signup/resend response: never claim actual delivery or authenticated account adoption; live inbox and phone acceptance remain separately verified.

## Task 1: Adapter capability and confirmation semantics

**Files:** `app/src/auth/registration.ts`, its new production regression files, and the error-message map in `app/src/ui/account/registrationController.ts`.

**Interface:** optional `RegistrationOptions.emailPolicy: 'synthetic' | 'confirmed-email'`. Undefined preserves the current behavior; unknown values fail closed. The public policy requires enabled `local-supabase`, `environment: 'production'`, `productionAccounts: true` and validated distinct HTTPS roots. Output shapes remain unchanged.

- [x] Write and execute the first regression: current constructor refuses explicitly opted-in production registration. Freeze its hash after confirming a behavioral failure.
- [x] Add and freeze boundary regressions: valid local/staging public-policy refusal, unsafe production config, invalid addresses, auto-confirm refusal, confirmation-session retirement and resend acceptance.
- [x] Implement the adapter capability and conventional-email validation matching production password sign-in; retain bounded transport/body/SDK/cleanup and no automatic login.
- [x] Run the new tests plus existing registration suites, full typecheck and guarded-file hashes.

## Task 2: Real controller and lifecycle integration

**Files:** `app/src/ui/account/registrationController.ts`, `app/src/ui/useAccountRegistration.ts` and new controller/hook integration tests.

**Interface:** the existing build flag `EXPO_PUBLIC_ACCOUNT_REGISTRATION=on` remains local/staging only; the exact value `confirmed-email` enables the new policy only for a valid production profile. Pass the selected immutable policy through adapter, controller and panel model.

- [x] Add failing tests for production opt-in, normal-email register/use-code, default-off and stale-owner/background/cancel fences.
- [x] Wire the production policy through the existing controller and hook. Do not introduce a separate sign-in or session-adoption path.
- [x] Verify the new tests and all existing lifecycle/AccountContext/route assertions.

## Task 3: Learner-facing normal signup UI

**Files:** `app/src/ui/account/RegistrationPanel.tsx`, `app/src/ui/account/AccountPanel.tsx` and new panel/integration tests.

- [x] Write failing tests for a normal email label, concise confirmation/resend instructions and no test-inbox claim in the production policy.
- [x] Render normal signup copy for the explicit production policy; preserve truthful `.test`/private-inbox copy in test builds.
- [x] Test confirmation, resend, expired/wrong code, repeat action, back/re-entry and ordinary password sign-in after confirmation.

## Task 4: Verification and publication checkpoint

- [ ] Run full Jest, TypeScript, lint and web/iOS/Android JavaScript exports; verify every protected hash and review the exact diff independently.
- [ ] Commit only coherent passing local work and report its exact public payload for approval. Do not change the current public source/preview automatically.
- [ ] With the infrastructure owner's approved real-mail configuration and origins, prove real confirmation delivery and the actual phone journey. Keep blocked/failed/not-run results explicit.
- [ ] Build and verify installable native beta artifacts using supported approved tooling/signing; source tests or exports alone cannot satisfy this acceptance.
