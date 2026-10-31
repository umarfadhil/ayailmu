# Reviewed content in the normal Android app

The normal `prod` variant uses the exact reviewed adult arithmetic subset instead of packaging the full draft catalog. `prepareReviewedProdAssets` copies four files from `content/src/reviewed/assets` and six required shared indexes/configuration/notices. The original `content` asset module remains available to the existing developer variants and tests. The normal approved-only loader and grading engine are unchanged; other draft or synthetic packs are excluded from the prod payload.

The derivative is `mat-a-local-pemula-0.3`: fourteen entries and one introduction screen, limited to unit 01. Its review record explicitly identifies AI arithmetic and Indonesian/English review, not a human specialist or production acceptance. The historical provenance mentions the earlier localPilot origin; that metadata is a record of the content derivation, not a new runtime mode or an active deployment declaration.

Exact bindings:

- Pack SHA-256: `7ed58f9684e68f6fef43fcd9ea3e65ff50e530663cec495f207bce20b1bcab0c`.
- Rules SHA-256: `1871e9d58f00593138026d7adb332b870b31b9cb5c03b874aae0fdfa68440ce9`.
- Selected registry SHA-256: `11753bbc33b789fec5e778044400e71fe98e46b2836216e9da6252c465a46afb`.
- Preserved content-only source snapshot: `b6e0d6123cb359436f83ce3ae0685198ee13a815`. This is an actual local Git object checked against the reviewed bytes, not the application commit or a claim that the snapshot has been published remotely.

The source review and local compile/package checks do not establish a deployed backend, real inbox delivery or a phone installation. Normal auth remains unconfigured by default. A connected build must use the actual verified HTTPS origin, matching declaration/consent versions and selected registry proof. The retained provider issuer and account identities are independent of the external address; do not insert a fictional endpoint or change identities merely to match it.

`ReviewedProdContentTest` reads the actual Android resources with the approved-only repository and compares their content proof against its test-only resource. It does not require a private environment variable. `tools/test_reviewed_assets.py` checks real debug/release asset merges and that demo retains the stock 73-pack catalog. For example, after the relevant merge tasks:

```sh
python3 tools/test_reviewed_assets.py \
  --prod-merged app/build/intermediates/assets/prodDebug/mergeProdDebugAssets \
  --baseline-merged app/build/intermediates/assets/demoDebug/mergeDemoDebugAssets
```

The optional `NativeWireIntegrationTest` reuses an explicitly supplied matching Go bridge through private pipes. Set `AYAILMU_NATIVE_WIRE_BIN`, `AYAILMU_NATIVE_WIRE_SOURCE`, `AYAILMU_NATIVE_WIRE_ASSETS` (the actual merged prod asset directory) and `AYAILMU_NATIVE_RUNTIME_WIRE=1` only for that local integration run. The bridge/runtime implementation is a separately preserved candidate, outside this client/content checkpoint. Without the bridge the optional journeys skip. These journeys execute real Kotlin requests/codecs/engine events and Go handlers, with modeled provider signatures, TLS metadata, mail and database state. They must not be reported as real provider, inbox or physical-device acceptance.

The verified checkpoint had 764 passing test executions, including nine enabled wire journeys, one intentional live-backend skip, ten merged-asset checks and zero lint errors for both prod/demo. A Gradle task-provider dependency also prevents lint from reading generated assets before their producer. Local verification reports and build artifacts are intentionally outside the repository. No live configuration, keys, private receipts or APKs belong in this source change.
