"""Both backends against ONE disposable cluster in two separate databases: neither may reach, migrate into, or be confused
with the other. Needs both clones (INFRA_PEER_CLONE, default: the sibling clone). Missing peer = failure, never a skip."""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
from common import REPO, go_build, local_manifest, private_file, sha256_file, write_json  # noqa: E402
from pgtest import PG_BIN, Cluster  # noqa: E402

UMAR_ROOT = REPO if (REPO / "backend-umar").is_dir() else Path(os.environ.get("INFRA_PEER_CLONE", REPO.parent / "infrastructure-readiness"))
AYA_ROOT = REPO if (REPO / "backend").is_dir() and not (REPO / "backend-umar").is_dir() else Path(
    os.environ.get("INFRA_PEER_CLONE", REPO.parent / "ayangaji-readiness"))
T_UMAR, T_AYA = UMAR_ROOT / "infra/supabase/supabase_target.py", AYA_ROOT / "infra/supabase/supabase_target.py"


def tool(path: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(path), *args, "--allow-local-test"], capture_output=True, text=True,
                          env={"PATH": "/usr/bin:/bin"}, timeout=300)


class CrossApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert T_UMAR.is_file() and T_AYA.is_file(), "both clones are required: set INFRA_PEER_CLONE"
        cls.c = c = Cluster().start()
        cls.pw = {r: c.new_password() for r in ("umar_migrator", "umar_runtime", "aya_migrator", "aya_runtime")}
        cls.umar_migrate = go_build(UMAR_ROOT / "backend-umar", c.root / "umar-migrate", "./cmd/migrate")
        cls.aya_migrate = go_build(AYA_ROOT / "backend", c.root / "aya-migrate", "./cmd/ayailmu-migrate")
        for db in ("umar_t", "aya_t"):
            c.create_database(db)
            c.psql(f"REVOKE ALL ON DATABASE {db} FROM PUBLIC", db=db)
        files = {r: c.write_secret(f"{r}.pw", p) for r, p in cls.pw.items()}
        c.psql(file=str(UMAR_ROOT / "infra/supabase/sql/umar/owner-bootstrap.sql.template"), db="umar_t", variables={
            "migration_role": "umar_migrator", "runtime_role": "umar_runtime",
            "migration_password_file": str(files["umar_migrator"]), "runtime_password_file": str(files["umar_runtime"])})
        c.psql(file=str(AYA_ROOT / "infra/supabase/sql/ayangaji/owner-bootstrap.sql.template"), db="aya_t", variables={
            "database": "aya_t", "schema": "ayailmu", "migration_role": "aya_migrator", "runtime_role": "aya_runtime",
            "provisioning_session_protected": "on",
            "migration_password_file": str(files["aya_migrator"]), "runtime_password_file": str(files["aya_runtime"])})
        c.psql("GRANT CONNECT ON DATABASE umar_t TO umar_migrator, umar_runtime", db="umar_t")
        sec = c.root / "secrets"
        cls.umar_manifest = write_json(c.root / "umar.json", local_manifest("umar", sec, c.ca, c.port, "umar_t", "public", "umar_migrator", "umar_runtime"))
        cls.aya_manifest = write_json(c.root / "aya.json", local_manifest("ayangaji", sec, c.ca, c.port, "aya_t", "ayailmu", "aya_migrator", "aya_runtime"))
        for app, db in (("umar", "umar_t"), ("ayangaji", "aya_t")):
            pre = "umar" if app == "umar" else "aya"
            private_file(sec / f"{app}-migration.dsn", c.dsn(f"{pre}_migrator", cls.pw[f"{pre}_migrator"], db))
            private_file(sec / f"{app}-runtime.dsn", c.dsn(f"{pre}_runtime", cls.pw[f"{pre}_runtime"], db))

    @classmethod
    def tearDownClass(cls):
        root = cls.c.root
        cls.c.stop()
        assert not root.exists()

    def assertNoSecret(self, *texts):
        for t in texts:
            for p in self.pw.values():
                self.assertNotIn(p, t)

    def test_01_tool_copies_are_byte_identical(self):
        self.assertEqual(sha256_file(T_UMAR), sha256_file(T_AYA))
        for name in ("common.py", "pgtest.py", "test_manifest.py", "test_review_regressions.py", "test_cross_app.py"):
            self.assertEqual(sha256_file(UMAR_ROOT / "infra/supabase/tests" / name), sha256_file(AYA_ROOT / "infra/supabase/tests" / name), name)

    def test_02_each_wrapper_migrates_only_its_own_database(self):
        r = tool(T_UMAR, "migrate", str(self.umar_manifest), "--migrate-bin", str(self.umar_migrate), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = tool(T_AYA, "migrate", str(self.aya_manifest), "--migrate-bin", str(self.aya_migrate), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)
        c = self.c
        # Disjoint data models: no adult table in Umar's database and no guardian/child table in the adult database.
        self.assertEqual(c.scalar("SELECT count(*) FROM pg_namespace WHERE nspname='ayailmu'", "umar_t"), "0")
        self.assertEqual(c.scalar("SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'", "aya_t") or "", "")
        self.assertEqual(c.scalar("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('learners','sync_consents','answer_events','pack_versions')", "umar_t"), "4")
        self.assertEqual(c.scalar("SELECT count(*) FROM pg_class WHERE relnamespace='ayailmu'::regnamespace AND relname IN ('learners','sync_consents','answer_events','pack_versions')", "aya_t"), "0")
        self.assertEqual(c.scalar("SELECT count(*) FROM pg_class WHERE relnamespace='ayailmu'::regnamespace AND relname IN ('profiles','events')", "aya_t"), "2")

    def test_03_credentials_do_not_cross_databases(self):
        c = self.c
        for role, db in (("umar_runtime", "aya_t"), ("umar_migrator", "aya_t"), ("aya_runtime", "umar_t"), ("aya_migrator", "umar_t")):
            r = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-A", "-t", "-c", "SELECT 1",
                                f"host=localhost port={c.port} dbname={db} user={role} sslmode=verify-full sslrootcert={c.ca}"],
                               env={"PATH": "/usr/bin", "PGPASSWORD": self.pw[role]}, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, (role, db))
            self.assertIn("permission denied for database", r.stderr)

    def test_04_wrong_binary_with_right_credentials_creates_nothing(self):
        c = self.c
        before = {db: c.scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=relnamespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')", db)
                  for db in ("umar_t", "aya_t")}
        # Umar's migrator on the adult database / the adult migrator on Umar's database, via the *other* app's binary.
        env_umar = {"PATH": "/usr/bin", "UMAR_DATABASE_URL": (self.c.root / "secrets/ayangaji-migration.dsn").read_text().strip()}
        r = subprocess.run([str(self.umar_migrate)], env=env_umar, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, "Umar migration binary ran against the adult database")
        env_aya = {"PATH": "/usr/bin", "AYA_DATABASE_URL_FILE": str(self.c.root / "secrets/umar-migration.dsn"),
                   "AYA_DB_HOSTS": "localhost", "AYA_DB_SCHEMA": "ayailmu"}
        r2 = subprocess.run([str(self.aya_migrate)], env=env_aya, capture_output=True, text=True)
        self.assertNotEqual(r2.returncode, 0, "adult migration binary ran against the Umar database")
        for out in (r, r2):
            self.assertNoSecret(out.stdout, out.stderr)
        after = {db: c.scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=relnamespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')", db)
                 for db in ("umar_t", "aya_t")}
        self.assertEqual(before, after)

    def test_05_wrappers_refuse_each_others_credentials(self):
        a_dsn = str(self.c.root / "secrets/ayangaji-migration.dsn")
        r = tool(T_UMAR, "dsn-check", str(self.umar_manifest), "--role", "migration", "--dsn-file", a_dsn)
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-user", r.stderr)
        self.assertIn("REFUSED dsn-target", r.stderr)
        u_dsn = str(self.c.root / "secrets/umar-runtime.dsn")
        r = tool(T_AYA, "dsn-check", str(self.aya_manifest), "--role", "runtime", "--dsn-file", u_dsn)
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-target", r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)

    def test_06_both_verify_independently(self):
        for t, m, role in ((T_UMAR, self.umar_manifest, "migration"), (T_AYA, self.aya_manifest, "migration")):
            r = tool(t, "verify", str(m), "--role", role, "--psql-path", str(PG_BIN), "--execute")
            self.assertNotIn("FAIL must.migration_role", r.stdout)
            self.assertIn("ok   must.tls_in_use", r.stdout)
            self.assertNoSecret(r.stdout, r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
