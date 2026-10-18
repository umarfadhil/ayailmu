#!/usr/bin/env python3
"""Closed-test tester codes for AyaIlmu (P7, CR-BIL-7).

Prints new codes and their SHA-256 hashes. Put ONLY the hashes into
android/content/src/main/assets/config/app_config.json -> trial.tester_code_hashes, set trial.tester_until to the
last day of the closed test (required whenever there are hashes), and send each code to its tester privately.
Never commit the codes. The app compares sha256(code.strip().upper()) with the list.

A code is AYA- plus 4 groups of 5 characters from a 32-letter alphabet: 20 random characters, about 100 bits.
That is what keeps an unsalted hash safe: the hashes ship inside the APK, so a short code could be guessed back
from its hash offline. Do not shorten the codes.

Usage: python3 android/tools/tester_code.py [count]        (default 1)
       python3 android/tools/tester_code.py --hash CODE    (hash an existing code)
"""
import hashlib
import secrets
import sys

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: easy to read aloud


def normalise(code: str) -> str:
    return code.strip().upper()


def code_hash(code: str) -> str:
    return hashlib.sha256(normalise(code).encode("utf-8")).hexdigest()


GROUPS = 4
GROUP_LEN = 5


def new_code() -> str:
    groups = ["".join(secrets.choice(ALPHABET) for _ in range(GROUP_LEN)) for _ in range(GROUPS)]
    return "AYA-" + "-".join(groups)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--hash":
        print(code_hash(sys.argv[2]))
        sys.exit(0)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    for _ in range(n):
        c = new_code()
        print(f"{c}  {code_hash(c)}")
    print("# Remember: trial.tester_until (last day of the test) is required in app_config.json.", file=sys.stderr)
