"""Manifest/DSN validator tests. Offline: no database, no network, no real project. Run via run-tests.sh."""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory
from common import (AYA_AUTH_REF, AYA_REF, DELETE, HERE, REPO, UMAR_AUTH_REF, UMAR_REF, mutate, private_file, run_tool,
                    supabase_manifest, write_json)

APP = "umar" if (REPO / "backend-umar").is_dir() else "ayangaji"
EXAMPLE = HERE.parent / "target.example.json"


class Base(unittest.TestCase):
    def setUp(self):
        # Outside the git work tree (secret files must be): a fresh 0700 directory under /tmp.
        self.tmp = Path("/tmp") / f"infra-unit.{secrets.token_hex(6)}"
        self.tmp.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.ca = self.tmp / "supabase-root.pem"
        self.ca.write_text("-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n")
        os.chmod(self.ca, 0o644)
        self.docs = {a: supabase_manifest(a, self.tmp, self.ca) for a in ("umar", "ayangaji")}
        self.doc = self.docs[APP]

    def manifest(self, doc=None, name="m.json") -> str:
        return str(write_json(self.tmp / name, doc or self.doc))

    def validate(self, doc, *extra):
        return run_tool("validate", self.manifest(doc), *extra)

    def assertRefused(self, doc, code, *extra):
        r = self.validate(doc, *extra)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn(f"REFUSED {code} ", r.stderr)
        return r


class ExampleAndComplete(Base):
    def test_example_manifest_is_refused_and_inventoried(self):
        r = run_tool("validate", str(EXAMPLE))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED example-status", r.stderr)
        self.assertIn("REFUSED undecided", r.stderr)
        inv = json.loads(run_tool("inventory", str(EXAMPLE), "--json").stdout)
        want = {"D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11", "D12", "D13", "D14", "D15"}
        self.assertTrue(want <= set(inv["decisions"]), sorted(inv["decisions"]))
        for d, v in inv["decisions"].items():
            self.assertTrue(v["question"] and v["fields"], d)

    def test_example_holds_no_secret_like_value(self):
        text = EXAMPLE.read_text()
        for needle in ("postgres://", "password", "eyJ", "BEGIN "):
            self.assertNotIn(needle, text)
        self.assertEqual(json.loads(text)["app"], APP)

    def test_complete_fixture_validates(self):
        r = self.validate(self.doc)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no connection was made", r.stdout)

    def test_missing_field_is_refused_not_defaulted(self):
        for dotted in ("project.ref", "roles.runtime", "database.tls.root_ca_file", "auth.issuer", "backup.strategy"):
            r = self.validate(mutate(self.doc, dotted, DELETE))
            self.assertEqual(r.returncode, 2, dotted)


class Refusals(Base):
    def test_placeholders(self):
        for value in ("replace-with-real", "<project-ref>", "[YOUR-PASSWORD]", "TODO", "tbd"):
            self.assertRefused(mutate(self.doc, "organization.slug", value), "placeholder")
        self.assertRefused(mutate(self.doc, "backup.strategy", "UNDECIDED:D12"), "undecided")

    def test_connection_path(self):
        d = self.doc
        self.assertRefused(mutate(d, "database.port", 6543), "transaction-pooler")
        self.assertRefused(mutate(d, "database.connection_mode", "transaction-pooler"), "transaction-pooler")
        self.assertRefused(mutate(d, "database.host", "db.otherprojectreference.supabase.co"), "host-ref-mismatch")
        pool = mutate(mutate(d, "database.connection_mode", "session-pooler"), "database.host", "aws-0-eu-central-1.pooler.supabase.com")
        self.assertRefused(pool, "host-region-mismatch")
        ok = mutate(mutate(d, "database.connection_mode", "session-pooler"), "database.host", "aws-0-ap-southeast-1.pooler.supabase.com")
        self.assertEqual(self.validate(ok).returncode, 0)
        self.assertRefused(mutate(d, "database.name", "other"), "database-name")

    def test_tls(self):
        for mode in ("require", "verify-ca", "prefer", "disable"):
            self.assertRefused(mutate(self.doc, "database.tls.sslmode", mode), "tls-sslmode")
        self.assertRefused(mutate(self.doc, "database.tls.root_ca_file", "relative.pem"), "tls-root-ca")
        self.assertRefused(mutate(self.doc, "database.tls.root_ca_sha256", "abc"), "tls-root-ca-sha")

    def test_roles(self):
        for role in ("postgres", "anon", "service_role", "supabase_admin", "pg_monitor", "authenticator"):
            self.assertRefused(mutate(self.doc, "roles.runtime", role), "role")
        other_prefix = "aya_runtime" if APP == "umar" else "umar_runtime"
        self.assertRefused(mutate(self.doc, "roles.runtime", other_prefix), "role-prefix")
        self.assertRefused(mutate(self.doc, "roles.runtime", self.doc["roles"]["migration"]), "role-reuse")

    def test_secret_paths(self):
        self.assertRefused(mutate(self.doc, "secrets.runtime_dsn_file", "relative.dsn"), "secret-path")
        self.assertRefused(mutate(self.doc, "secrets.runtime_dsn_file", str(REPO / "leaky.dsn")), "secret-path")
        self.assertRefused(mutate(self.doc, "secrets.runtime_dsn_file", self.doc["secrets"]["migration_dsn_file"]), "secret-reuse")

    def test_data_api_attestation_required(self):
        self.assertRefused(mutate(self.doc, "data_api.disabled_confirmed_by_owner", False), "data-api")

    def test_status_and_kind(self):
        self.assertRefused(mutate(self.doc, "status", "example"), "example-status")
        self.assertRefused(mutate(self.doc, "app", "other"), "app")
        self.assertRefused(mutate(self.doc, "kind", "local-test"), "kind")
        approved = mutate(self.doc, "status", "owner-approved")
        self.assertRefused(approved, "approval-token")

    def test_auth_identity(self):
        d = self.doc
        self.assertRefused(mutate(d, "auth.provider", "supabase-hosted"), "auth-provider")
        self.assertRefused(mutate(d, "auth.audience", "other"), "auth-audience")
        for bad in ("http://auth.fixture.net", "https://203.0.113.5", "https://auth.fixture.test", "https://localhost",
                    "https://auth.fixture.net/", "https://Auth.fixture.net", "https://user@auth.fixture.net"):
            self.assertRefused(mutate(mutate(d, "auth.public_origin", bad), "auth.issuer", bad), "auth-origin")
        self.assertRefused(mutate(d, "auth.issuer", "https://auth.other-fixture.net"), "auth-issuer")
        with_path = mutate(d, "auth.issuer", d["auth"]["public_origin"] + "/auth/v1")
        if APP == "ayangaji":
            self.assertEqual(self.validate(with_path).returncode, 0)  # the adult stack's own issuer shape
            self.assertRefused(mutate(d, "auth.supabase_url", "https://other.ayangaji-fixture.net:9443"), "auth-url-host")
        else:
            self.assertRefused(with_path, "auth-origin")
        for ns in ("auth", "public", "storage", "pg_catalog"):
            self.assertRefused(mutate(d, "auth.database.namespace", ns), "auth-namespace")
        self.assertRefused(mutate(d, "auth.database.namespace", d["database"]["schema"]), "auth-namespace")
        self.assertRefused(mutate(d, "auth.database.role", "supabase_auth_admin"), "auth-role")
        self.assertRefused(mutate(d, "auth.database.project_ref", d["project"]["ref"]), "auth-project")
        shared = mutate(mutate(d, "auth.database.placement", "same-project-dedicated-schema"), "auth.database.project_ref", d["project"]["ref"])
        self.assertRefused(shared, "auth-shared-domain")
        accepted = mutate(shared, "auth.database.accepts_shared_failure_domain", True)
        self.assertEqual(self.validate(accepted).returncode, 0)
        self.assertRefused(mutate(d, "auth.smtp.provider", "UNDECIDED:D10"), "smtp")

    def test_umar_rules(self):
        d = self.docs["umar"]
        self.assertRefused(mutate(d, "database.schema", "ayailmu"), "schema")
        self.assertRefused(mutate(d, "runtime.listen", "0.0.0.0:8187"), "listen")
        self.assertRefused(mutate(d, "auth.jwks_url", "https://auth.umar-fixture.net/.well-known/jwks.json"), "jwks-url")

    def test_ayangaji_rules(self):
        d = self.docs["ayangaji"]
        for schema in ("public", "auth", "pg_temp", "Bad", "information_schema"):
            self.assertRefused(mutate(d, "database.schema", schema), "schema")
        self.assertRefused(mutate(d, "runtime.cors_origins", []), "cors-origins")
        self.assertRefused(mutate(d, "runtime.cors_origins", ["http://app.ayangaji-fixture.net"]), "cors-origins")
        self.assertRefused(mutate(d, "runtime.trusted_proxies", ["127.0.0.1"]), "trusted-proxies")
        self.assertRefused(mutate(d, "runtime.trusted_proxies", ["203.0.113.0/24"]), "trusted-proxies")
        self.assertRefused(mutate(d, "runtime.allowed_hosts", ["api.fixture.test"]), "allowed-hosts")
        self.assertRefused(mutate(d, "runtime.listen", "10.0.0.5:8080"), "listen")
        self.assertRefused(mutate(d, "auth.supabase_url", "https://auth.ayangaji-fixture.net:8443"), "auth-url")
        self.assertRefused(mutate(d, "secrets.admin_key_file", d["secrets"]["runtime_dsn_file"]), "secret-reuse")


class PeerIsolation(Base):
    def peer(self, a, b, *extra):
        pa = self.manifest(a, "a.json")
        pb = self.manifest(b, "b.json")
        return run_tool("validate", pa, "--peer", pb, *extra)

    def test_distinct_identities_pass(self):
        r = self.peer(self.docs[APP], self.docs["ayangaji" if APP == "umar" else "umar"])
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_every_shared_identity_is_refused(self):
        other = "ayangaji" if APP == "umar" else "umar"
        mine, theirs = self.docs[APP], self.docs[other]
        cases = {
            "peer-project": mutate(theirs, "project.ref", mine["project"]["ref"]),
            "peer-host": mutate(theirs, "database.host", mine["database"]["host"]),
            "peer-issuer": mutate(mutate(theirs, "auth.public_origin", mine["auth"]["public_origin"]), "auth.issuer", mine["auth"]["issuer"]),
            "peer-auth-project": mutate(theirs, "auth.database.project_ref", mine["auth"]["database"]["project_ref"]),
            "peer-secret": mutate(theirs, "secrets.runtime_dsn_file", mine["secrets"]["runtime_dsn_file"]),
            "peer-role": mutate(theirs, "roles.runtime", mine["roles"]["runtime"]),
            "peer-listen": mutate(theirs, "runtime.listen", mine["runtime"]["listen"]),
        }
        for code, bad in cases.items():
            r = self.peer(mine, bad)
            self.assertEqual(r.returncode, 2, code)
            self.assertIn(f"REFUSED {code} ", r.stderr)

    def test_same_app_twice_is_refused(self):
        r = self.peer(self.docs[APP], self.docs[APP])
        self.assertIn("REFUSED peer-same-app", r.stderr)


class DsnFiles(Base):
    def setUp(self):
        super().setUp()
        self.password = secrets.token_hex(16)
        self.mig_role = self.doc["roles"]["migration"]
        self.write(self.good())

    def good(self, user=None, host=None, port=5432, query=None, password=None):
        q = query if query is not None else f"sslmode=verify-full&sslrootcert={self.ca}"
        return (f"postgres://{user or self.mig_role}:{password or self.password}@{host or self.doc['database']['host']}:"
                f"{port}/postgres?{q}")

    def write(self, text, mode=0o600):
        return private_file(Path(self.doc["secrets"]["migration_dsn_file"]), text, mode)

    def check(self, **kw):
        return run_tool("dsn-check", self.manifest(), "--role", "migration", **kw)

    def assertDsnRefused(self, text, code, mode=0o600):
        self.write(text, mode)
        r = self.check()
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn(f"REFUSED {code} ", r.stderr)
        self.assertNotIn(self.password, r.stdout + r.stderr)
        self.assertNotIn("postgres://", r.stdout + r.stderr)

    def test_good_dsn_passes_without_echo(self):
        r = self.check()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(self.password, r.stdout + r.stderr)

    def test_mismatches(self):
        self.assertDsnRefused(self.good(user="someone_else"), "dsn-user")
        self.assertDsnRefused(self.good(host=f"db.{'z' * 20}.supabase.co"), "dsn-target")
        self.assertDsnRefused(self.good(port=6543), "dsn-target")
        self.assertDsnRefused(self.good(password="short"), "dsn-password")
        self.assertDsnRefused(self.good(password="%5BYOUR-PASSWORD%5D-padding-xx"), "dsn-password")
        self.assertDsnRefused(self.good(password="[YOUR-PASSWORD]-padding-xx"), "dsn-syntax")
        self.assertDsnRefused(self.good(query=f"sslmode=require&sslrootcert={self.ca}"), "dsn-sslmode")
        self.assertDsnRefused(self.good(query=f"sslrootcert={self.ca}"), "dsn-sslmode")
        self.assertDsnRefused(self.good(query="sslmode=verify-full&sslrootcert=/elsewhere/ca.pem"), "dsn-sslrootcert")
        self.assertDsnRefused(self.good(query=f"sslmode=verify-full&sslrootcert={self.ca}&search_path=pg_temp"), "dsn-query")
        self.assertDsnRefused(self.good(query=f"sslmode=verify-full&sslrootcert={self.ca}&host=evil.example"), "dsn-query")
        self.assertDsnRefused("mysql://x:y@host/db", "dsn-syntax")
        self.assertDsnRefused(self.good().replace("@db.", "@other.example,db."), "dsn-syntax")

    def test_file_hygiene(self):
        self.assertDsnRefused(self.good(), "secret-file-mode", mode=0o644)
        self.assertDsnRefused(self.good(), "secret-file-mode", mode=0o640)
        self.assertDsnRefused(self.good() + "\nsecond line", "secret-file")
        path = Path(self.doc["secrets"]["migration_dsn_file"])
        path.unlink()
        r = self.check()
        self.assertIn("REFUSED secret-file ", r.stderr)
        target = self.tmp / "real.dsn"
        private_file(target, self.good())
        path.symlink_to(target)
        r = self.check()
        self.assertIn("REFUSED secret-file ", r.stderr)
        self.assertNotIn(self.password, r.stdout + r.stderr)

    def test_root_ca_digest_is_pinned(self):
        self.ca.write_text("tampered")
        r = self.check()
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED root-ca-digest ", r.stderr)
        os.chmod(self.ca, 0o666)
        self.assertIn("REFUSED root-ca-file ", self.check().stderr)

    def test_pooler_user_carries_project_ref(self):
        pooled = mutate(mutate(self.doc, "database.connection_mode", "session-pooler"), "database.host",
                        "aws-0-ap-southeast-1.pooler.supabase.com")
        write_json(self.tmp / "pool.json", pooled)
        host = pooled["database"]["host"]
        self.write(self.good(host=host))  # plain role name: wrong for the pooler
        r = run_tool("dsn-check", str(self.tmp / "pool.json"), "--role", "migration")
        self.assertIn("REFUSED dsn-user ", r.stderr)
        self.write(self.good(host=host, user=f"{self.mig_role}.{pooled['project']['ref']}"))
        r = run_tool("dsn-check", str(self.tmp / "pool.json"), "--role", "migration")
        self.assertEqual(r.returncode, 0, r.stderr)


class RenderAndGates(Base):
    def setUp(self):
        super().setUp()
        self.password = secrets.token_hex(16)
        role = self.doc["roles"]["migration"]
        self.dsn_text = (f"postgres://{role}:{self.password}@{self.doc['database']['host']}:5432/postgres"
                         f"?sslmode=verify-full&sslrootcert={self.ca}")
        private_file(Path(self.doc["secrets"]["migration_dsn_file"]), self.dsn_text)
        # A fake migration binary: records that it ran, tries to leak its DSN, never touches a network.
        self.sentinel = self.tmp / "ran"
        self.fake = self.tmp / "fake-migrate"
        self.fake.write_text(f"#!/bin/sh\ntouch {self.sentinel}\necho \"$UMAR_DATABASE_URL\"; echo \"$UMAR_DATABASE_URL\" >&2\n"
                             f"cat \"$AYA_DATABASE_URL_FILE\" 2>/dev/null; env | grep -c '^PG' >&2; exit 0\n")
        os.chmod(self.fake, 0o755)

    def migrate(self, doc=None, *extra):
        return run_tool("migrate", self.manifest(doc), "--migrate-bin", str(self.fake), *extra)

    def test_render_env_is_secret_free(self):
        r = run_tool("render-env", self.manifest(), "--role", "runtime")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(self.password, r.stdout)
        keys = {line.split("=", 1)[0] for line in r.stdout.splitlines()}
        if APP == "umar":
            self.assertTrue({"UMAR_MIGRATE_ON_START", "UMAR_OIDC_ISSUER", "UMAR_PUBLIC_ORIGIN"} <= keys)
            self.assertNotIn("UMAR_DATABASE_URL", keys)
            self.assertIn("UMAR_MIGRATE_ON_START=false", r.stdout)
        else:
            self.assertTrue({"AYA_MODE", "AYA_DB_HOSTS", "AYA_DATABASE_URL_FILE", "AYA_SUPABASE_URL"} <= keys)
            self.assertNotIn("AYA_DATABASE_URL", keys)
        bad = mutate(self.doc, "runtime.listen", "127.0.0.1:8187\nEVIL=1") if APP == "umar" else self.doc
        self.assertEqual(run_tool("render-env", self.manifest(bad, "bad.json"), "--role", "runtime").returncode, 2 if APP == "umar" else 0)

    def test_default_is_dry_run_and_never_runs_the_binary(self):
        r = self.migrate()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DRY RUN (no connection opened)", r.stdout)
        self.assertFalse(self.sentinel.exists())
        self.assertNotIn(self.password, r.stdout + r.stderr)

    def test_execute_gates(self):
        ref = self.doc["project"]["ref"]
        r = self.migrate(None, "--execute", "--confirm-project", ref)
        self.assertIn("REFUSED gate-status", r.stderr)
        approved = mutate(mutate(self.doc, "status", "owner-approved"), "approvals.migration", f"approved:{ref}:migration:2026-10-26")
        for doc, confirm, code in (
            (mutate(approved, "approvals.migration", "approved"), ref, "approval-token"),
            (mutate(approved, "approvals.migration", f"approved:{ref}x:migration:2026-10-26"), ref, "approval-token"),
            (approved, "wrongprojectreference", "gate-confirm"),
            (approved, None, "gate-confirm"),
        ):
            args = ["--execute"] + (["--confirm-project", confirm] if confirm else [])
            r = self.migrate(doc, *args)
            self.assertEqual(r.returncode, 2, code)
            self.assertIn(f"REFUSED {code}", r.stderr)
            self.assertFalse(self.sentinel.exists(), code)

    def test_fully_gated_execute_redacts_and_scrubs_environment(self):
        ref = self.doc["project"]["ref"]
        approved = mutate(mutate(self.doc, "status", "owner-approved"), "approvals.migration", f"approved:{ref}:migration:2026-10-26")
        r = self.migrate(approved, "--execute", "--confirm-project", ref)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(self.sentinel.exists())
        out = r.stdout + r.stderr
        self.assertNotIn(self.password, out)
        self.assertNotIn("postgres://", out)
        if APP == "umar":
            self.assertIn("[redacted]", out)
        os.environ.pop("PGHOST", None)

    def test_inherited_pg_environment_does_not_reach_the_child(self):
        ref = self.doc["project"]["ref"]
        approved = mutate(mutate(self.doc, "status", "owner-approved"), "approvals.migration", f"approved:{ref}:migration:2026-10-26")
        self.fake.write_text(f"#!/bin/sh\ntouch {self.sentinel}\nenv | grep -c '^PG' || true\n")
        r = run_tool("migrate", self.manifest(approved), "--migrate-bin", str(self.fake), "--execute", "--confirm-project", ref,
                     env_extra={"PGHOST": "evil.invalid", "PGSERVICE": "x", "AYA_MODE": "emulator", "UMAR_LISTEN": "0.0.0.0:1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("\n0\n", "\n" + r.stdout, r.stdout)

    def test_local_test_kind_needs_explicit_flag(self):
        doc = dict(self.doc, kind="local-test", status="local-test")
        self.assertRefused(doc, "local-test")

class RepoHygiene(unittest.TestCase):
    """Everything under infra/ is committed: it must hold no credential, DSN with a password, token or private key."""

    PATTERNS = {
        "dsn with password": re.compile(r"postgres(?:ql)?://[^\s:@/'\"{}]+:[^\s@/'\"<>\[\]${}]{6,}@"),
        "jwt": re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."),
        "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        "supabase secret key": re.compile(r"sb_secret_[A-Za-z0-9_-]{8,}|sbp_[a-f0-9]{20,}"),
    }

    def test_no_secret_material_in_infra_files(self):
        files = [p for p in (REPO / "infra").rglob("*") if p.is_file() and "__pycache__" not in p.parts]
        self.assertTrue(files)
        for p in files:
            text = p.read_text(errors="replace")
            for name, rx in self.PATTERNS.items():
                self.assertIsNone(rx.search(text), f"{name} found in {p.relative_to(REPO)}")

    def test_no_hosted_supabase_dependency_in_existing_deploy_config(self):
        """Hosted Auth / PostgREST are out of scope: no hosted endpoints or keys in the pre-existing local deploy config
        (infra/ itself legitimately names the Supabase host formats it validates)."""
        banned = re.compile(r"\.supabase\.co|pooler\.supabase\.com|rest/v1|NEXT_PUBLIC_SUPABASE|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE|PGRST_|postgrest", re.I)
        roots = [REPO / "integration", REPO / "deploy", REPO / "backend-umar" / "deploy", REPO / "backend-umar" / "scripts"]
        for root in roots:
            for p in root.rglob("*") if root.exists() else []:
                if p.is_file() and p.suffix in {".py", ".sql", ".sh", ".yaml", ".yml", ".json", ".template", ".env", ".example", ".md"} \
                        and "tests" not in p.parts and "__pycache__" not in p.parts and "node_modules" not in p.parts \
                        and p.name != "README.md":
                    self.assertIsNone(banned.search(p.read_text(errors="replace")), f"hosted Supabase wiring in {p.relative_to(REPO)}")

    def test_migration_templates_never_reference_the_hosted_auth_schema_as_a_target(self):
        for p in (REPO / "infra").rglob("*.template"):
            text = p.read_text()
            self.assertNotRegex(text, r"(?im)^\s*(CREATE|DROP|ALTER)\s+(SCHEMA|TABLE)\s+(IF NOT EXISTS\s+)?\"?auth\"?[\s.;]", p.name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
