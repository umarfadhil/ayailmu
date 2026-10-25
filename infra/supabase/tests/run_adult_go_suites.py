"""Runs the adult backend's own Go suites that need only a disposable PostgreSQL (AYA_TEST_DATABASE_URL), on a fresh
loopback cluster that is removed afterwards. Tests that need the pinned real GoTrue fixture (Docker; AYA_REAL_AUTH_FIXTURE)
cannot run here and are excluded by name; the exclusion is printed, never silent (infra/real-auth/ runs them against a real fixture).
TestRegistryPinsExactPackBytesAndHonestStatus runs, unchanged, against the archived exact bytes the registry pins
(infra/catalog/pinned-expo-fixtures, revision ef28606). Whether the frontend's *current* fixtures still equal those bytes is a
separate, deliberately failing-while-different gate: infra/catalog/check_current_compat.py."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
from common import REPO  # noqa: E402
from pgtest import Cluster  # noqa: E402

EXCLUDED = "RealGoTrue|AtTheRealAuth"
PINNED_FIXTURES = REPO / "infra" / "catalog" / "pinned-expo-fixtures"


def main() -> int:
    c = Cluster().start()
    try:
        pw = c.new_password()
        c.psql(f"CREATE ROLE aya_gotest LOGIN SUPERUSER PASSWORD '{pw}'")  # ephemeral, exists only in this cluster
        c.create_database("aya_gotest_db")
        env = dict(os.environ, AYA_TEST_DATABASE_URL=f"postgres://aya_gotest:{pw}@127.0.0.1:{c.port}/aya_gotest_db?sslmode=disable",
                   AYA_TEST_EXPO_FIXTURES_DIR=str(PINNED_FIXTURES))
        backend = REPO / "backend"
        print(f"excluded by name (they need the real GoTrue fixture; see infra/real-auth): -skip '{EXCLUDED}'", flush=True)
        r = subprocess.run(["go", "test", "-count=1", "-skip", EXCLUDED, "./..."], cwd=backend, env=env, capture_output=True, text=True)
        sys.stdout.write((r.stdout + r.stderr).replace(pw, "[redacted]"))
        v = subprocess.run(["go", "vet", "./..."], cwd=backend, env=env, capture_output=True, text=True)
        sys.stdout.write(v.stdout + v.stderr)
        print(f"go test exit={r.returncode} go vet exit={v.returncode}")
        return 1 if r.returncode or v.returncode else 0
    finally:
        c.stop()


if __name__ == "__main__":
    sys.exit(main())
