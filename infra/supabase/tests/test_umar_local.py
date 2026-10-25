"""Umar lifecycle against a fresh, disposable loopback PostgreSQL with TLS (real binaries, no mocks).

Covers: owner-bootstrap template, wrapper dry-run (provably no connection), one-shot migration + repeatability, simulated
Supabase Data-API exposure then hardening, runtime grants, readiness verification, the real restricted API binary, fail-closed
negatives (owner-privileged runtime, weak TLS) and database/role isolation. The cluster mimics Supabase *roles/ACLs* but is
plain PostgreSQL 16; it proves tooling and fail-closed behavior, not Supabase itself.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
from common import REPO, go_build, local_manifest, private_file, run_tool, write_json  # noqa: E402
from pgtest import PG_BIN, Cluster  # noqa: E402

SQL = REPO / "infra" / "supabase" / "sql" / "umar"
MIG, RUN, DB = "umar_migrator", "umar_runtime", "umar_t"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class UmarLocal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = Cluster().start()
        c = cls.c
        cls.root = c.root
        cls.bin = c.root / "bin"
        cls.bin.mkdir()
        cls.migrate_bin = go_build(REPO / "backend-umar", cls.bin / "umar-migrate", "./cmd/migrate")
        cls.server_bin = go_build(REPO / "backend-umar", cls.bin / "umar-api", "./cmd/server")
        cls.mig_pw, cls.run_pw = c.new_password(), c.new_password()
        # Simulate the Supabase role/ACL environment: Data API roles exist, public has permissive default privileges, and
        # (worst case) the future migration role would inherit the same default exposure.
        c.psql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN")
        c.create_database(DB)
        c.psql("REVOKE ALL ON DATABASE umar_t FROM PUBLIC", db=DB)
        c.psql("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
               "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;"
               "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role", db=DB)
        cls.mig_pwfile = c.write_secret("mig.pw", cls.mig_pw)
        cls.run_pwfile = c.write_secret("run.pw", cls.run_pw)
        cls.manifest = write_json(c.root / "umar-local.json", local_manifest("umar", c.root / "secrets", c.ca, c.port, DB, "public", MIG, RUN))
        for role, pw, kind in ((MIG, cls.mig_pw, "migration"), (RUN, cls.run_pw, "runtime")):
            private_file(c.root / "secrets" / f"umar-{kind}.dsn", c.dsn(role, pw, DB))

    @classmethod
    def tearDownClass(cls):
        root = cls.root
        cls.c.stop()
        assert not root.exists(), "disposable cluster directory must be gone"

    def tool(self, *args, **kw):
        return run_tool(*args, "--allow-local-test", **kw)

    def assertNoSecret(self, *texts):
        for t in texts:
            for secret in (self.mig_pw, self.run_pw):
                self.assertNotIn(secret, t)

    # 01 ------------------------------------------------------------------------------------------------------------------
    def test_01_owner_bootstrap_template_creates_plain_roles(self):
        env_script = (f'MIGRATION_PW_FILE={self.mig_pwfile} RUNTIME_PW_FILE={self.run_pwfile}')
        self.assertIn("migration_password_file", (SQL / "owner-bootstrap.sql.template").read_text())
        r = self.c.psql(file=str(SQL / "owner-bootstrap.sql.template"), db=DB, variables={
            "migration_role": MIG, "runtime_role": RUN, "migration_password_file": str(self.mig_pwfile),
            "runtime_password_file": str(self.run_pwfile)})
        self.assertNoSecret(r.stdout, r.stderr)
        got = self.c.scalar(f"SELECT string_agg(rolname||':'||(NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolcanlogin AND NOT rolinherit)::text, ',' ORDER BY rolname) "
                            f"FROM pg_roles WHERE rolname IN ('{MIG}','{RUN}')")
        self.assertEqual(got, f"{MIG}:true,{RUN}:true")
        self.assertEqual(self.c.scalar(f"SELECT has_schema_privilege('{RUN}','public','CREATE')", DB), "f")
        self.assertEqual(self.c.scalar(f"SELECT has_schema_privilege('{MIG}','public','CREATE')", DB), "t")
        self.assertEqual(self.c.scalar(f"SELECT has_database_privilege('{RUN}','{DB}','CONNECT')", DB), "f")
        self.c.psql(f'GRANT CONNECT ON DATABASE "{DB}" TO {MIG}, {RUN}')  # per-database CONNECT is an owner decision too
        # And a Supabase-like worst case: the migration role's own future tables would be exposed to the Data API roles.
        self.c.psql(f"ALTER DEFAULT PRIVILEGES FOR ROLE {MIG} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role", db=DB)

    # 02 ------------------------------------------------------------------------------------------------------------------
    def test_02_dry_run_opens_no_connection(self):
        before = self.c.connection_count(MIG)
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DRY RUN (no connection opened)", r.stdout)
        time.sleep(0.3)
        self.assertEqual(self.c.connection_count(MIG), before)
        self.assertEqual(self.c.scalar("SELECT to_regclass('public.schema_migrations') IS NULL", DB), "t")
        r = self.tool("verify", str(self.manifest), "--role", "migration", "--psql-path", str(PG_BIN))
        self.assertIn("DRY RUN (no connection opened)", r.stdout)
        self.assertEqual(self.c.connection_count(MIG), before)

    # 03 ------------------------------------------------------------------------------------------------------------------
    def test_03_execute_migrates_once_as_migration_role(self):
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("schema and registry verified", r.stdout + r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)
        self.assertGreaterEqual(self.c.connection_count(MIG), 1)
        owners = self.c.scalar("SELECT string_agg(DISTINCT pg_get_userbyid(relowner),',') FROM pg_class c JOIN pg_namespace n ON n.oid=relnamespace "
                               "WHERE nspname='public' AND relkind IN ('r','S','p')", DB)
        self.assertEqual(owners, MIG)
        self.assertEqual(self.c.scalar("SELECT count(*) FROM schema_migrations", DB), "1")
        self.assertGreater(int(self.c.scalar("SELECT count(*) FROM pack_versions", DB)), 0)

    def snapshot(self) -> str:
        return self.c.scalar("SELECT md5(string_agg(t::text||xmin::text, ',' ORDER BY version)) FROM schema_migrations t", DB) + "/" + \
            self.c.scalar("SELECT md5(string_agg(p::text||xmin::text, ',' ORDER BY track, content_version)) FROM pack_versions p", DB)

    # 04 ------------------------------------------------------------------------------------------------------------------
    def test_04_second_run_is_a_no_op(self):
        first = self.snapshot()
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.snapshot(), first, "migration history or registry rows changed on re-run")

    # 05 ------------------------------------------------------------------------------------------------------------------
    def verify(self, role):
        return self.tool("verify", str(self.manifest), "--role", role, "--psql-path", str(PG_BIN), "--execute")

    def test_05_simulated_data_api_exposure_is_detected_then_hardened(self):
        r = self.verify("migration")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("FAIL must.api_roles_have_no_relation_privileges", r.stdout)
        self.assertIn("FAIL must.default_acls_do_not_expose", r.stdout)
        self.assertNoSecret(r.stdout, r.stderr)
        # Apply the hardening template as the migration role (owner of the tables), over TLS with its own DSN.
        out = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(SQL / "hardening.sql.template"),
                              f"host=localhost port={self.c.port} dbname={DB} user={MIG} sslmode=verify-full sslrootcert={self.c.ca}"],
                             env={"PATH": "/usr/bin", "PGPASSWORD": self.mig_pw}, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.c.scalar("SELECT has_table_privilege('anon','public.accounts','SELECT')", DB), "f")

    # 06 ------------------------------------------------------------------------------------------------------------------
    def test_06_runtime_grants_then_full_verification(self):
        grants = REPO / "backend-umar" / "deploy" / "runtime-grants.sql"
        r = self.c.psql(file=str(grants), db=DB, variables={"runtime_role": RUN})
        self.assertEqual(r.returncode, 0)
        for role in ("migration", "runtime"):
            v = self.verify(role)
            self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
            self.assertNotIn("FAIL", v.stdout)
            self.assertIn("ok   must.tls_in_use", v.stdout)
            self.assertIn("ok   info.server_major=16", v.stdout)
            self.assertNoSecret(v.stdout, v.stderr)
        # The grants template is exact: runtime can read/insert, but cannot delete, truncate, alter or create.
        sql = {"insert_ok": "SELECT has_table_privilege('umar_runtime','public.answer_events','INSERT')",
               "delete": "SELECT has_table_privilege('umar_runtime','public.answer_events','DELETE')",
               "truncate": "SELECT has_table_privilege('umar_runtime','public.accounts','TRUNCATE')",
               "ddl": "SELECT has_schema_privilege('umar_runtime','public','CREATE')"}
        self.assertEqual({k: self.c.scalar(v, DB) for k, v in sql.items()}, {"insert_ok": "t", "delete": "f", "truncate": "f", "ddl": "f"})

    # 07 ------------------------------------------------------------------------------------------------------------------
    def start_server(self, dsn_kind: str, **extra):
        port = free_port()
        log = open(self.root / f"server-{dsn_kind}-{port}.log", "w+")
        dsn = (self.root / "secrets" / f"umar-{dsn_kind}.dsn").read_text().strip()
        env = {"PATH": "/usr/bin:/bin", "UMAR_DATABASE_URL": dsn, "UMAR_MIGRATE_ON_START": "false", "UMAR_LISTEN": f"127.0.0.1:{port}",
               "UMAR_AUTH_PROVIDER": "gotrue", "UMAR_PUBLIC_ORIGIN": "https://auth.umar-fixture.net",
               "UMAR_OIDC_ISSUER": "https://auth.umar-fixture.net", "UMAR_OIDC_JWKS_URL": "http://127.0.0.1:9/.well-known/jwks.json"} | extra
        proc = subprocess.Popen([str(self.server_bin)], env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL)
        self.addCleanup(log.close)
        self.addCleanup(lambda: (proc.terminate(), proc.wait(timeout=10)) if proc.poll() is None else None)
        return proc, port, log

    def test_07_restricted_runtime_serves_readiness(self):
        proc, port, log = self.start_server("runtime")
        status = None
        for _ in range(60):
            if proc.poll() is not None:
                break
            try:
                status = urllib.request.urlopen(f"http://127.0.0.1:{port}/readyz", timeout=2).status
                break
            except OSError:
                time.sleep(0.25)
        proc.terminate()
        proc.wait(timeout=10)
        log.seek(0)
        text = log.read()
        self.assertEqual(status, 200, text)
        self.assertNoSecret(text)
        # The same binary must not have migrated anything: history is still exactly the one migration.
        self.assertEqual(self.c.scalar("SELECT count(*) FROM schema_migrations", DB), "1")

    # 08 ------------------------------------------------------------------------------------------------------------------
    def test_08_owner_privileged_runtime_fails_closed(self):
        proc, port, log = self.start_server("migration")
        code = proc.wait(timeout=30)
        log.seek(0)
        text = log.read()
        self.assertNotEqual(code, 0)
        self.assertIn("database preparation failed", text)
        self.assertNoSecret(text)

    def test_09_weak_tls_is_refused_by_wrapper_and_by_the_binaries(self):
        weak = (self.root / "secrets" / "umar-migration.dsn").read_text().replace("verify-full", "require").strip()
        private_file(self.root / "secrets" / "umar-weak.dsn", weak)
        r = self.tool("dsn-check", str(self.manifest), "--role", "migration", "--dsn-file", str(self.root / "secrets" / "umar-weak.dsn"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-sslmode", r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)
        # Independent of the wrapper: the unmodified migration binary rejects it before dialing.
        before = self.c.connection_count(MIG)
        out = subprocess.run([str(self.migrate_bin)], env={"PATH": "/usr/bin", "UMAR_DATABASE_URL": weak}, capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("remote database transport validation failed", out.stderr)
        self.assertNoSecret(out.stdout, out.stderr)
        self.assertEqual(self.c.connection_count(MIG), before)

    # 10 ------------------------------------------------------------------------------------------------------------------
    def test_10_database_and_role_isolation(self):
        c = self.c
        c.create_database("decoy_t")
        c.psql("REVOKE ALL ON DATABASE decoy_t FROM PUBLIC; CREATE TABLE decoy_secret(v int); INSERT INTO decoy_secret VALUES (1)", db="decoy_t")
        denied = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-A", "-t", "-c", "SELECT 1",
                                 f"host=localhost port={c.port} dbname=decoy_t user={RUN} sslmode=verify-full sslrootcert={c.ca}"],
                                env={"PATH": "/usr/bin", "PGPASSWORD": self.run_pw}, capture_output=True, text=True)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn("permission denied for database", denied.stderr)
        # Within its own database, the runtime role has no foreign schema access and no DDL.
        for sql in ("CREATE TABLE public.nope(v int)", "DELETE FROM public.accounts", "TRUNCATE public.answer_events",
                    "UPDATE public.accounts SET subject='x'", "ALTER TABLE public.accounts ADD COLUMN z int"):
            r = c.psql(sql, db=DB, user=RUN, check=False)
            self.assertNotEqual(r.returncode, 0, sql)
            self.assertTrue("permission denied" in r.stderr or "must be owner" in r.stderr, (sql, r.stderr))
        self.assertEqual(c.scalar("SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth','ayailmu')", DB), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
