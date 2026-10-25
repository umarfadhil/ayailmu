"""One-time, bounded proof for the demo-synthetic-0.3 re-pin: frontend ef28606 -> 8b29a91.

    python3 -I verify_alignment_proof.py <historical dir (pinned-expo-fixtures)> <authoritative dir (authoritative-expo-fixtures)>

This is NOT a compatibility policy. It accepts exactly two known byte hashes of demo-v0.3.json and exactly three known JSON
pointers; anything else (a third hash, a fourth pointer, a changed item, key, choice, id, version, status or paragraph/screen
count) exits 1. Nothing is ignored by key name or by "looks like a goal/body string".

Exit 0: proven. Exit 1: not proven (printed). Exit 2: an input is missing or not JSON.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HISTORICAL_SHA = "af0c4bdd7b1db1cc188259dc7ebf484207773cd0657e66b5ec379c6f4fa71cf5"  # frontend ef28606ce68bae962695a9d7fb23d0c52b36b392
CURRENT_SHA = "80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee"     # frontend 8b29a91a2ae4a83d89cbfbfe58c8fdfa67670923
UNCHANGED = {"demo-unit-a.json": "34013947405d765e11d44baa7830c620ae417b90d24dbc845fca95625f2ac44e",
             "demo-v0.2.json": "be4f8038fd71b56266ca257aae9d0fdf0b9110d220a968bf98adc05f57af7a02"}
POINTERS = ["/lesson_screens/0/body/0", "/lesson_screens/0/body/1", "/lesson_screens/4/body/0"]
CONTENT_VERSION = "demo-synthetic-0.3"
ITEMS = 45
DRAFT = 53  # review_status over the 45 items and 8 lesson screens


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def walk(a, b, path=""):
    """Every JSON pointer at which a and b differ (a type, key-set or list-length change is reported at the container)."""
    if type(a) is not type(b):
        return [path or "/"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += [f"{path}/{k}"] if (k not in a or k not in b) else walk(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [path or "/"]
        return [p for i, (x, y) in enumerate(zip(a, b)) for p in walk(x, y, f"{path}/{i}")]
    return [] if a == b else [path or "/"]


def at(doc, pointer):
    for part in pointer.strip("/").split("/"):
        doc = doc[int(part)] if isinstance(doc, list) else doc[part]
    return doc


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    hist, cur = Path(argv[1]), Path(argv[2])
    try:
        raw = {(d.name, n): (d / n).read_bytes() for d in (hist, cur) for n in ("demo-unit-a.json", "demo-v0.2.json", "demo-v0.3.json")}
        old, new = json.loads(raw[(hist.name, "demo-v0.3.json")]), json.loads(raw[(cur.name, "demo-v0.3.json")])
    except (OSError, ValueError) as e:
        print(f"input unreadable: {e}", file=sys.stderr)
        return 2
    if hist.resolve() == cur.resolve():
        print("NOT PROVEN: the historical and authoritative directories are the same", file=sys.stderr)
        return 1
    failures: list[str] = []
    hv3, cv3 = sha(raw[(hist.name, "demo-v0.3.json")]), sha(raw[(cur.name, "demo-v0.3.json")])
    if hv3 != HISTORICAL_SHA:
        failures.append(f"unknown hash for the historical demo-v0.3.json: {hv3}")
    if cv3 != CURRENT_SHA:
        failures.append(f"unknown hash for the authoritative demo-v0.3.json: {cv3}")
    for name, want in UNCHANGED.items():
        if sha(raw[(hist.name, name)]) != want or raw[(hist.name, name)] != raw[(cur.name, name)]:
            failures.append(f"{name} is not the byte-identical, known file in both directories")
    for label, d, want in (("historical", hist, HISTORICAL_SHA), ("authoritative", cur, CURRENT_SHA)):
        try:
            sums = dict(l.split()[::-1] for l in (d / "SHA256SUMS").read_text().splitlines() if l.strip())
        except OSError:
            failures.append(f"{label} SHA256SUMS missing")
            continue
        if sums.get("demo-v0.3.json") != want or any(sha(raw[(d.name, n)]) != s for n, s in sums.items() if (d.name, n) in raw):
            failures.append(f"{label} SHA256SUMS does not match the files / the known hash")
    diff = walk(old, new)
    if diff != POINTERS:
        failures.append(f"differing JSON pointers {diff}, want exactly {POINTERS}")
    if old.get("items") != new.get("items") or len(new.get("items", [])) != ITEMS:
        failures.append(f"the {ITEMS} items (ids, choices, keys, versions, statuses) are not identical")
    if old.get("content_version") != CONTENT_VERSION or new.get("content_version") != CONTENT_VERSION:
        failures.append("content_version is not demo-synthetic-0.3 in both")
    for p in POINTERS:
        try:
            if not (isinstance(at(old, p), str) and isinstance(at(new, p), str) and at(old, p) != at(new, p)):
                failures.append(f"{p} is not a changed string")
        except (KeyError, IndexError, ValueError):
            failures.append(f"{p} is missing")
    counts: dict[str, int] = {}
    for entry in [*new.get("lesson_screens", []), *new.get("items", [])]:
        counts[entry.get("review_status")] = counts.get(entry.get("review_status"), 0) + 1
    if counts != {"draft": DRAFT}:
        failures.append(f"review_status counts {counts}, want only {DRAFT} draft")
    if len(old.get("lesson_screens", [])) != len(new.get("lesson_screens", [])):
        failures.append("lesson screen count differs")
    if failures:
        for f in failures:
            print(f"NOT PROVEN: {f}")
        return 1
    print(f"PROVEN: demo-v0.3.json {hv3} (ef28606) -> {cv3} (8b29a91)")
    print(f"  differs at exactly {POINTERS}; every other member equal, content_version {CONTENT_VERSION} in both")
    print(f"  {ITEMS} items identical (ids, choices, keys, versions); {len(new['lesson_screens'])} lesson screens, same paragraph counts; {DRAFT} draft statuses")
    print("  demo-unit-a.json and demo-v0.2.json byte-identical in both revisions")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
