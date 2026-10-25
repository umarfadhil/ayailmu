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
`down` (always run by the runner, including after a failure or an interrupt) removes exactly the containers, networks and files its manifest records after checking each
carries its own label. Nothing is pruned; no other container, network, image or port is touched. The runner then asserts that
nothing labelled for the fixture is left, and exits 0 only if exactly six tests passed.

Cleanup guarantees. Everything after the fixture is up runs under one `try/finally`: a failure to start or prepare the
application's own PostgreSQL, a failing `go test`, and SIGINT/SIGTERM all end in the same cleanup (the shared `pgtest.Cluster`
installs handlers that call `os._exit`; the runner replaces them while the fixture is live and exits 128+signal afterwards). A
signal that arrives while the fixture is still being built is acted on once it is up; a second one during cleanup does not abort it.
A non-zero `down` status, labelled leftovers, or a failing cleanup step makes the run fail. SIGKILL cannot be handled; recover
that case with `python3 -I infra/real-auth/real_auth_fixture.py down <runtime directory>`. If `down` cannot remove everything
(Docker unreachable or a removal failing) it exits non-zero and **keeps the manifest** (identifiers only) so that running it again
finishes the job; the secret files are removed either way and never printed.

Regressions (fake helper and cluster, mocked Docker; nothing real is started):
`python3 -I -B infra/real-auth/test_run_real_auth_tests.py` and `python3 -I -B infra/real-auth/test_real_auth_fixture_down.py`
(both run by `infra/supabase/run-tests.sh`).

Not part of `run-tests.sh`: it needs a running Docker daemon with those two images cached.
