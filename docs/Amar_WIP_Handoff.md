# Amar WIP checkpoint — 2026-10-18

This is a source checkpoint, not a completed app or a release candidate. No deployment or main-branch merge is part of this checkpoint. All bundled Arabic content remains synthetic, draft and unreviewed. Native device, screen-reader and performance verification remains outstanding; Swift iOS is not implemented.

## Related branches

- `feature/rn-ux-redesign-20261017`: latest Amar React Native design and account/sync work in `app/`.
- `feature/local-backend-20261017`: local-only Go service in `backend/`, based on Umar's existing native repository.
- `integration/native-expo-premium-20261017`: the earlier integration staging snapshot, with Umar's Android source preserved and the earlier Amar prototype under `prototype-expo/`. This snapshot does not include the newer account/sync modules from the RN branch or the Go backend. Those remain on their separate branches to avoid an unreviewed source merge.

## Remaining app work

The latest RN branch has local Auth/config, verified account identity, account-isolated KV/SQLite storage and consented raw-copy foundations, plus a standalone presentational account panel. The panel is not yet routed or connected to the running services. The durable TypeScript journal, canonicalization/hashing, generic API request path and journal persistence contain intentional stubs. Actual adult-profile creation/linking, AppContext dataset selection, upload/pull, preference conflicts, logout/isolation and a real two-browser account/sync flow still need integration.

Thirteen protocol/journal tests intentionally fail at these stubs. They are preserved acceptance contracts, not skipped or weakened. Passing guest, foundation and panel tests must not be presented as full account/sync completion. Browser QA must redact every synthetic credential and token from reports and errors before a credential-entering integration run.

## Local development boundary

The Go service uses a loopback PostgreSQL instance and a local Firebase Auth emulator with project `demo-ayailmu`. Only synthetic `.test` users are in scope. Supply local database credentials privately; none are included in this repository. No production Firebase access, account grants, cloud deployment, public listener, extra-usage purchase or actual learner data is authorized by this checkpoint.

## Continuation

Complete the existing 13 protocol/journal contracts and actual account/profile UI wiring, then run the real two-context account/sync flow and guest regression flow. Preserve original guest records and account isolation, exact immutable event payloads, frozen import retries, explicit copy/preference consent and factual progress without inferred mastery. All Claude continuation work must use the explicitly approved Straitpoint Max account with exact `claude-opus-5-5` and effort `max`. Do not resume Pro or Team. If Max is capacity-limited, pause and report it.

## Verification of this backend snapshot

Fresh `go test -count=1 -timeout=180s ./...` passes on 2026-10-18 against the existing isolated loopback test PostgreSQL and Auth emulator. The service and standalone durable Go journal are implemented locally; the RN durable journal and actual account/sync UI remain incomplete on the related branch. See [local service contract](../backend/docs/Backend_Local_Contract.md) for configuration, routes and durability boundaries. Database credentials must be supplied privately through the test environment.
