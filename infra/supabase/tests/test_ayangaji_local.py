"""Ayangaji (adult backend) lifecycle against a fresh, disposable loopback PostgreSQL with TLS (real binaries, no mocks).

Mirrors the Umar lifecycle test for the adult store: separate schema owned by the migration role, DML-only runtime role,
simulated Supabase Data-API roles, wrapper dry-run/execute, repeatability, the real deploy-smoke API binary, and a cross-check
of the rendered production-staging environment against the application's real config loader. Known gaps in the adult
store (no TLS enforcement, no runtime-privilege self-check) are asserted as *current behavior* and named test_known_gap_*.
"""
from __future__ import annotations

import copy
import json
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import supabase_target as tool  # noqa: E402
from common import REPO, go_build, local_manifest, mutate, private_file, run_tool, supabase_manifest, write_json  # noqa: E402
from pgtest import PG_BIN, Cluster  # noqa: E402

SQL = REPO / "infra" / "supabase" / "sql" / "ayangaji"
MIG, RUN, DB, SCHEMA = "aya_migrator", "aya_runtime", "aya_t", "ayailmu"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AyangajiLocal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = c = Cluster().start()
        cls.root = c.root
        bin_dir = c.root / "bin"
        bin_dir.mkdir()
        cls.migrate_bin = go_build(REPO / "backend", bin_dir / "ayailmu-migrate", "./cmd/ayailmu-migrate")
        cls.api_bin = go_build(REPO / "backend", bin_dir / "ayailmu-api", "./cmd/ayailmu-api")
        cls.mig_pw, cls.run_pw = c.new_password(), c.new_password()
        c.psql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN")
        c.create_database(DB)
        c.psql(f"REVOKE ALL ON DATABASE {DB} FROM PUBLIC", db=DB)
        cls.mig_pwfile = c.write_secret("mig.pw", cls.mig_pw)
        cls.run_pwfile = c.write_secret("run.pw", cls.run_pw)
        cls.manifest = write_json(c.root / "aya-local.json", local_manifest("ayangaji", c.root / "secrets", c.ca, c.port, DB, SCHEMA, MIG, RUN))
        for role, pw, kind in ((MIG, cls.mig_pw, "migration"), (RUN, cls.run_pw, "runtime")):
            private_file(c.root / "secrets" / f"ayangaji-{kind}.dsn", c.dsn(role, pw, DB))

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

    def verify(self, role):
        return self.tool("verify", str(self.manifest), "--role", role, "--psql-path", str(PG_BIN), "--execute")

    def snapshot(self) -> str:
        return self.c.scalar(f"SELECT md5(string_agg(t::text||xmin::text, ',' ORDER BY version)) FROM {SCHEMA}.schema_migrations t", DB)

    # 01 ------------------------------------------------------------------------------------------------------------------
    def test_01_owner_bootstrap_template(self):
        r = self.c.psql(file=str(SQL / "owner-bootstrap.sql.template"), db=DB, variables={
            "database": DB, "schema": SCHEMA, "migration_role": MIG, "runtime_role": RUN,
            "migration_password_file": str(self.mig_pwfile), "runtime_password_file": str(self.run_pwfile)})
        self.assertNoSecret(r.stdout, r.stderr)
        got = self.c.scalar(f"SELECT string_agg(rolname||':'||(NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolcanlogin AND NOT rolinherit)::text, ',' ORDER BY rolname) "
                            f"FROM pg_roles WHERE rolname IN ('{MIG}','{RUN}')")
        self.assertEqual(got, f"{MIG}:true,{RUN}:true")
        self.assertEqual(self.c.scalar(f"SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='{SCHEMA}'", DB), MIG)
        self.assertEqual(self.c.scalar(f"SELECT has_database_privilege('{RUN}','{DB}','CREATE')", DB), "f")
        self.assertEqual(self.c.scalar(f"SELECT has_schema_privilege('{RUN}','{SCHEMA}','CREATE')", DB), "f")
        # Simulated Supabase worst case: future tables of the migration role in this schema would be exposed to the Data API roles.
        self.c.psql(f"ALTER DEFAULT PRIVILEGES FOR ROLE {MIG} IN SCHEMA {SCHEMA} GRANT ALL ON TABLES TO anon, authenticated, service_role", db=DB)

    # 02 ------------------------------------------------------------------------------------------------------------------
    def test_02_dry_run_opens_no_connection(self):
        before = self.c.connection_count(MIG)
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DRY RUN (no connection opened)", r.stdout)
        v = self.tool("verify", str(self.manifest), "--role", "migration", "--psql-path", str(PG_BIN))
        self.assertIn("DRY RUN (no connection opened)", v.stdout)
        time.sleep(0.3)
        self.assertEqual(self.c.connection_count(MIG), before)
        self.assertEqual(self.c.scalar(f"SELECT to_regclass('{SCHEMA}.schema_migrations') IS NULL", DB), "t")

    # 03 ------------------------------------------------------------------------------------------------------------------
    def test_03_execute_migrates_once_as_migration_role(self):
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.splitlines()[0], "3", r.stdout)  # the job prints only the schema version
        self.assertNoSecret(r.stdout, r.stderr)
        owners = self.c.scalar(f"SELECT string_agg(DISTINCT pg_get_userbyid(relowner),',') FROM pg_class c JOIN pg_namespace n ON n.oid=relnamespace "
                               f"WHERE nspname='{SCHEMA}' AND relkind IN ('r','S','p')", DB)
        self.assertEqual(owners, MIG)
        self.assertEqual(self.c.scalar(f"SELECT string_agg(version::text, ',' ORDER BY version) FROM {SCHEMA}.schema_migrations", DB), "1,2,3")
        self.assertEqual(self.c.scalar("SELECT count(*) FROM pg_namespace WHERE nspname='public' AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace=pg_namespace.oid AND c.relkind='r')", DB), "0",
                         "adult tables must not appear in public")

    # 04 ------------------------------------------------------------------------------------------------------------------
    def test_04_second_run_is_a_no_op(self):
        first = self.snapshot()
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.splitlines()[0], "3")
        self.assertEqual(self.snapshot(), first, "migration history rows changed on re-run")

    # 05 ------------------------------------------------------------------------------------------------------------------
    def test_05_simulated_data_api_exposure_is_detected_then_hardened(self):
        r = self.verify("migration")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("FAIL must.api_roles_have_no_relation_privileges", r.stdout)
        self.assertIn("FAIL must.default_acls_do_not_expose", r.stdout)
        out = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", f"schema={SCHEMA}",
                              "-f", str(SQL / "hardening.sql.template"),
                              f"host=localhost port={self.c.port} dbname={DB} user={MIG} sslmode=verify-full sslrootcert={self.c.ca}"],
                             env={"PATH": "/usr/bin", "PGPASSWORD": self.mig_pw}, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.c.scalar(f"SELECT has_table_privilege('anon','{SCHEMA}.accounts','SELECT')", DB), "f")
        # Hardening must not have removed the runtime role's legitimate rights.
        self.assertEqual(self.c.scalar(f"SELECT has_table_privilege('{RUN}','{SCHEMA}.accounts','SELECT,INSERT,UPDATE,DELETE')", DB), "t")

    # 06 ------------------------------------------------------------------------------------------------------------------
    def test_06_regrant_template_is_idempotent_and_full_verification_passes(self):
        out = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", f"schema={SCHEMA}", "-v", f"runtime_role={RUN}",
                              "-f", str(SQL / "runtime-grants.sql.template"),
                              f"host=localhost port={self.c.port} dbname={DB} user={MIG} sslmode=verify-full sslrootcert={self.c.ca}"],
                             env={"PATH": "/usr/bin", "PGPASSWORD": self.mig_pw}, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        for role in ("migration", "runtime"):
            v = self.verify(role)
            self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
            self.assertNotIn("FAIL", v.stdout)
            self.assertIn("ok   must.runtime_has_dml_but_no_ddl", v.stdout)
            self.assertIn("ok   must.tls_in_use", v.stdout)
            self.assertNoSecret(v.stdout, v.stderr)
        self.assertEqual(self.c.scalar(f"SELECT has_table_privilege('{RUN}','{SCHEMA}.accounts','TRUNCATE')", DB), "f")

    # 07 ------------------------------------------------------------------------------------------------------------------
    def serve(self, dsn_file: Path, expect_ready=True):
        port = free_port()
        log = open(self.root / f"api-{port}.log", "w+")
        self.addCleanup(log.close)
        env = {"PATH": "/usr/bin:/bin", "AYA_MODE": "deploy-smoke", "AYA_LISTEN": f"127.0.0.1:{port}",
               "AYA_ALLOWED_HOSTS": "api.ayangaji-fixture.net", "AYA_DB_HOSTS": "localhost",
               "AYA_DATABASE_URL_FILE": str(dsn_file), "AYA_DB_SCHEMA": SCHEMA}
        proc = subprocess.Popen([str(self.api_bin)], env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL)
        self.addCleanup(lambda: (proc.terminate(), proc.wait(timeout=10)) if proc.poll() is None else None)
        body = None
        for _ in range(60):
            if proc.poll() is not None:
                break
            try:
                body = urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/readyz", timeout=2).read().decode()
                break
            except OSError:
                time.sleep(0.25)
        proc.terminate()
        proc.wait(timeout=10)
        log.seek(0)
        return body, log.read()

    def test_07_restricted_runtime_serves_readiness(self):
        body, log = self.serve(self.root / "secrets" / "ayangaji-runtime.dsn")
        self.assertIsNotNone(body, log)
        self.assertEqual(json.loads(body), {"status": "ready"})
        self.assertNoSecret(log)
        self.assertEqual(self.c.scalar(f"SELECT string_agg(version::text, ',' ORDER BY version) FROM {SCHEMA}.schema_migrations", DB), "1,2,3")

    def test_08_wrapper_refuses_the_migration_credential_in_the_runtime_slot(self):
        r = run_tool("dsn-check", str(self.manifest), "--role", "runtime", "--allow-local-test",
                     "--dsn-file", str(self.root / "secrets" / "ayangaji-migration.dsn"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-user", r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)

    def test_12_migration_needs_database_create_even_when_the_schema_exists(self):
        # Backs the owner-bootstrap template's comment: CREATE SCHEMA IF NOT EXISTS checks database CREATE first.
        self.c.psql(f"REVOKE CREATE ON DATABASE {DB} FROM {MIG}", db=DB)
        try:
            r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
            self.assertNotEqual(r.returncode, 0, r.stdout)
            self.assertNoSecret(r.stdout, r.stderr)
        finally:
            self.c.psql(f"GRANT CREATE ON DATABASE {DB} TO {MIG}", db=DB)
        r = self.tool("migrate", str(self.manifest), "--migrate-bin", str(self.migrate_bin), "--execute")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_known_gap_api_accepts_owner_privileged_database_user(self):
        # KNOWN GAP (reported, not fixed here): unlike Umar, the adult API verifies only the schema version at startup and
        # never checks its own effective privileges, so only the wrapper's DSN user check and `verify` guard least privilege.
        body, log = self.serve(self.root / "secrets" / "ayangaji-migration.dsn")
        self.assertEqual(json.loads(body), {"status": "ready"}, log)

    def test_09_weak_tls_is_refused_by_the_wrapper(self):
        weak = (self.root / "secrets" / "ayangaji-migration.dsn").read_text().replace("verify-full", "require").strip()
        private_file(self.root / "secrets" / "ayangaji-weak.dsn", weak)
        r = self.tool("dsn-check", str(self.manifest), "--role", "migration", "--dsn-file", str(self.root / "secrets" / "ayangaji-weak.dsn"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-sslmode", r.stderr)
        self.assertNoSecret(r.stdout, r.stderr)

    def test_known_gap_adult_store_accepts_plaintext_to_a_named_host(self):
        # KNOWN GAP (reported, not fixed here): Umar rejects a non-loopback host without sslmode=verify-full before dialing
        # (internal/store/transport.go). The adult OpenAllowing path only checks the host allow-list, so this unmodified
        # migration binary completes over plaintext to the allow-listed *name* localhost. A Supabase target therefore relies
        # on this wrapper (dsn-check) and cannot be called deployable until the store enforces TLS itself.
        plain = (self.root / "secrets" / "ayangaji-migration.dsn").read_text().strip().split("?")[0] + "?sslmode=disable"
        f = private_file(self.root / "secrets" / "ayangaji-plain.dsn", plain)
        env = {"PATH": "/usr/bin", "AYA_DATABASE_URL_FILE": str(f), "AYA_DB_HOSTS": "localhost", "AYA_DB_SCHEMA": SCHEMA}
        out = subprocess.run([str(self.migrate_bin)], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.strip(), "3")
        self.assertNoSecret(out.stdout, out.stderr)
        r = self.tool("dsn-check", str(self.manifest), "--role", "migration", "--dsn-file", str(f))
        self.assertIn("REFUSED dsn-sslmode", r.stderr)

    # 10 ------------------------------------------------------------------------------------------------------------------
    def test_10_database_and_role_isolation(self):
        c = self.c
        c.create_database("decoy_t")
        c.psql("REVOKE ALL ON DATABASE decoy_t FROM PUBLIC; CREATE TABLE decoy_secret(v int)", db="decoy_t")
        denied = subprocess.run([str(PG_BIN / "psql"), "-X", "-q", "-A", "-t", "-c", "SELECT 1",
                                 f"host=localhost port={c.port} dbname=decoy_t user={RUN} sslmode=verify-full sslrootcert={c.ca}"],
                                env={"PATH": "/usr/bin", "PGPASSWORD": self.run_pw}, capture_output=True, text=True)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn("permission denied for database", denied.stderr)
        for sql in (f"CREATE TABLE {SCHEMA}.nope(v int)", f"CREATE SCHEMA nope", f"TRUNCATE {SCHEMA}.accounts",
                    f"ALTER TABLE {SCHEMA}.accounts ADD COLUMN z int", f"DROP TABLE {SCHEMA}.events", "CREATE TABLE public.nope(v int)"):
            r = c.psql(sql, db=DB, user=RUN, check=False)
            self.assertNotEqual(r.returncode, 0, sql)
            self.assertTrue("permission denied" in r.stderr or "must be owner" in r.stderr, (sql, r.stderr))
        # The application's own work stays possible: DML inside a transaction that is rolled back.
        ok = c.psql(f"BEGIN; SELECT count(*) FROM {SCHEMA}.accounts; DELETE FROM {SCHEMA}.accounts; ROLLBACK", db=DB, user=RUN, check=False)
        self.assertEqual(ok.returncode, 0, ok.stderr)

    # 11 ------------------------------------------------------------------------------------------------------------------
    def test_11_rendered_staging_environment_matches_the_real_config_loader(self):
        base = self.root / "staging"
        base.mkdir(mode=0o700)
        ca = self.c.ca
        doc = supabase_manifest("ayangaji", base, ca)
        private_file(Path(doc["secrets"]["runtime_dsn_file"]),
                     f"postgres://{doc['roles']['runtime']}:{self.c.new_password()}@{doc['database']['host']}:5432/postgres?sslmode=verify-full&sslrootcert={ca}")
        private_file(Path(doc["secrets"]["admin_key_file"]), self.c.new_password())
        self.assertEqual(tool.validate(doc).items, [])
        env = tool.render_env(doc, "runtime")
        cases = [{"name": "rendered_ok", "env": env, "expect": "ok"}]

        def case(name, manifest_edit, env_edit):
            m = copy.deepcopy(doc)
            manifest_edit(m)
            self.assertTrue(tool.validate(m).items, f"validator accepted mutation {name}")  # validator refuses ...
            e = dict(env)
            env_edit(e)
            cases.append({"name": name, "env": e, "expect": "refuse"})  # ... and so must the real loader

        def setpath(dotted, value):
            def edit(m):
                cur = m
                *head, last = dotted.split(".")
                for p in head:
                    cur = cur[p]
                cur[last] = value
            return edit

        case("cors_origins_empty", setpath("runtime.cors_origins", []), lambda e: e.pop("AYA_CORS_ORIGINS"))
        case("cors_origin_http", setpath("runtime.cors_origins", ["http://app.ayangaji-fixture.net"]), lambda e: e.update(AYA_CORS_ORIGINS="http://app.ayangaji-fixture.net"))
        case("trusted_proxy_loopback", setpath("runtime.trusted_proxies", ["127.0.0.1"]), lambda e: e.update(AYA_TRUSTED_PROXIES="127.0.0.1"))
        case("trusted_proxy_cidr", setpath("runtime.trusted_proxies", ["203.0.113.0/24"]), lambda e: e.update(AYA_TRUSTED_PROXIES="203.0.113.0/24"))
        case("allowed_host_test_tld", setpath("runtime.allowed_hosts", ["api.fixture.test"]), lambda e: e.update(AYA_ALLOWED_HOSTS="api.fixture.test"))
        case("listen_private_ip", setpath("runtime.listen", "10.0.0.5:8080"), lambda e: e.update(AYA_LISTEN="10.0.0.5:8080"))
        case("auth_url_http", setpath("auth.supabase_url", "http://auth.ayangaji-fixture.net"), lambda e: e.update(AYA_SUPABASE_URL="http://auth.ayangaji-fixture.net"))
        case("auth_url_wrong_port", setpath("auth.supabase_url", "https://auth.ayangaji-fixture.net:8443"), lambda e: e.update(AYA_SUPABASE_URL="https://auth.ayangaji-fixture.net:8443"))
        case("auth_url_ip", setpath("auth.supabase_url", "https://203.0.113.5"), lambda e: e.update(AYA_SUPABASE_URL="https://203.0.113.5"))
        case("schema_public", setpath("database.schema", "public"), lambda e: e.update(AYA_DB_SCHEMA="public"))
        case("deployment_env_missing", lambda m: m.update(status="example"), lambda e: e.pop("AYA_DEPLOYMENT_ENV"))
        # Other-mode settings must be refused rather than ignored.
        case("emulator_variable_present", lambda m: m.update(status="example"), lambda e: e.update(FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"))
        # Host mismatch between the DSN and AYA_DB_HOSTS.
        case("db_host_not_listed", setpath("database.host", "db.otherprojectreferenc.supabase.co"), lambda e: e.update(AYA_DB_HOSTS="db.otherprojectreferenc.supabase.co"))
        cases_path = self.root / "staging-cases.json"
        cases_path.write_text(json.dumps(cases))
        env_go = dict(__import__("os").environ, INFRA_STAGING_CASES=str(cases_path))
        r = subprocess.run(["go", "test", "-count=1", "-v", "-tags", "infra_staging", "./infra/stagingenv/"], cwd=REPO / "backend", env=env_go, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-1500:])
        self.assertEqual(r.stdout.count("--- PASS: TestRenderedStagingEnvironmentAgainstTheRealLoader/"), len(cases), r.stdout)
        # Known gap, checked here as current behavior: the real loader accepts a DSN with sslmode=disable for a named host.
        weak = Path(doc["secrets"]["runtime_dsn_file"]).read_text().replace("verify-full", "disable")
        wf = private_file(base / "weak.dsn", weak.strip())
        self.assertEqual(tool.dsn_check(doc, "runtime", str(wf))[0].items[0]["code"], "dsn-sslmode")
        weak_case = [{"name": "dsn_plaintext_accepted_by_loader", "env": dict(env, AYA_DATABASE_URL_FILE=str(wf)), "expect": "ok"}]
        cases_path.write_text(json.dumps(weak_case))
        r = subprocess.run(["go", "test", "-count=1", "-tags", "infra_staging", "./infra/stagingenv/"], cwd=REPO / "backend", env=dict(env_go, INFRA_STAGING_CASES=str(cases_path)),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:])


if __name__ == "__main__":
    unittest.main(verbosity=2)
