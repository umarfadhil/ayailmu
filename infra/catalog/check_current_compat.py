"""Compatibility gate: do the frontend's CURRENT Expo fixtures equal the bytes the ACTIVE adult registry pins?

The pins are read from backend/internal/curriculum/packs.go (the Expo packs under app/src/content/fixtures/), so the gate
follows the registry itself rather than any archive. It compares a directory of current fixtures byte for byte and exits 1
with the evidence when any file differs. It has no ignore list and no tolerance: a goal or body string changed anywhere fails
exactly like an item change. The one reviewed historical difference (ef28606 -> 8b29a91) is a separate, bounded proof in
verify_alignment_proof.py and is not a policy of this gate. It never edits a pin, a hash or a fixture, and it does not skip.

    python3 -I check_current_compat.py <dir with demo-unit-a.json, demo-v0.2.json, demo-v0.3.json> [--registry packs.go]

Exit 0: identical to the active pins. Exit 1: mismatch (printed). Exit 2: usage, or an unreadable/unparseable input.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REGISTRY = HERE.parents[1] / "backend" / "internal" / "curriculum" / "packs.go"
REFERENCE = HERE / "authoritative-expo-fixtures"  # used only to explain a mismatch
FILES = ("demo-unit-a.json", "demo-v0.2.json", "demo-v0.3.json")
PIN_RE = re.compile(r'Path:\s*"app/src/content/fixtures/([A-Za-z0-9._-]+\.json)",\s*SHA256:\s*"([0-9a-f]{64})"')


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def registry_pins(path: Path) -> dict[str, str]:
    """{file name: sha256} of the Expo packs in packs.go; anything other than exactly the three known files is an error."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ValueError(f"cannot read the registry {path.name}: {e.strerror}")
    pins = dict(PIN_RE.findall(text))
    if len(PIN_RE.findall(text)) != len(pins) or sorted(pins) != sorted(FILES):
        raise ValueError(f"the registry does not pin exactly {', '.join(FILES)} (found {sorted(pins)})")
    return pins


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
    args = argv[1:]
    registry = REGISTRY
    if "--registry" in args:
        i = args.index("--registry")
        if i + 1 >= len(args):
            print(__doc__, file=sys.stderr)
            return 2
        registry = Path(args[i + 1])
        del args[i:i + 2]
    if len(args) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    current = Path(args[0])
    try:
        pins = registry_pins(registry)
    except ValueError as e:
        print(f"REGISTRY UNUSABLE: {e}", file=sys.stderr)
        return 2
    bad = 0
    for name in FILES:
        try:
            now = (current / name).read_bytes()
        except OSError as e:
            print(f"cannot read current {name}: {e.strerror}", file=sys.stderr)
            return 2
        if sha(now) == pins[name]:
            print(f"ok       {name} {pins[name]}")
            continue
        bad += 1
        print(f"MISMATCH {name}\n  pinned  {pins[name]}\n  current {sha(now)}")
        try:
            ref = json.loads((REFERENCE / name).read_bytes())
            cur = json.loads(now)
            print(f"  items identical: {ref.get('items') == cur.get('items')}; content_version: {ref.get('content_version')} -> {cur.get('content_version')}")
            print(f"  differing JSON pointers (against the committed authoritative snapshot): {pointers(ref, cur)}")
        except (OSError, ValueError):
            print("  current file could not be compared with the committed snapshot")
    if bad:
        print(f"FAIL: {bad} current fixture(s) differ from the bytes the active registry pins; a curriculum owner must review the change and "
              "re-pin it deliberately. Nothing here changes a pin.", file=sys.stderr)
        return 1
    print("current fixtures equal the active registry pins")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
