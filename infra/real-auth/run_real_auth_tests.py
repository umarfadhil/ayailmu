"""Runs the adult backend's six real-GoTrue tests against one disposable, uniquely labelled GoTrue v2.197.0 fixture.

    python3 -I run_real_auth_tests.py [--jwt-exp SECONDS] [--full] [--race]

Starts a fresh loopback PostgreSQL cluster (the infra tests' pgtest, removed afterwards) for the application's own database
and one real GoTrue + PostgreSQL fixture (real_auth_fixture.py: pinned cached images, never pulled; Auth published on literal
loopback only, its database on a private internal network). Runs exactly the tests that refuse to skip without the fixture
(-run 'RealGoTrue|AtTheRealAuth'), then removes the fixture's own labelled containers, networks and secret files and checks
that nothing carrying its label is left. Secrets never reach the output. Exit 0 only if every test passed and cleanup is complete.
--full runs the WHOLE backend suite (no -run filter, no -skip) with both the fixture and the private database set, so nothing
that needs either is skipped; it additionally requires zero skipped tests and the six real-GoTrue tests among the passes.
--race adds the race detector.
Needs: go, a running Docker daemon with the two pinned images cached, PostgreSQL binaries (PG_BIN) as for the other infra tests.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "supabase" / "tests"))  # -I drops the script directory
sys.path.insert(0, str(HERE))
import real_auth_fixture as fx  # noqa: E402
from common import REPO  # noqa: E402
from pgtest import Cluster  # noqa: E402

PATTERN = "RealGoTrue|AtTheRealAuth"


def helper(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(HERE / "real_auth_fixture.py"), *args], capture_output=True, text=True, env=os.environ)


def leftovers(label: str) -> list[str]:
    out = []
    for kind in ("ps -a", "network ls"):
        r = fx.docker(*kind.split(), "--filter", f"label={fx.LABEL}={label}", "--format", "{{.Names}}")
        out += [f"{kind.split()[0]}:{n}" for n in r.stdout.split()]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jwt-exp", default=str(fx.JWT_EXP_DEFAULT))
    ap.add_argument("--full", action="store_true", help="run the whole backend suite, no -run filter and no -skip")
    ap.add_argument("--race", action="store_true", help="run with the race detector")
    args = ap.parse_args()
    if not fx.JOSE_UTIL.is_file():
        r = helper("build-jose-util")
        if r.returncode:
            print(r.stdout + r.stderr, file=sys.stderr)
            return 1
    up = helper("up", "--jwt-exp", args.jwt_exp)
    try:
        facts = json.loads(up.stdout)
    except ValueError:
        print("fixture start produced no report:", up.stderr[-500:], file=sys.stderr)
        return 1
    label, runtime_dir = facts.get("label"), facts.get("runtime_directory")
    if up.returncode or facts.get("state") != "running":
        print(json.dumps({k: facts.get(k) for k in ("label", "state", "failure", "cleanup")}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({k: facts[k] for k in ("label", "auth_base_url", "containers", "networks")}), flush=True)
    code = 1
    c = Cluster().start()
    try:
        pw = c.new_password()
        c.psql(f"CREATE ROLE aya_gotest LOGIN SUPERUSER PASSWORD '{pw}'")  # ephemeral, exists only in this cluster
        c.create_database("aya_gotest_db")
        env = dict(os.environ, AYA_TEST_DATABASE_URL=f"postgres://aya_gotest:{pw}@127.0.0.1:{c.port}/aya_gotest_db?sslmode=disable",
                   AYA_REAL_AUTH_FIXTURE=facts["fixture_env"],
                   AYA_TEST_EXPO_FIXTURES_DIR=str(REPO / "infra" / "catalog" / "authoritative-expo-fixtures"))
        cmd = ["go", "test", "-count=1", "-v", *(["-race"] if args.race else []), *([] if args.full else ["-run", PATTERN]), "./..."]
        r = subprocess.run(cmd, cwd=REPO / "backend", env=env, capture_output=True, text=True)
        text = (r.stdout + r.stderr).replace(pw, "[redacted]")
        passed = sorted(set(re.findall(r"^--- PASS: (\S+)", text, re.M)))
        failed = sorted(set(re.findall(r"^--- FAIL: (\S+)", text, re.M)))
        skipped = sorted(set(re.findall(r"^\s*--- SKIP: (\S+)", text, re.M)))
        real = [t for t in passed if re.search(PATTERN, t)]
        keep = r"^(--- (FAIL|SKIP)|\s+--- (FAIL|SKIP)|ok |FAIL|panic)" if args.full else r"^(--- (PASS|FAIL|SKIP)|ok |FAIL|panic)"
        print("\n".join(l for l in text.splitlines() if re.match(keep, l)))
        top = len(re.findall(r"^--- PASS: ", text, re.M))
        subs = len(re.findall(r"^\s+--- PASS: ", text, re.M))
        print(f"{'full suite' if args.full else 'real-GoTrue tests'}{' (race)' if args.race else ''}: passed={len(passed)} "
              f"(top-level {top}, subtests {subs}) failed={len(failed)} skipped={len(skipped)} real-GoTrue passed={len(real)} go test exit={r.returncode}")
        code = 0 if r.returncode == 0 and len(real) == 6 and not failed and not (args.full and skipped) else 1
        if code and r.returncode == 0:
            print(f"expected exactly 6 passing real-GoTrue tests and no skip, saw {len(real)} real, skipped={skipped}", file=sys.stderr)
    finally:
        c.stop()
        down = helper("down", runtime_dir)
        try:
            report = json.loads(down.stdout)
        except ValueError:
            report = {"error": down.stderr[-300:]}
        left = leftovers(label)
        print("fixture cleanup:", json.dumps({"exit": down.returncode, "runtime_directory_removed": report.get("runtime_directory_removed"),
                                              "leftover_files": report.get("leftover_files"), "docker_leftovers": left,
                                              "containers": report.get("cleanup", {}).get("containers"),
                                              "networks": report.get("cleanup", {}).get("networks")}))
        if down.returncode or left:
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
