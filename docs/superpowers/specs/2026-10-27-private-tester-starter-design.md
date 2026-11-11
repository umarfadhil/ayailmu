# Private tester starter design

Build the existing two-lesson/20-question Unit A loop into a bounded private tester entry. Pending human review stays pending; nothing becomes approved by a build flag. Keep four choices, source IDs, reserved transfer/delayed questions and conservative evidence rules. The first target is a private iPhone beta, not a public launch.

Use a version/hash-bound compiled review manifest and validated connected staging-beta configuration. Default manifests remain pending. An unavailable endpoint or unset permanent app identity must fail closed, never select localhost, production credentials or a fabricated signing identity.

Use the existing account dataset and backend answer-envelope contract. Persist real pilot answers as recognition answer records, idempotently and with truthful provenance, so the existing journal can upload them. Keep the resumable pilot controller document account-local and clearly distinguish uploaded answers from restored scheduling/mastery. The existing backend supports answers only; arbitrary document snapshots or fabricated answer events are rejected alternatives. A new backend schema is out of this slice.

Guest datasets remain separate. A logout/new account cannot write a former owner's progress. Interrupted answer capture must retry deterministically, with no duplicate events, no fake answers and no lost locally committed pilot progress.

Manual native recovery is owner-deferred. No further mail, auth account mutation, Apple access/provisioning, external hosting, upload, invitation or publication. Human approval of content and the permanent signing/app identity remain separate decisions.
