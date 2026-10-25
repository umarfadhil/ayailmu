"""Compatibility gate: do the frontend's CURRENT Expo fixtures still equal the bytes the adult registry pins?

The pinned bytes are the archive in pinned-expo-fixtures/ (verified against SHA256SUMS, and against the registry itself by
run_pin_test.sh). This script compares a directory of current fixtures with that archive and exits 1 with the evidence when
any file differs: it never edits a pin, a hash or a fixture, and it does not skip. Usage:

    python3 -I check_current_compat.py <dir with demo-unit-a.json, demo-v0.2.json, demo-v0.3.json>

Exit 0: identical. Exit 1: mismatch (printed). Exit 2: usage or an unreadable/corrupt input.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCHIVE = HERE / "pinned-expo-fixtures"
FILES = ("demo-unit-a.json", "demo-v0.2.json", "demo-v0.3.json")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def pointers(a, b, path=""):
    """JSON pointers where a and b differ (lists compared by index; a length change is reported at the list)."""
    if type(a) is not type(b):
        return [path or "/"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}/{k}")
            else:
                out += pointers(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [path or "/"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += pointers(x, y, f"{path}/{i}")
        return out
    return [] if a == b else [path or "/"]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    current = Path(argv[1])
    sums = dict(line.split()[::-1] for line in (ARCHIVE / "SHA256SUMS").read_text().splitlines() if line.strip())
    bad = 0
    for name in FILES:
        pinned = (ARCHIVE / name).read_bytes()
        if sha(pinned) != sums[name]:
            print(f"ARCHIVE CORRUPT {name}", file=sys.stderr)
            return 2
        try:
            now = (current / name).read_bytes()
        except OSError as e:
            print(f"cannot read current {name}: {e.strerror}", file=sys.stderr)
            return 2
        if now == pinned:
            print(f"ok       {name} {sha(now)}")
            continue
        bad += 1
        print(f"MISMATCH {name}\n  pinned  {sha(pinned)}\n  current {sha(now)}")
        try:
            a, b = json.loads(pinned), json.loads(now)
            print(f"  items identical: {a.get('items') == b.get('items')}; content_version: {a.get('content_version')} -> {b.get('content_version')}")
            print(f"  differing JSON pointers: {pointers(a, b)}")
        except ValueError:
            print("  current file is not valid JSON")
    if bad:
        print(f"FAIL: {bad} current fixture(s) differ from the bytes the registry pins; the curriculum owner must re-pin, re-version or "
              "restore them. Nothing here changes a pin.", file=sys.stderr)
        return 1
    print("current fixtures equal the pinned bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
