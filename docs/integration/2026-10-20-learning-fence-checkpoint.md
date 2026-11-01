# Learning ownership checkpoint — 20 October 2026

Learning readiness could outlive the account/learner activated before a suspended consent lookup, and its ViewModel callback could navigate after a newer session took over. This checkpoint starts from `7be8ea81a691dec2fb47db139fdcf896db554e03` and preserves that publication-wait fix.

The repository now returns a tracked readiness decision containing the durable owner, learner binding and session generation. It revalidates these after the consent read under the local ordering boundary. A stale activation is cleared only when its owner/binding is no longer current; a newer session activating the same profile is retained. Profile rows and newer vault credentials are preserved.

The ViewModel revalidates the decision's identity immediately before delivering a navigable `READY` or `CONSENT_NEEDED` callback. This includes offline known-learner switches, which cannot be detected by the session counter alone. `NOT_READY` is still reported without navigation, preserving failed-activation behavior. Native consent/mastery algorithms, ordinary app flavors, backend contracts and manual upload boundaries are unchanged.

## Deterministic evidence and independent checks

Tests coordinate the consent-read boundary after local activation and hold callback delivery on Main after the actual IO readiness result returns. They await the exact repository operation or ViewModel `Job`, rather than an initial state or HTTP exit. Cases cover owner replacement, same-owner learner selection, same-owner session replacement, preservation of a newer activation of the same profile, offline known-learner replacement, and current consent/offline positive controls.

- Initial old-behavior run: **6 cases; 4 intended assertion failures; 2 controls passed; 0 errors/skips**.
- Review added two ownership regressions. On the intermediate candidate, both failed on their intended assertions; the existing failed-activation control also timed out. The final implementation preserves `NOT_READY` reporting and resolves all three failures. Compiler failures were excluded from red evidence.
- Independent final targeted run: **8/8 passed, 0 failures/errors/skips**. Test source was unchanged from the additional red run.
- `sh integration/run-e2e.sh`: **20/20 passed, 0 failures/errors/skips**, real local GoTrue/API/Mailpit.
- `sh integration/run-android-e2e.sh`: **50/50 passed, 0 failures/errors/skips**, real local services and Room/account flows. The fixture runners were sequential and removed their generated token fixture.
- `:app:assembleSyncLabDebug`: passed. The following product/test hashes were unchanged throughout independent verification:

| File | SHA-256 |
| --- | --- |
| `SyncLabRepository.kt` | `b3c67513e8ef4f2627968defb0ab57f9486f308b5f24051155617a86e4f6fe1d` |
| `SyncLabApp.kt` | `ac9491457dede6c4a5b41660595698c5d31e9ceeca86e804e1df72e30b29dd51` |
| `SyncLabAccountTest.kt` | `237a5ecc09db7058289f8d01986439f81498278c1580da9841039719152d3452` |

Kimi Code CLI 2.2.0 was the sole latest implementation/test author. All 53 native requests recorded `kimi-for-coding`, alias `kimi-code/kimi-for-coding`, effort `max`; supported model metadata and the [official mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html) identify K2.8 Preview, without exposing an immutable backend snapshot. Native manual approvals were used with no new broad approval grant. The writer ended normally and exited before Codex performed independent verification, documentation and Git transport. No implementation fallback was used.

## Remaining scope

Cancelled authentication still needs attempt-specific, cancellation-safe cleanup preserving newer credentials. Older activation/failure-handler proofs and actual current-navigation-entry ownership during auth-route transitions also remain open in the [follow-up plan](../superpowers/plans/2026-10-20-umar-account-race-followup.md). This checkpoint does not close those findings.

Go/backend source is unchanged; its prior race/Postgres results are historical, not a fresh run here. Demo/prod assemblies were not repeated for this syncLab-only change. The preceding exact-head [CI run on 7be8ea8](https://github.com/umarfadhil/ayailmu/actions/runs/39381852168) failed the same `StoryTest` method at line 549 as verified main `815e30f`: 293 tests, one failure; lint/demo assembly were not reached and ktlint was skipped. A new head requires its own CI result; no green full demo/lint claim is made here.

Real learner collection and live Google OAuth remain disabled/unconfigured release work. No production/provider credentials were created; no merge or deployment occurred. [Local launch](../../integration/README.md) · [Backend architecture/schema/API](../../backend-umar/docs/architecture.md).
