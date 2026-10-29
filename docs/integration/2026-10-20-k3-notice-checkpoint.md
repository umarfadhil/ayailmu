# K3 notice checkpoint — 20 October 2026

This is a partial repair in an explicitly incomplete synthetic-only draft. Code
and tests in this checkpoint were authored by Kimi Code CLI 2.2.0 using verified
provider model `k3`, alias `kimi-code/k3`, thinking effort `max`. Codex performed
read-only review, independent checks, this evidence documentation and Git
transport. No fallback or second source writer was used.

## Concrete change and proof

An older account's learner request can fail after a newer account finishes
signing in. `finishLogin` now checks that the originating account and attempt
remain current before publishing that failure notice.

The new `staleSignInLearnerFailureDoesNotPublishOverNewerAccount` regression parks
A's request, completes B's sign-in, then returns a 503 for A. It awaits the exact
old sign-in job before asserting that B's success notice, authenticated owner and
vault token survive. The pre-fix run compiled and failed on that notice assertion;
the same test passed after the small repository change. The existing current
account learner-failure test remains in the focused suite.

**This does not close every stale-notice schedule.** Review found a remaining
gap if the attempt changes after the new check while publication waits for
`publishLock`. Publication currently captures its own owner and does not carry
the originating acceptance condition to the final state mutation. The repository
comment about rechecking across publication waits must be understood with this
limitation. A follow-up K3 call produced no further edit and was stopped under the
bounded capacity guard. The first regression and patch were preserved.

## Invocation diagnosis

The earlier 12-request attempt made no write attempt and logged no permission
denial or output clipping. It used an unsupported ripgrep `kt` type once and read
roughly 134 KB of whole-file source. The fresh retry used a 22,460-character
verbatim excerpt bundle, bounded lookups and one defect. Kimi's own harmless
write probe verified writable source/test directories, removed its probes and
left source bytes unchanged; JDK 17, SDK and ripgrep were available. Actual
requests verified K3/max throughout, with no compaction. Long model deliberation
was observed, but the evidence does not establish a model defect or a write
permission failure. No safeguard or credential configuration was weakened.

## Verification

- Red/green regression: intended notice assertion failed before the patch and
  passed afterward.
- Focused account/Room suite: 41 discovered, 39 executed, two fixture-gated skips,
  no failures. The service-backed run below replaces those skips.
- `assembleDemoDebug`, `assembleProdDebug`, `assembleSyncLabDebug`: passed on the
  frozen product/test source.
- `sh integration/run-e2e.sh`: 20/20 passed, zero failures/errors/skips, using
  actual local GoTrue/API/Mailpit services.
- `sh integration/run-android-e2e.sh`: 41/41 passed, zero
  failures/errors/skips, using actual local services and Room/account flows.

The service-backed runners execute sequentially under their fixture lock and
delete their generated token fixture on exit. Private logs are retained locally;
tokens and raw CLI transcripts are not repository deliverables. The backend Go
source is unchanged by this checkpoint; the previous checkpoint's Go verification
is historical evidence, not a fresh run here.

The predecessor PR head's full Android gate failed the unchanged StoryTest gallery
state assertion, also present on main `815e30f`. Four unchanged backup/export lint
errors are recorded in the previous WIP evidence. These focused results do not
claim a green unfiltered demo/lint/ktlint gate; inspect the latest PR CI separately.

## Remaining work and launch

All three Important findings in the [previous WIP checkpoint](2026-10-19-wip-checkpoint.md)
remain open: learning readiness/navigation fencing, cancellation-safe cleanup of
an authenticated but unpersisted attempt, and deterministic completion waits in
older race regressions. The publication-wait gap above and the route-transition
limitations also remain open. Passing suites do not close these schedules.

Google OAuth is disabled and unconfigured; credential/configuration/grant
approval is pending. No live Google verification or new credential was attempted.
Real learner collection remains unsupported. No merge or deployment occurred.

Use the [isolated local launch instructions](../../integration/README.md) and
[backend architecture/schema/API](../../backend-umar/docs/architecture.md).
Branch: `feature/umar-native-integration-20261019`; existing draft PR: #3.
