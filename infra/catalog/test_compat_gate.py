"""Self-test of check_current_compat.py: the gate compares a fixtures directory with the ACTIVE registry pins in packs.go.

Identical bytes pass, any changed byte fails visibly (no wildcard, no pointer is ignored), a missing file or an unreadable
registry is a usage error, and the gate follows the registry rather than any archive. Offline; no frontend checkout needed.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE = HERE / "check_current_compat.py"
CURRENT = HERE / "authoritative-expo-fixtures"
HISTORICAL = HERE / "pinned-expo-fixtures"
REGISTRY = HERE.parents[1] / "backend" / "internal" / "curriculum" / "packs.go"
HISTORICAL_V03 = "af0c4bdd7b1db1cc188259dc7ebf484207773cd0657e66b5ec379c6f4fa71cf5"
CURRENT_V03 = "80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee"


def gate(d: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(GATE), str(d), *extra], capture_output=True, text=True)


class CompatGate(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aya-compat-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cur = self.tmp / "current"
        shutil.copytree(CURRENT, self.cur, ignore=shutil.ignore_patterns("SHA256SUMS", "PROVENANCE.md"))

    def registry_with_v03(self, sha: str) -> Path:
        text = REGISTRY.read_text()
        self.assertEqual(text.count(CURRENT_V03), 1)
        p = self.tmp / "packs.go"
        p.write_text(text.replace(CURRENT_V03, sha))
        return p

    def test_current_fixtures_equal_the_active_registry_pins(self):
        r = gate(self.cur)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(CURRENT_V03, r.stdout)
        self.assertIn("equal the active registry pins", r.stdout)

    def test_the_registry_really_pins_the_authoritative_snapshot(self):
        sums = dict(line.split()[::-1] for line in (CURRENT / "SHA256SUMS").read_text().splitlines())
        self.assertEqual(sums["demo-v0.3.json"], CURRENT_V03)
        self.assertIn(CURRENT_V03, REGISTRY.read_text())
        self.assertNotIn(HISTORICAL_V03, REGISTRY.read_text())

    def test_the_historical_archive_no_longer_equals_the_active_pins(self):
        r = gate(HISTORICAL)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MISMATCH demo-v0.3.json", r.stdout)
        self.assertIn(f"pinned  {CURRENT_V03}", r.stdout)
        self.assertIn(f"current {HISTORICAL_V03}", r.stdout)
        self.assertNotIn("MISMATCH demo-unit-a.json", r.stdout)
        self.assertNotIn("MISMATCH demo-v0.2.json", r.stdout)

    def test_the_gate_follows_the_registry_not_an_archive(self):
        old = self.registry_with_v03(HISTORICAL_V03)
        self.assertEqual(gate(HISTORICAL, "--registry", str(old)).returncode, 0)
        r = gate(self.cur, "--registry", str(old))
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MISMATCH demo-v0.3.json", r.stdout)

    def test_any_copy_edit_under_the_same_content_version_fails_and_names_the_pointer(self):
        p = self.cur / "demo-v0.3.json"
        raw = p.read_bytes()
        i = raw.index(b'"body"')
        j = raw.index(b'"', raw.index(b'"', i + 8) + 1)  # inside the first body string
        p.write_bytes(raw[:j] + b"!" + raw[j:])
        r = gate(self.cur)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MISMATCH demo-v0.3.json", r.stdout)
        self.assertIn("/lesson_screens/0/body/0", r.stdout)
        self.assertIn("items identical: True", r.stdout)

    def test_an_item_change_fails_and_is_reported_as_an_item_change(self):
        p = self.cur / "demo-v0.3.json"
        raw = p.read_bytes()
        marker = raw.index(b'"items"')
        j = raw.index(b'"prompt', marker) if b'"prompt' in raw[marker:] else raw.index(b'"id"', marker)
        k = raw.index(b'"', raw.index(b'"', j + 8) + 1) + 1
        p.write_bytes(raw[:k] + b"x" + raw[k:])
        r = gate(self.cur)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("items identical: False", r.stdout)

    def test_a_trailing_newline_alone_fails(self):
        p = self.cur / "demo-v0.2.json"
        p.write_bytes(p.read_bytes() + b"\n")
        self.assertEqual(gate(self.cur).returncode, 1)

    def test_a_missing_file_is_not_a_pass(self):
        (self.cur / "demo-unit-a.json").unlink()
        self.assertEqual(gate(self.cur).returncode, 2)

    def test_an_unreadable_or_incomplete_registry_is_a_usage_error(self):
        self.assertEqual(gate(self.cur, "--registry", str(self.tmp / "absent.go")).returncode, 2)
        broken = self.tmp / "broken.go"
        broken.write_text(REGISTRY.read_text().replace("demo-unit-a.json", "demo-unit-z.json"))
        self.assertEqual(gate(self.cur, "--registry", str(broken)).returncode, 2)
        broken.write_text("package curriculum\n")
        self.assertEqual(gate(self.cur, "--registry", str(broken)).returncode, 2)


if __name__ == "__main__":
    unittest.main()
