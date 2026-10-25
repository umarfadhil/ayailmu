# Real GoTrue integration fixture (local, disposable)

Closes the six adult-backend tests that refuse to skip without a real Auth (`AYA_REAL_AUTH_FIXTURE`):
`TestLocalComposeServiceAcceptsARealGoTruePasswordSession`, `TestLocalSupabaseServiceAcceptsARealGoTruePasswordSession`,
`TestRealGoTrueSessionsStayLiveOnlyWhileAuthKeepsThem`, `TestRealGoTrueRecentSignInIsAPasswordSignInThatRefreshNeverRenews`,
`TestRealGoTrueDeletionErasesFirstThenDeletesTheUserWithTheServerCredential` and
`TestLedgerToolReplayDeletesAResurrectedIdentityAtTheRealAuth`.

    python3 -I infra/real-auth/run_real_auth_tests.py            # the six tests only
    python3 -I infra/real-auth/run_real_auth_tests.py --full     # the whole backend suite, no -run filter and no -skip
    python3 -I infra/real-auth/run_real_auth_tests.py --full --race

`--full` runs every backend test with both the real fixture and the private application database set, requires zero skipped tests
and the six real-GoTrue tests among the passes, and prints the pass/subtest counts.

`real_auth_fixture.py` is adapted from the read-only reference helper `phase4_real_auth_fixture.py` (same fixture; every
writable path now lives under one runtime root, `AYA_REAL_AUTH_RUNTIME`, default `<tmp>/aya-real-auth-<uid>`, mode 0700).
It starts one uniquely labelled (`aya.fixture=aya-core-ra-<stamp>-<rand>`) pair of containers from the **pinned, locally cached**
images (PostgreSQL 16.15 and `supabase/gotrue:v2.197.0` by digest; it never pulls and refuses if one is not cached): the
database on an internal network with no host port and a dedicated non-superuser auth owner, Auth published on
`127.0.0.1:<free port>` only. The ES256 signing key and every token are made by the maintained go-jose `jose-util`
(built offline from the go-jose v4.1.6 this module already pins); no signing or password hashing is hand-written. Docker is
driven with its own empty, auth-free `DOCKER_CONFIG` inside the runtime root and the caller's local `DOCKER_HOST`.

Secrets exist only in memory and in 0600 files under the runtime directory; they are never arguments, output or logs, and
`down` (always run by the runner) removes exactly the containers, networks and files its manifest records after checking each
carries its own label. Nothing is pruned; no other container, network, image or port is touched. The runner then asserts that
nothing labelled for the fixture is left, and exits 0 only if exactly six tests passed.

Not part of `run-tests.sh`: it needs a running Docker daemon with those two images cached.
