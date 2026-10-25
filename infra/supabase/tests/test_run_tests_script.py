"""run-tests.sh: the Umar application-suite step keeps its diagnostics and the suite's exit status when the suite fails.

The step is run exactly as written in run-tests.sh (the text between its begin/end markers), under `sh -eu` like the script,
against a fake scripts/integration.sh in a temporary tree. Nothing real is started.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parent.parent / "run-tests.sh"


def umar_step(text: str) -> str:
    m = re.search(r"^[ \t]*# begin: umar-suite[^\n]*\n(.*?)^[ \t]*# end: umar-suite", text, re.S | re.M)
    if not m:
        raise AssertionError("run-tests.sh lost the umar-suite markers")
    return m.group(1)


class UmarSuiteStep(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="infra-rts."))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / "repo" / "backend-umar" / "scripts").mkdir(parents=True)
        self.tmpdir = self.tmp / "tmp"
        self.tmpdir.mkdir()
        self.bystander = self.tmpdir / "infra-umar-suite.bystander"  # another run's log under the same name pattern
        self.bystander.write_text("not ours\n")

    def run_step(self, integration: str, step: str | None = None) -> subprocess.CompletedProcess:
        (self.tmp / "repo" / "backend-umar" / "scripts" / "integration.sh").write_text(integration)
        script = f'set -eu\nrepo="{self.tmp / "repo"}"\n' + (step if step is not None else umar_step(SCRIPT.read_text())) + 'echo "continued"\n'
        env = {"PATH": "/usr/bin:/bin", "TMPDIR": str(self.tmpdir)}
        return subprocess.run(["sh", "-c", script], capture_output=True, text=True, env=env, timeout=60)

    def own_logs(self):
        return sorted(p.name for p in self.tmpdir.iterdir() if p.name != self.bystander.name)

    def test_a_failing_suite_prints_its_summary_and_returns_its_own_status(self):
        r = self.run_step("echo '--- PASS: TestFine'; echo 'ok  \tpkg/a\t0.1s'; echo '--- FAIL: TestBroken (0.00s)'; echo 'FAIL\tpkg/b'; "
                          "echo 'noise that is not a summary line'; exit 7\n")
        self.assertEqual(r.returncode, 7, r.stdout + r.stderr)
        self.assertIn("--- FAIL: TestBroken", r.stdout)
        self.assertIn("FAIL\tpkg/b", r.stdout)
        self.assertIn("ok  \tpkg/a", r.stdout)
        self.assertNotIn("--- PASS", r.stdout)
        self.assertNotIn("noise", r.stdout)
        self.assertNotIn("continued", r.stdout, "set -e must stop the script after a failed suite")
        self.assertEqual(self.own_logs(), [], "the step's own temporary log is removed")
        self.assertEqual(self.bystander.read_text(), "not ours\n", "no other file is removed")

    def test_a_passing_suite_returns_zero_and_cleans_up(self):
        r = self.run_step("echo 'ok  \tpkg/a\t0.1s'; exit 0\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("continued", r.stdout)
        self.assertEqual(self.own_logs(), [])
        self.assertTrue(self.bystander.exists())

    def test_the_status_of_a_suite_that_prints_nothing_is_still_returned(self):
        r = self.run_step("exit 3\n")
        self.assertEqual(r.returncode, 3)
        self.assertEqual(self.own_logs(), [])

    def test_the_pre_fix_step_loses_the_summary_and_leaves_its_log(self):
        """Documents the defect this guards against: the old one-liner under set -e."""
        old = ('(cd "$repo/backend-umar" && GO=${GO:-go} sh scripts/integration.sh >$TMPDIR/infra-umar-suite.$$.log 2>&1; rc=$?; '
               "grep -E '^(ok|FAIL|---)' $TMPDIR/infra-umar-suite.$$.log | grep -v '^--- PASS' || true; rm -f $TMPDIR/infra-umar-suite.$$.log; exit $rc)\n")
        r = self.run_step("echo '--- FAIL: TestBroken (0.00s)'; exit 7\n", step=old)
        self.assertEqual(r.returncode, 7)
        self.assertNotIn("TestBroken", r.stdout, "the old step never reached its diagnostics")
        self.assertEqual(len(self.own_logs()), 1, "the old step left its log behind")


if __name__ == "__main__":
    unittest.main(verbosity=2)
