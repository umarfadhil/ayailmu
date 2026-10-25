"""Tests of verify_alignment_proof.py: the one-time, bounded proof that the ef28606 -> 8b29a91 change of demo-v0.3.json is
exactly three lesson-screen copy strings. It accepts only the two known hashes and the three known JSON pointers."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROOF = HERE / "verify_alignment_proof.py"
HISTORICAL = HERE / "pinned-expo-fixtures"
CURRENT = HERE / "authoritative-expo-fixtures"
POINTERS = ["/lesson_screens/0/body/0", "/lesson_screens/0/body/1", "/lesson_screens/4/body/0"]


def prove(hist: Path, cur: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(PROOF), str(hist), str(cur)], capture_output=True, text=True)


class AlignmentProof(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aya-proof-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.hist, self.cur = self.tmp / "hist", self.tmp / "cur"
        shutil.copytree(HISTORICAL, self.hist)
        shutil.copytree(CURRENT, self.cur)

    def rewrite_current(self, edit):
        """Re-serialise the current v0.3 with `edit(doc)` applied and refresh its SHA256SUMS line, as a hostile fixer would."""
        p = self.cur / "demo-v0.3.json"
        doc = json.loads(p.read_text())
        edit(doc)
        p.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        sums = self.cur / "SHA256SUMS"
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        sums.write_text("".join(f"{sha}  demo-v0.3.json\n" if l.endswith("demo-v0.3.json") else l + "\n" for l in sums.read_text().splitlines()))

    def test_the_real_archive_and_snapshot_prove_the_bounded_change(self):
        r = prove(HISTORICAL, CURRENT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for pointer in POINTERS:
            self.assertIn(pointer, r.stdout)
        self.assertIn("45 items identical", r.stdout)
        self.assertIn("demo-unit-a.json and demo-v0.2.json byte-identical", r.stdout)

    def test_a_fourth_changed_string_is_refused_even_with_a_matching_manifest(self):
        self.rewrite_current(lambda d: d["lesson_screens"][1]["body"].__setitem__(0, d["lesson_screens"][1]["body"][0] + " "))
        r = prove(self.hist, self.cur)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)

    def test_an_item_change_is_refused(self):
        self.rewrite_current(lambda d: d["items"][0].__setitem__("item_id", d["items"][0]["item_id"] + "x"))
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)

    def test_an_answer_key_change_is_refused(self):
        def edit(d):
            for option in d["items"][0]["options"]:
                option["correct"] = not option.get("correct", False)
        self.rewrite_current(edit)
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)

    def test_a_content_version_bump_or_status_change_is_refused(self):
        self.rewrite_current(lambda d: d.__setitem__("content_version", "demo-synthetic-0.4"))
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)
        self.setUp()
        self.rewrite_current(lambda d: d["items"][0].__setitem__("review_status", "approved-for-trial"))
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)

    def test_a_changed_screen_count_or_paragraph_count_is_refused(self):
        self.rewrite_current(lambda d: d["lesson_screens"][0]["body"].append("extra paragraph"))
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)
        self.setUp()
        self.rewrite_current(lambda d: d["lesson_screens"].pop())
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)

    def test_only_the_two_known_hashes_are_accepted(self):
        self.rewrite_current(lambda d: d.__setitem__("note", d["note"]))  # re-serialised, so different bytes, same JSON
        r = prove(self.hist, self.cur)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("unknown hash", r.stdout + r.stderr)

    def test_a_modified_historical_archive_is_refused(self):
        p = self.hist / "demo-v0.3.json"
        p.write_bytes(p.read_bytes() + b"\n")
        self.assertEqual(prove(self.hist, self.cur).returncode, 1)

    def test_a_missing_input_is_a_usage_error(self):
        (self.cur / "demo-v0.3.json").unlink()
        self.assertEqual(prove(self.hist, self.cur).returncode, 2)


if __name__ == "__main__":
    unittest.main()
