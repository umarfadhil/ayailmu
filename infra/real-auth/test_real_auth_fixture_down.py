"""`real_auth_fixture.py down` against a mocked Docker: an incomplete removal keeps what a later `down` needs. No Docker is
started or contacted and no existing resource is touched; the fixture's runtime root is a fresh directory under /tmp.

    python3 -I -B infra/real-auth/test_real_auth_fixture_down.py
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
import real_auth_fixture as fx  # noqa: E402

ADMIN_SECRET = "synthetic-admin-credential-0001"
OWNER_SECRET = "synthetic-owner-password-0002"


def done(stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


class FakeDocker:
    """Containers and networks by reference -> label. `refuse` lists references whose removal fails (until cleared).
    `errors` makes the named verbs ("inspect", "ls", "rm", or "*" for all) return a non-zero status with `stderr`, the way a
    daemon, socket, permission or API error does; `stderr` never reaches the output under test."""

    def __init__(self):
        self.resources: dict[tuple[str, str], str] = {}
        self.refuse: set[str] = set()
        self.raises: Exception | None = None
        self.errors: set[str] = set()
        self.stderr = ""
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, *args, input=None, timeout=60):
        self.calls.append(args)
        if self.raises:
            raise self.raises
        kind, verb = args[0], args[1]
        ref = args[-1]
        if self.errors & {verb, "*"}:
            return done("", 1, self.stderr)
        if verb == "ls":  # the whole list, as `docker container ls -a --no-trunc --format '{{.ID}}\t{{.Names}}'` prints it
            return done("".join(f"{r}\t{r.removeprefix('id-')}\n" for (k, r) in self.resources if k == kind))
        if verb == "inspect":
            label = self.resources.get((kind, ref))
            return done(label + "\n") if label is not None else done("", 1, "Error: No such object: " + ref)
        if verb == "rm":
            if ref in self.refuse:
                return done("", 1)
            self.resources.pop((kind, ref), None)
            return done(ref)
        raise AssertionError(f"unexpected docker call {args}")


class DownRetry(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="infra-rafd."))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.docker = FakeDocker()
        patches = [mock.patch.object(fx, "RUNTIME", self.root / "runtime"), mock.patch.object(fx, "EVIDENCE", self.root / "runtime" / "evidence"),
                   mock.patch.object(fx, "docker", self.docker)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.fixture = fx.Fixture.new()
        self.label = self.fixture.label
        for name in (self.label + "-db", self.label + "-auth"):
            self.fixture.manifest["containers"].append({"name": name, "id": "id-" + name})
            self.docker.resources[("container", "id-" + name)] = self.label
        for name in (self.label + "-int", self.label + "-pub"):
            self.fixture.manifest["networks"].append({"name": name, "id": "id-" + name, "internal": name.endswith("int")})
            self.docker.resources[("network", "id-" + name)] = self.label
        self.fixture.write("admin-key", ADMIN_SECRET)
        self.fixture.write("auth.env", "DATABASE_URL=" + OWNER_SECRET)
        self.fixture.record()
        self.private = self.fixture.private

    def down(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = fx.down(argparse.Namespace(runtime_directory=str(self.private)))
        return code, out.getvalue()

    def remaining(self):
        return sorted(ref for _, ref in self.docker.resources)

    def test_a_complete_removal_removes_the_manifest_and_the_runtime_directory(self):
        code, out = self.down()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remaining(), [])
        self.assertFalse(self.private.exists())
        self.assertTrue(json.loads(out)["runtime_directory_removed"])

    def test_an_incomplete_removal_keeps_the_manifest_so_a_second_down_can_finish(self):
        self.docker.refuse = {"id-" + self.label + "-auth", "id-" + self.label + "-int"}
        code, out = self.down()
        self.assertEqual(code, 1, out)
        report = json.loads(out)
        self.assertFalse(report["runtime_directory_removed"])
        self.assertIn("manifest.json", report["leftover_files"])
        # What remains is exactly what the failed removals still need, and the secrets are gone.
        manifest = json.loads((self.private / "manifest.json").read_text())
        self.assertEqual(manifest["state"], "removal incomplete")
        self.assertEqual([entry["id"] for entry in manifest["containers"]],
                         ["id-" + self.label + "-db", "id-" + self.label + "-auth"])
        self.assertEqual(self.remaining(), sorted(["id-" + self.label + "-auth", "id-" + self.label + "-int"]))
        self.assertFalse((self.private / "admin-key").exists())
        self.assertFalse((self.private / "auth.env").exists())
        # The retry completes once Docker cooperates; resources that are already gone count as absent.
        self.docker.refuse = set()
        code, out = self.down()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remaining(), [])
        self.assertFalse(self.private.exists())

    def test_a_third_down_after_completion_refuses_rather_than_guessing(self):
        self.down()
        with self.assertRaises(FileNotFoundError):
            self.down()

    def test_no_secret_reaches_the_output_or_the_evidence_on_either_attempt(self):
        self.docker.refuse = {"id-" + self.label + "-auth"}
        _, first = self.down()
        self.docker.refuse = set()
        _, second = self.down()
        evidence = "".join(path.read_text() for path in fx.EVIDENCE.glob("*"))
        for text in (first, second, evidence):
            self.assertNotIn(ADMIN_SECRET, text)
            self.assertNotIn(OWNER_SECRET, text)

    def test_a_resource_that_is_not_labelled_for_this_fixture_is_neither_removed_nor_forgotten(self):
        self.docker.resources[("container", "id-" + self.label + "-auth")] = "someone-else"
        code, out = self.down()
        self.assertEqual(code, 1, out)
        self.assertIn(("container", "id-" + self.label + "-auth"), self.docker.resources)
        self.assertTrue((self.private / "manifest.json").is_file())
        self.assertNotIn(("container", "rm", "-f", "id-" + self.label + "-auth"), self.docker.calls)

    def test_a_docker_that_cannot_be_reached_is_an_incomplete_removal_not_a_traceback(self):
        self.docker.raises = subprocess.TimeoutExpired(["docker"], 60)
        code, out = self.down()
        self.assertEqual(code, 1, out)
        self.assertTrue((self.private / "manifest.json").is_file(), "the manifest must survive for the retry")
        self.assertEqual(json.loads(out)["cleanup"]["containers"][0]["result"], "removal failed")
        self.docker.raises = None
        code, out = self.down()
        self.assertEqual((code, self.remaining(), self.private.exists()), (0, [], False), out)

    # -- a Docker that answers with a non-zero status (daemon down, socket, permission, API error) proves nothing is absent ----
    def assertKeptForRetry(self, code, out):
        self.assertEqual(code, 1, out)
        self.assertTrue((self.private / "manifest.json").is_file(), "the manifest must survive for the retry")
        report = json.loads(out)
        self.assertFalse(report["runtime_directory_removed"])
        for group in ("containers", "networks"):
            self.assertEqual({item["result"] for item in report["cleanup"][group]}, {"removal failed"})
        manifest = json.loads((self.private / "manifest.json").read_text())
        self.assertEqual(manifest["state"], "removal incomplete")
        self.assertEqual((len(manifest["containers"]), len(manifest["networks"])), (2, 2))
        self.assertNotIn("DAEMON-STDERR", out)

    def test_every_ordinary_nonzero_docker_error_is_a_failed_removal_that_keeps_the_manifest(self):
        for message in ("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. DAEMON-STDERR",
                        "permission denied while trying to connect to the docker API DAEMON-STDERR",
                        "Error response from daemon: 500 internal server error DAEMON-STDERR",
                        "Error: No such container: x (the daemon could not resolve it) DAEMON-STDERR", ""):
            with self.subTest(stderr=message[:40]):
                self.docker.errors, self.docker.stderr = {"*"}, message
                self.assertKeptForRetry(*self.down())
                self.assertEqual(len(self.docker.resources), 4, "nothing was removed")
                self.assertNotIn(("container", "rm", "-f", "id-" + self.label + "-db"), self.docker.calls)
        self.docker.errors = set()
        code, out = self.down()
        self.assertEqual((code, self.remaining(), self.private.exists()), (0, [], False), out)

    def test_an_inspect_that_fails_is_not_absence_when_the_exact_lookup_also_fails(self):
        self.docker.errors, self.docker.stderr = {"inspect", "ls"}, "Error: No such object: DAEMON-STDERR"
        self.assertKeptForRetry(*self.down())
        self.docker.errors = set()
        self.assertEqual(self.down()[0], 0)

    def test_an_inspect_error_for_a_resource_that_the_exact_lookup_still_lists_is_a_failed_removal(self):
        self.docker.errors = {"inspect"}
        self.assertKeptForRetry(*self.down())
        self.assertEqual(len(self.docker.resources), 4)

    def test_a_resource_is_absent_only_when_a_successful_exact_lookup_does_not_list_it(self):
        # a successful list that holds only look-alikes (other ids, a name that merely contains the recorded one) is true absence
        self.docker.resources = {("container", "id-other"): "x", ("network", "id-" + self.label + "-int-2"): "x"}
        code, out = self.down()
        self.assertEqual(code, 0, out)
        self.assertEqual({item["result"] for g in ("containers", "networks") for item in json.loads(out)["cleanup"][g]}, {"absent"})
        self.assertFalse(self.private.exists())

    def test_genuine_partial_deletion_then_a_daemon_error_then_recovery_still_finishes(self):
        self.docker.refuse = {"id-" + self.label + "-auth"}
        self.assertEqual(self.down()[0], 1)
        # the daemon is now unreachable: the half-removed fixture must not be declared gone
        self.docker.errors = {"*"}
        code, out = self.down()
        self.assertEqual(code, 1, out)
        self.assertTrue((self.private / "manifest.json").is_file())
        self.docker.errors, self.docker.refuse = set(), set()
        code, out = self.down()
        self.assertEqual((code, self.remaining(), self.private.exists()), (0, [], False), out)

    def test_the_manifest_stays_private(self):
        self.docker.refuse = {"id-" + self.label + "-auth"}
        self.down()
        self.assertEqual(os.stat(self.private / "manifest.json").st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.private).st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main(verbosity=2)
