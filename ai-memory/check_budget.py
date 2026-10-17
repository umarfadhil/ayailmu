#!/usr/bin/env python3
"""Report ai-memory file sizes against their budgets. Exit 1 if any file is over.

Run from anywhere:  python ai-memory/check_budget.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BUDGETS_KB = {
    "PROJECT_OVERVIEW.md": 12,
    "CODE_RULES.md": 40,
    "FILE_MAP.md": 25,
    "MONETIZATION_SCHEME.md": 20,
    "ART_DIRECTION.md": 15,
    "SESSION_LEARNINGS.md": 60,
}


def main() -> int:
    folder = Path(__file__).resolve().parent
    over = False
    print(f"{'file':<24}{'size':>9}{'budget':>9}  status")
    for name, budget_kb in BUDGETS_KB.items():
        path = folder / name
        if not path.exists():
            print(f"{name:<24}{'missing':>9}{budget_kb:>7} KB  MISSING")
            over = True
            continue
        size_kb = path.stat().st_size / 1024
        pct = size_kb / budget_kb * 100
        if size_kb > budget_kb:
            status, over = "OVER - compact now", True
        elif pct >= 80:
            status = "near limit"
        else:
            status = "ok"
        print(f"{name:<24}{size_kb:>7.1f} KB{budget_kb:>7} KB  {status} ({pct:.0f}%)")
    if over:
        print("\nAt least one file is over budget. See README.md for the compaction rule.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
