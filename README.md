# Ayailmu — Arabic Trial App

A local Expo/React Native prototype for Indonesian-speaking adults learning to understand short Arabic sentences. The UI includes a responsive menu, guided lessons, practice, feedback, settings and session summaries.

**Developer prototype only.** The bundled Arabic exercises are synthetic, unreviewed draft examples. Tester mode intentionally displays no lessons until a non-synthetic content pack is approved. The complete pilot is not implemented, and native device testing remains outstanding.

## Run locally

Requires Node.js with the built-in `node:sqlite` module for the storage tests (verified with Node 25), npm, and an Expo-compatible environment.

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
