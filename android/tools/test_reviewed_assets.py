#!/usr/bin/env python3
"""Read-only checks of real AGP asset-merge outputs; never builds or signs an APK."""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import unittest


PACK = "packs/matematika/mat-a-local/v1.json"
PACK_SHA256 = "7ed58f9684e68f6fef43fcd9ea3e65ff50e530663cec495f207bce20b1bcab0c"
SHARED = {
    "art/index.json",
    "audio/index.json",
    "strokes/index.json",
    "config/app_config.json",
    "licenses/KanjiVG.txt",
    "licenses/OFL-NotoNaskhArabic.txt",
}
REVIEWED = {
    "config/catalog.json",
    "config/rules.mat-a-local.json",
    PACK,
    "provenance.json",
}
OPTIONS = None


def inventory(root):
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReviewedProductionAssetsTest(unittest.TestCase):
    def setUp(self):
        self.prod = OPTIONS.prod_merged
        self.main_source = OPTIONS.source_root / "content/src/main/assets"
        self.reviewed_source = OPTIONS.source_root / "content/src/reviewed/assets"
        self.assertTrue(self.prod.is_dir(), "Run the permitted asset merge first")

    def test_prod_inventory_is_exact(self):
        self.assertSetEqual(SHARED | REVIEWED, inventory(self.prod))

    def test_reviewed_catalog_and_hash_are_unchanged(self):
        self.assertTrue(all((self.prod / name).is_file() for name in REVIEWED), "ordinary prod is missing the exact reviewed payload")
        for name in REVIEWED:
            with self.subTest(file=name):
                self.assertEqual(digest(self.reviewed_source / name), digest(self.prod / name))
        self.assertEqual(PACK_SHA256, digest(self.prod / PACK))
        catalog = json.loads((self.prod / "config/catalog.json").read_text())
        self.assertEqual(["mat-a-local"], [p["track"] for p in catalog["tracks"]])
        self.assertEqual(PACK, catalog["tracks"][0]["pack"])
        proof = json.loads((self.prod / "provenance.json").read_text())
        self.assertEqual(PACK_SHA256, proof["review"]["packSHA256"])

    def test_no_synthetic_or_unreviewed_pack_is_present(self):
        packs = sorted((self.prod / "packs").rglob("*.json"))
        self.assertEqual([PACK], [p.relative_to(self.prod).as_posix() for p in packs])
        for path in packs:
            pack = json.loads(path.read_text())
            self.assertFalse(pack["synthetic"])
            self.assertEqual("mat-a-local-pemula-0.3", pack["meta"]["content_version"])
            self.assertEqual(14, len(pack["items"]))
            self.assertEqual(1, len(pack["screens"]))
            self.assertTrue(all(i["review_status"] == "approved" for i in pack["items"]))
            self.assertTrue(all(i["review_status"] == "approved" for i in pack["screens"]))

    def test_startup_indexes_config_and_notices_keep_original_bytes(self):
        for name in SHARED:
            with self.subTest(file=name):
                self.assertEqual(digest(self.main_source / name), digest(self.prod / name))

    def test_demo_keeps_the_complete_original_assets(self):
        expected = inventory(self.main_source)
        stock_packs = {p for p in expected if p.startswith("packs/")}
        self.assertEqual(73, len(stock_packs))
        for ordinary in OPTIONS.baseline_merged:
            with self.subTest(variant=str(ordinary)):
                self.assertTrue(ordinary.is_dir())
                actual = inventory(ordinary)
                self.assertSetEqual(stock_packs, {p for p in actual if p.startswith("packs/")})
                for name in expected:
                    self.assertIn(name, actual)
                    self.assertEqual(digest(self.main_source / name), digest(ordinary / name), name)
                catalog = json.loads((ordinary / "config/catalog.json").read_text())
                self.assertEqual(73, len(catalog["tracks"]))
                self.assertNotIn("mat-a-local", [p["track"] for p in catalog["tracks"]])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--prod-merged", type=Path, required=True)
    parser.add_argument("--baseline-merged", type=Path, required=True, action="append")
    OPTIONS = parser.parse_args()
    unittest.main(argv=[sys.argv[0]], verbosity=2)
