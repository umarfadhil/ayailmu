"""Cleanup guarantees of run_real_auth_tests.main(), with a fake helper, fake clusters and a fake `go test`. No Docker, no
PostgreSQL, no network: nothing real is started, so a regression cannot leave anything behind.

    python3 -I -B infra/real-auth/test_run_real_auth_tests.py

The signal cases run the runner in a child process, because they deliver real SIGINT/SIGTERM to it and the shared
pgtest.Cluster installs handlers that call os._exit.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "supabase" / "tests"))  # -I drops the script directory
sys.path.insert(0, str(HERE))
import run_real_auth_tests as rat  # noqa: E402

SECRET = "synthetic-secret-0123456789abcdef"  # stands in for the ephemeral cluster password; must never be printed
REAL_TESTS = ("TestLocalComposeServiceAcceptsARealGoTruePasswordSession", "TestLocalSupabaseServiceAcceptsARealGoTruePasswordSession",
              "TestRealGoTrueSessionsStayLiveOnlyWhileAuthKeepsThem", "TestRealGoTrueRecentSignInIsAPasswordSignInThatRefreshNeverRenews",
              "TestRealGoTrueDeletionErasesFirstThenDeletesTheUserWithTheServerCredential",
              "TestLedgerToolReplayDeletesAResurrectedIdentityAtTheRealAuth")
GO_PASS = "\n".join(f"--- PASS: {name} (0.01s)" for name in REAL_TESTS) + "\nok  \tayailmu.local/backend\t0.1s\n"
FACTS = {"label": "aya-core-ra-synthetic", "state": "running", "runtime_directory": "/synthetic/runtime",
         "fixture_env": "/synthetic/runtime/fixture.env", "auth_base_url": "http://127.0.0.1:1", "containers": ["c"], "networks": ["n"]}
DOWN_OK = {"label": FACTS["label"], "cleanup": {"containers": [], "networks": []}, "runtime_directory_removed": True, "leftover_files": []}


def done(stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


class FakeHelper:
    """Stands in for `real_auth_fixture.py`: records every operation and answers `up` and `down` as configured."""

    def __init__(self, up=None, down=None, down_raises=None):
        self.ops: list[str] = []
        self.up_result = up or done(json.dumps(FACTS))
        self.down_result = down or done(json.dumps(DOWN_OK))
        self.down_raises = down_raises

    def __call__(self, *args):
        self.ops.append(args[0])
        if args[0] == "up":
            return self.up_result
        if args[0] == "down":
            if self.down_raises:
                raise self.down_raises
            return self.down_result
        raise AssertionError(f"unexpected helper operation {args[0]}")


class FakeCluster:
    instances: list["FakeCluster"] = []
    start_error: Exception | None = None
    port = 5999

    def __init__(self):
        self.started = self.stopped = 0
        self.statements: list[str] = []
        FakeCluster.instances.append(self)

    def start(self):
        self.started += 1
        if FakeCluster.start_error:
            raise FakeCluster.start_error
        return self

    def stop(self):
        self.stopped += 1

    def new_password(self):
        return SECRET

    def psql(self, sql, **_):
        self.statements.append(sql)

    def create_database(self, name):
        self.statements.append(name)


class RunnerCleanup(unittest.TestCase):
    def run_main(self, helper, *, go=None, left=(), cluster=FakeCluster, argv=()):
        FakeCluster.instances, FakeCluster.start_error = [], None
        out, err = io.StringIO(), io.StringIO()
        go = go or (lambda *a, **k: done(GO_PASS))
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(rat, "helper", helper))
            stack.enter_context(mock.patch.object(rat, "leftovers", left if callable(left) else lambda label: list(left)))
            stack.enter_context(mock.patch.object(rat, "Cluster", cluster))
            stack.enter_context(mock.patch.object(rat.subprocess, "run", go))
            stack.enter_context(mock.patch.object(rat.fx, "JOSE_UTIL", HERE / "real_auth_fixture.py"))  # any existing file
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(contextlib.redirect_stderr(err))
            code = rat.main(list(argv))
        return code, out.getvalue() + err.getvalue()

    def assertNoSecret(self, text):
        self.assertNotIn(SECRET, text)

    # -- the reproduced defect: application PostgreSQL fails to start after the identity fixture is up ---------------------
    def test_cluster_start_failure_still_takes_the_identity_fixture_down(self):
        for error in (RuntimeError("openssl failed"), OSError("PG_BIN missing"), subprocess.CalledProcessError(1, ["initdb"])):
            with self.subTest(error=type(error).__name__):
                helper = FakeHelper()

                class Failing(FakeCluster):
                    def start(self):
                        raise error

                code, out = self.run_main(helper, cluster=Failing)
                self.assertEqual(code, 1)
                self.assertEqual(helper.ops, ["up", "down"], "the live fixture must be taken down")
                self.assertIn("fixture cleanup:", out)

    def test_cluster_construction_failure_still_takes_the_identity_fixture_down(self):
        helper = FakeHelper()

        def broken():
            raise OSError("no space for the cluster directory")

        code, _ = self.run_main(helper, cluster=broken)
        self.assertEqual((code, helper.ops), (1, ["up", "down"]))

    def test_a_failure_while_preparing_the_application_database_cleans_up_and_hides_the_password(self):
        helper = FakeHelper()

        class Leaky(FakeCluster):
            def psql(self, sql, **_):
                raise RuntimeError(f"psql failed: LINE 1: ... PASSWORD '{SECRET}'")

        code, out = self.run_main(helper, cluster=Leaky)
        self.assertEqual((code, helper.ops), (1, ["up", "down"]))
        self.assertEqual(FakeCluster.instances[-1].stopped, 1, "the application cluster is stopped too")
        self.assertNoSecret(out)

    def test_a_cluster_that_failed_to_start_is_still_stopped(self):
        class Failing(FakeCluster):
            def start(self):
                super().start()
                raise RuntimeError("pg_ctl failed")

        helper = FakeHelper()
        code, _ = self.run_main(helper, cluster=Failing)
        self.assertEqual(code, 1)
        self.assertEqual((FakeCluster.instances[-1].started, FakeCluster.instances[-1].stopped), (1, 1))

    # -- success and ordinary failures -------------------------------------------------------------------------------------
    def test_normal_success_cleans_up_once_in_order_and_exits_zero(self):
        helper = FakeHelper()
        code, out = self.run_main(helper)
        self.assertEqual(code, 0, out)
        self.assertEqual(helper.ops, ["up", "down"])
        (cluster,) = FakeCluster.instances
        self.assertEqual((cluster.started, cluster.stopped), (1, 1))
        self.assertIn("real-GoTrue tests: passed=6", out)
        self.assertIn('"docker_leftovers": []', out)
        self.assertNoSecret(out)

    def test_nonzero_cleanup_status_forces_failure_even_when_every_test_passed(self):
        helper = FakeHelper(down=done(json.dumps(dict(DOWN_OK, leftover_files=["manifest.json"], runtime_directory_removed=False)), 1))
        code, out = self.run_main(helper)
        self.assertEqual(code, 1)
        self.assertIn("real-GoTrue tests: passed=6", out)
        self.assertIn('"exit": 1', out)

    def test_unparseable_cleanup_output_with_nonzero_status_fails_without_a_traceback(self):
        code, out = self.run_main(FakeHelper(down=done("not json", 1, "docker is gone")))
        self.assertEqual(code, 1)
        self.assertIn("fixture cleanup:", out)

    def test_labelled_leftovers_force_failure(self):
        code, out = self.run_main(FakeHelper(), left=["ps:aya-core-ra-synthetic-db"])
        self.assertEqual(code, 1)
        self.assertIn("ps:aya-core-ra-synthetic-db", out)

    def test_a_cleanup_helper_that_raises_still_stops_the_cluster_and_fails(self):
        helper = FakeHelper(down_raises=OSError("cannot start python"))
        code, _ = self.run_main(helper)
        self.assertEqual(code, 1)
        self.assertEqual(FakeCluster.instances[-1].stopped, 1)

    def test_a_failing_leftover_check_fails_the_run(self):
        def boom(label):
            raise OSError("docker unavailable")

        helper = FakeHelper()
        code, _ = self.run_main(helper, left=boom)
        self.assertEqual((code, helper.ops), (1, ["up", "down"]))

    def test_a_failing_go_test_run_fails_after_cleanup(self):
        helper = FakeHelper()
        failing = "--- FAIL: TestSomething (0.01s)\nFAIL\n"
        code, out = self.run_main(helper, go=lambda *a, **k: done(failing, 1))
        self.assertEqual((code, helper.ops), (1, ["up", "down"]))
        self.assertIn("--- FAIL: TestSomething", out)

    def test_a_skipped_test_fails_the_full_run_and_fewer_than_six_real_tests_fail_any_run(self):
        skipped = GO_PASS + "    --- SKIP: TestNeedsSomething (0.00s)\n"
        code, _ = self.run_main(FakeHelper(), go=lambda *a, **k: done(skipped), argv=["--full"])
        self.assertEqual(code, 1)
        code, _ = self.run_main(FakeHelper(), go=lambda *a, **k: done("\n".join(GO_PASS.splitlines()[:5])))
        self.assertEqual(code, 1)

    def test_the_password_is_redacted_from_go_output(self):
        leaky = GO_PASS + f"--- FAIL: TestLeaky\n    dsn postgres://u:{SECRET}@127.0.0.1/x\n"
        code, out = self.run_main(FakeHelper(), go=lambda *a, **k: done(leaky, 1))
        self.assertEqual(code, 1)
        self.assertNoSecret(out)

    def test_a_fixture_that_did_not_start_is_not_taken_down_again_and_fails(self):
        failed = dict(FACTS, state="failed; its resources and secret files were removed", failure="x", cleanup={})
        helper = FakeHelper(up=done(json.dumps(failed), 1))
        code, _ = self.run_main(helper)
        self.assertEqual((code, helper.ops), (1, ["up"]))
        self.assertEqual(FakeCluster.instances, [])


# -- real signals, in a child process -----------------------------------------------------------------------------------------
HARNESS = textwrap.dedent('''
    import json, os, signal, subprocess, sys, time
    sys.dont_write_bytecode = True
    here, record, where = sys.argv[1:4]
    sys.path.insert(0, os.path.join(here, "..", "supabase", "tests")); sys.path.insert(0, here)
    import pgtest
    import run_real_auth_tests as rat

    def log(entry):
        with open(record, "a") as fh:
            fh.write(entry + "\\n")

    FACTS = json.loads(sys.argv[4])

    def helper(*args):
        log(args[0])
        if args[0] == "up":
            if where == "during-up":
                os.kill(os.getpid(), signal.SIGTERM)  # the fixture is still being built: acted on once it is up
                time.sleep(0.05)
            return subprocess.CompletedProcess([], 0, json.dumps(FACTS), "")
        if where == "during-cleanup":
            os.kill(os.getpid(), signal.SIGTERM)  # a second request while cleaning up must not abort the cleanup
            time.sleep(0.05)
        log("down-finished")
        return subprocess.CompletedProcess([], 0, json.dumps({"cleanup": {}, "runtime_directory_removed": True, "leftover_files": []}), "")

    class Cluster(pgtest.Cluster):  # the REAL class: its constructor installs the handlers that call os._exit
        def start(self):
            log("cluster-root " + str(self.root))
            if where == "start-interrupted":
                os.kill(os.getpid(), signal.SIGINT if len(sys.argv) > 5 else signal.SIGTERM)
                time.sleep(5)
            self.started = False
            return self
        def psql(self, *a, **k):
            if where == "psql-interrupted":
                os.kill(os.getpid(), signal.SIGTERM); time.sleep(5)
        def create_database(self, name):
            pass

    def go(*a, **k):
        if where == "go-interrupted":
            os.kill(os.getpid(), signal.SIGTERM); time.sleep(5)
        log("go-finished")
        return subprocess.CompletedProcess([], 0, "", "")

    rat.helper, rat.Cluster, rat.leftovers = helper, Cluster, lambda label: []
    rat.subprocess.run = go
    rat.fx.JOSE_UTIL = __import__("pathlib").Path(here) / "real_auth_fixture.py"
    sys.exit(rat.main([]))
''')


class LeftoverList(unittest.TestCase):
    """leftovers() against a mocked `docker`: an empty list is only ever the daemon's own successful answer."""

    def leftovers(self, answers):
        calls = []

        def docker(*args, **_):
            calls.append(args)
            return answers(args)

        with mock.patch.object(rat.fx, "docker", docker):
            return rat.leftovers("aya-core-ra-synthetic"), calls

    def test_a_successful_empty_answer_is_the_only_way_to_report_nothing_left(self):
        left, calls = self.leftovers(lambda args: done(""))
        self.assertEqual((left, [c[:2] for c in calls]), ([], [("ps", "-a"), ("network", "ls")]))

    def test_listed_names_are_reported_by_kind(self):
        left, _ = self.leftovers(lambda args: done("one\ntwo\n" if args[0] == "ps" else "net\n"))
        self.assertEqual(left, ["ps:one", "ps:two", "network:net"])

    def test_an_ordinary_nonzero_answer_is_an_error_not_an_empty_list(self):
        for failing in ("ps", "network"):
            for message in ("Cannot connect to the Docker daemon DAEMON-STDERR", "permission denied DAEMON-STDERR", ""):
                with self.subTest(failing=failing, stderr=message[:20]):
                    with self.assertRaises(RuntimeError) as caught:
                        self.leftovers(lambda args: done("", 1, message) if args[0] == failing else done(""))
                    self.assertNotIn("DAEMON-STDERR", str(caught.exception))

    def test_a_nonzero_leftover_check_fails_the_run_and_keeps_the_recovery_command_visible(self):
        helper = FakeHelper()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(rat.fx, "docker", lambda *a, **k: done("", 1, "DAEMON-STDERR")))
            stack.enter_context(mock.patch.object(rat, "helper", helper))
            stack.enter_context(mock.patch.object(rat, "Cluster", FakeCluster))
            stack.enter_context(mock.patch.object(rat.subprocess, "run", lambda *a, **k: done(GO_PASS)))
            stack.enter_context(mock.patch.object(rat.fx, "JOSE_UTIL", HERE / "real_auth_fixture.py"))
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(contextlib.redirect_stderr(err))
            FakeCluster.instances, FakeCluster.start_error = [], None
            code = rat.main([])
        text = out.getvalue() + err.getvalue()
        self.assertEqual(code, 1, text)
        self.assertIn("real_auth_fixture.py down /synthetic/runtime", text)
        self.assertNotIn("DAEMON-STDERR", text)
        self.assertNotIn('"docker_leftovers": []', text)


class RunnerSignals(unittest.TestCase):
    def run_child(self, where, *extra):
        tmp = tempfile.TemporaryDirectory(prefix="infra-rat-")
        self.addCleanup(tmp.cleanup)
        record = Path(tmp.name) / "record"
        script = Path(tmp.name) / "harness.py"
        script.write_text(HARNESS)
        proc = subprocess.run([sys.executable, "-I", "-B", str(script), str(HERE), str(record), where, json.dumps(FACTS), *extra],
                              capture_output=True, text=True, timeout=60)
        lines = record.read_text().splitlines() if record.exists() else []
        roots = [Path(line.split(" ", 1)[1]) for line in lines if line.startswith("cluster-root ")]
        return proc, [line for line in lines if not line.startswith("cluster-root ")], roots

    def assertCleanedUp(self, proc, ops, roots, code):
        self.assertEqual(proc.returncode, code, proc.stdout + proc.stderr)
        self.assertEqual(ops[0], "up")
        self.assertIn("down", ops, "the identity fixture was not taken down")
        self.assertEqual(ops[-1], "down-finished", "the cleanup did not run to completion")
        for root in roots:
            self.assertFalse(root.exists(), "the application cluster directory was left behind")
        self.assertNotIn("Traceback", proc.stderr)

    def test_sigterm_while_the_application_cluster_starts_runs_the_identity_cleanup(self):
        proc, ops, roots = self.run_child("start-interrupted")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGTERM)

    def test_sigint_while_the_application_cluster_starts_runs_the_identity_cleanup(self):
        proc, ops, roots = self.run_child("start-interrupted", "sigint")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGINT)

    def test_sigterm_while_preparing_the_application_database_runs_the_identity_cleanup(self):
        proc, ops, roots = self.run_child("psql-interrupted")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGTERM)

    def test_sigterm_during_go_test_stops_it_and_runs_the_identity_cleanup(self):
        proc, ops, roots = self.run_child("go-interrupted")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGTERM)
        self.assertNotIn("go-finished", ops)

    def test_sigterm_while_the_fixture_is_still_being_built_cleans_up_once_it_is_up(self):
        proc, ops, roots = self.run_child("during-up")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGTERM)
        self.assertEqual((ops, roots), (["up", "down", "down-finished"], []), "no application cluster or test run may start")

    def test_a_second_signal_during_cleanup_does_not_abort_it(self):
        proc, ops, roots = self.run_child("during-cleanup")
        self.assertCleanedUp(proc, ops, roots, 128 + signal.SIGTERM)

    def test_an_uninterrupted_run_in_the_same_harness_cleans_up_in_order(self):
        proc, ops, roots = self.run_child("none")
        self.assertEqual(proc.returncode, 1, proc.stderr)  # the fake go test passed no real test: the run must not pass
        self.assertEqual(ops, ["up", "go-finished", "down", "down-finished"])
        self.assertCleanedUp(proc, ops, roots, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
