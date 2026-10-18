# Ayailmu — Arabic Trial App

> **Amar local account/sync pilot verified (2026-10-18); production/native release remains incomplete.** See [Amar WIP handoff](docs/Amar_WIP_Handoff.md) for this branch's scope, related branches and remaining account/sync work. This source checkpoint is not a release or deployment.

A local Expo/React Native prototype for Indonesian-speaking adults learning to understand short Arabic sentences. It includes a responsive menu, guided lessons, four-choice practice with feedback, spaced reviews, timed checks, factual progress, settings and session summaries.

**Developer prototype only.** The bundled Arabic exercises are synthetic, unreviewed draft examples (see `docs/Four_Choice_Content_Review.md`). Mastery is not assessed while the four-choice "learned" rule is pending. Tester mode intentionally displays no lessons until a non-synthetic content pack is approved. Qualified content review, production services, native device testing and full learner-pilot readiness remain outstanding.

The optional local account pilot now supports synthetic sign-in, adult profiles, consented guest copy, account-isolated storage, durable sync and explicit preference-conflict handling. It passed the real local two-context browser flow; see the handoff for the loopback service setup and verification limits.

## Run locally

Requires Node.js with the built-in `node:sqlite` module for the storage tests (verified with Node 22.16.0), npm, and an Expo-compatible environment.

```bash
cd app
npm ci
npm test -- --runInBand
npm run typecheck
npm run lint
npm run web:dev
```

The web preview opens on `http://localhost:8081`. See [app/README.md](app/README.md) for modes, persistence, validation and limitations.

## Repository layout

- `app/`: application source, configuration, required placeholder app icons and tests.
- `docs/`: draft curriculum/design documents and a relative-path hash manifest.

The reference screenshot collection, original handoff archives, local session transcripts, credentials and generated QA artifacts are excluded. The app uses native components and code; it does not ship the reference screenshots.

## Draft design documents

- [Current course plan](docs/Arabic_Course_Current_Plan.md)
- [Unit A/B lesson draft](docs/Lessons_Unit_A_B_Draft.md)
- [Trial app specification](docs/Trial_App_Spec.md)

These describe intended pilot behavior. They do not mean that all pilot features have been implemented or approved.
