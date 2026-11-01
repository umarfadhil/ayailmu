# Reviewed registry at API startup

The API entrypoint uses the same `catalog.LoadDeployment` selection as the
preserved ordinary runtime. An enabled normal release requires all three
deployment inputs:

- `UMAR_REVIEWED_REGISTRY_PATH`: absolute path to the reviewed registry JSON.
- `UMAR_REVIEWED_REGISTRY_SHA256`: exact SHA-256 of that artifact's bytes.
- `UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT`: exact source identity recorded in it.

Selection is allowed only with `UMAR_NORMAL_RELEASE_READY=true` and
`UMAR_DATA_MODE=NORMAL_ONLY`. Missing selection, unreadable/malformed JSON,
checksum/source mismatch, synthetic packs or draft item metadata stop startup
before database preparation or HTTP serving. A broken explicit selection never
falls back to the embedded registry.

Legacy unready/lab startup retains its embedded default only when all selection
inputs are absent. This compatibility does not enable normal-release routes.
Enabling a normal release without an explicit reviewed registry now fails rather
than accidentally selecting that legacy default.

The artifact hash and source binding select an already reviewed deployment;
they do not perform pedagogical review, approve new items, verify a detached
signature or prove a source object exists in a remote repository. The bounded
14-item `mat-a-local-pemula-0.3` artifact and existing provenance remain unchanged.
No curriculum flags, content bytes, migration checksums, auth identity, issuer,
audience, mail policy or account/data isolation change in this repair.

Entrypoint tests invoke `run()` with invalid selections and a deliberately
unparseable database URL. They prove rejection happens before database startup,
while valid selection advances to database validation without making a database
connection or opening a listener. Tests also exercise the startup selector's
exact reviewed pack and legitimate embedded compatibility. Live restore and
account/phone acceptance remain deployment work, not claims made by these tests.
