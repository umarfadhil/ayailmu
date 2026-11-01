# Ordinary signup and provider-managed mail

`backend-umar/cmd/general-ingress` integrates the existing ordinary ingress,
private TLS transport, OIDC verification and native wire contract into the
repository. Its default action validates configuration without opening a
listener. Public routing and private provider configuration are separate
deployment operations. There is no owner-email allowlist or service deadline.

## Mail admission and quota ownership

With `Policy.MailEnabled=true` and no accounting arguments, signup, confirmation
resend and recovery use GoTrue and its configured SMTP provider. No new HMAC key
or journal is required. Email confirmation, canonical request parsing, issuer and
audience verification, UUID/account isolation and private upstream TLS checks
remain in force.

The ingress applies configured authentication throttles, a recipient cooldown,
recipient/IP hourly windows and concurrency limits. It takes the peer from the
connection, never a client-supplied forwarded-IP header. A loopback reverse proxy
therefore shares one conservative IP bucket; this is not per-phone IP protection.
`MailGlobal` is not a transient service-lifetime send cap on this path. The SMTP
provider owns the aggregate allowance shared by applications using that account.
Actual plan, credits and queue behavior must be checked before live activation;
this source change does not establish them. Provider queueing can delay a code
past its expiry even when the sending credential is accepted.

`X-Request-ID` identifies a logical mail intent. Admission binds it to the action,
public origin, canonical email and password payload using an in-memory digest.
The cache retains at most `MaxState` operation records for 24 hours, refuses new
operations while full and evicts only expired, completed records. In-flight,
successful and uncertain attempts are not automatically dispatched again.
Changed payloads under the same ID return `409 idempotency_conflict`. No raw
email, IP, password, OTP or token is retained in this cache or logged.

The cache and hourly ingress windows deliberately reset when the process
restarts. After restart or record expiry, the same ID can reach GoTrue again.
This is bounded transient coalescing, not exactly-once mail or durable per-app
quota allocation. GoTrue's persisted recipient state and the provider's quota
remain authoritative. The native client must not blindly resend after an
ambiguous result; a later explicit user request is a new decision.

## Response contract

- Successful forwarding returns `202 confirmation_or_recovery_requested`; it
  does not prove recipient delivery or account existence.
- An explicit upstream `429` remains `429 retry_later`. Only a single canonical
  numeric `Retry-After` from 1 to 3600 seconds is propagated; absent/invalid values
  use 60 seconds. A known throttled intent may be retried with its original ID
  after the bounded delay, subject to the ordinary admission windows.
- Documented rejection codes and safe generic 400/401/403 refusals are distinct
  from a lost connection or response. Arbitrary provider bodies and diagnostics
  are not exposed.
- A transport or uncertain response remains `503 mail_outcome_unknown`. A
  repeated uncertain/in-flight ID returns `409 request_already_attempted` without
  a second dispatch while its record exists.

## Optional durable accounting

Operators that deliberately select durable accounting must provide all four
arguments: `-accounting-key`, `-ledger`, `-accounting-key-id` and
`-accounting-scope`. Partial configuration, unreadable/corrupt state, mismatched
policy or failed initialization rejects startup. It never silently falls back
to provider-managed admission. Existing separate initialization and immutable
policy checks are retained; startup does not create/reset accounting state.

## Validation and rollout boundary

Tests exercise fake HTTP transports, synthetic temporary storage, disposable OIDC
fixtures and Kotlin-to-Go private-pipe journeys. They cover classification,
bounded retry headers, concurrent duplicates, payload conflicts, cache capacity,
expiry, cancellation, clock rollback, restart behavior, durable failures and
independent account/session/learner flows. They do not prove real SMTP delivery,
current provider quota or phone acceptance. No client production change is needed
for this wire-compatible server repair.

Live activation still requires an explicit deployment of the reviewed server,
normal configured mail limits, removal of both ingress and private-front mail
holds, and a consenting recipient who enters their own password and email code.
Keep the previous binary/configuration and private-front configuration for
rollback. Restoring the mail holds stops new ingress mail requests; it cannot
recall messages already accepted or queued by the provider. This commit does not
change live configuration, accounts, keys, data, routing or APKs.
