#!/usr/bin/env python3
"""Manual synthetic fixtures; shares the E2E runner's exclusive fixture lock."""
from fixtures import fixture_lock, generate

if __name__ == '__main__':
    with fixture_lock():
        generate()
