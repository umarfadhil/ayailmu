"""Self-test of check_current_compat.py: identical bytes pass, any changed byte fails visibly, a missing file is a usage error."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE = HERE / "check_current_compat.py"
ARCHIVE = HERE / "pinned-expo-fixtures"


def gate(d: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(GATE), str(d)], capture_output=True, text=True)


class CompatGate(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aya-compat-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for f in ARCHIVE.glob("*.json"):
            shutil.copy(f, self.tmp / f.name)

    def test_identical_bytes_pass(self):
        r = gate(self.tmp)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_a_copy_edit_under_the_same_content_version_fails_and_names_the_pointer(self):
        p = self.tmp / "demo-v0.3.json"
        raw = p.read_bytes()
        i = raw.index(b'"body"')
        j = raw.index(b'"', raw.index(b'"', i + 8) + 1)  # inside the first body string
        p.write_bytes(raw[:j] + b"!" + raw[j:])
        r = gate(self.tmp)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MISMATCH demo-v0.3.json", r.stdout)
        self.assertIn("/lesson_screens/0/body/0", r.stdout)
        self.assertIn("items identical: True", r.stdout)

    def test_a_trailing_newline_alone_fails(self):
        p = self.tmp / "demo-v0.2.json"
        p.write_bytes(p.read_bytes() + b"\n")
        self.assertEqual(gate(self.tmp).returncode, 1)

    def test_a_missing_file_is_not_a_pass(self):
        (self.tmp / "demo-unit-a.json").unlink()
        self.assertEqual(gate(self.tmp).returncode, 2)


if __name__ == "__main__":
    unittest.main()
