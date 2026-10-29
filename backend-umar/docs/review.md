# Read-only Codex review and fixes

A separate read-only reviewer used Codex GPT-6.1-sol at xhigh on implementation
commit `26abd97179cefc7e6163bbfe6810280bda207595`. The implementer remained the
only writer; no Claude implementation or review was used in this task.

The reviewer independently compared all 73 registry entries and hashes to pinned
Git source and found no mismatch. It found no additional important issue in owner
isolation, atomic batches, withdrawal ordering, learner cursors or JWT claims.
This is a focused prototype review, not a production security audit.

## Finding 1: case-insensitive JSON aliases (important, fixed)

Go's JSON decoder recognized uppercase aliases for struct fields while Kotlin uses
canonical names. A payload could retain `synthetic:false` and override validation
with `SYNTHETIC:true`. Similar aliases could mismatch learner binding or hide a
child typed response. This applied to envelopes, events and inner raw responses.

The implementer reproduced five aliases and the child typed-response bypass as
failing tests. `native.Decode` now validates exact property names recursively before
using the standard decoder. Duplicate-key rejection is retained; map keys preserve
their own semantics. Regression tests cover the native event, nested pairing,
response, child response, and HTTP envelope. All pass with the full race suite.

## Finding 2: explicit nulls in nonnullable native fields (fixed)

The reviewer rated this minor. The implementer treated it as important for eventual
Kotlin history round trips: accepted records such as `hint_used:null` could not be
deserialized by the source client. Four null cases failed before the fix.

The same typed JSON check now rejects nulls for nonnullable fields and list/map
values. Genuinely nullable Kotlin response fields remain accepted, covered by a
positive fixture. Optional omitted defaults remain supported.

Fix commit: `cb888fd` (`fix: enforce exact native JSON field names and nullability`).
No unresolved review finding is deferred. No second review was used; the fixes were
verified by failing-then-passing regression tests and complete integration suites.
