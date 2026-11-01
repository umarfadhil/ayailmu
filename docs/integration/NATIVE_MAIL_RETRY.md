# Normal-account mail requests

Signup, confirmation resend and password recovery now carry a stable
`X-Request-ID` for one logical mail request. Duplicate taps do not start a second
in-flight call. A retry after cancellation, timeout or response loss retains the
same ID for the same action, account, recipient, environment and payload.

The operation journal uses the existing Android Keystore/Tink vault and
origin-bound associated data in no-backup storage. It stores request identity and
outcome metadata, never passwords, OTPs, tokens or the password-equality digest.
The digest exists only in memory. Logout/account changes clear that context and
late responses cannot overwrite another account's intent.

After process recreation, recovery/resend can recover their request identity.
Signup cannot prove password equality without retaining credential-derived state,
so it offers code entry/sign-in or an explicit new request. Expired, corrupt or
backward-clock state never causes an automatic send. One clock reading defines
both admission and expiry, avoiding an invalid journal when a millisecond ticks
between reads.

An uncertain HTTP outcome is not proof of email delivery. The UI asks the user
to check their inbox before retrying and offers a deliberate new request when
the form no longer matches stored intent.

## Server contract

The matching server ingress must enforce operation-ID/body binding, replay
accounting, recipient/global limits and ambiguous-send handling. A standalone
GoTrue server may ignore this header; the client alone cannot guarantee mail
deduplication. Provider confirmation, credentials and sessions remain authoritative.
Login, OTP verification, refresh and logout do not receive unrelated mail IDs.

## Local verification

From `android`, use JDK 17 and the existing Android SDK/cache:

```sh
bash gradlew --offline :core:sync:test --tests '*GoTrueAuthTest'
bash gradlew --offline :app:testDemoDebugUnitTest --tests '*NormalMailOperationsTest'
```

The tests use synthetic accounts, fake HTTP connections and disposable encrypted
storage. Account/Compose/repository tests additionally cover cancellation,
restoration and ownership boundaries. They do not prove a real inbox, configured
public endpoint or physical-device journey. No endpoint, deployment approval,
signing configuration, curriculum or retention policy is selected by this change.
