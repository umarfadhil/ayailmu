"""Manifest/DSN validator tests. Offline: no database, no network, no real project. Run via run-tests.sh."""
from __future__ import annotations

import argparse
import copy
import importlib.util
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
from common import (AYA_AUTH_REF, AYA_REF, DELETE, HERE, REPO, UMAR_AUTH_REF, UMAR_REF, hosted_identity, local_manifest, mutate,
                    private_file, run_tool, supabase_manifest, write_json)

CANARY = "CANARY-9f3a1c77-do-not-echo"

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
        # The supported identity store is a separate self-hosted PostgreSQL that keeps the vendor `auth` namespace.
        self.assertEqual(self.validate(d).returncode, 0)
        for ns in ("gotrue_x", "public", "storage", "pg_catalog", "Auth", "", None, 7, ["auth"]):
            self.assertRefused(mutate(d, "auth.database.namespace", ns), "auth-namespace" if isinstance(ns, str) and ns else "missing")
        self.assertRefused(mutate(d, "auth.database.namespace", d["database"]["schema"]), "auth-namespace")
        self.assertRefused(mutate(d, "auth.database.role", "supabase_auth_admin"), "auth-role")
        self.assertRefused(mutate(d, "auth.database.role", d["roles"]["runtime"]), "auth-role")
        # The earlier hosted placements are not proven with the pinned GoTrue and are refused, with their old findings kept.
        for placement in ("dedicated-project", "same-project-dedicated-schema"):
            hosted = hosted_identity(d, placement)
            self.assertRefused(hosted, "auth-placement-unsupported")
            for ns in ("auth", "public", "storage", "pg_catalog"):
                self.assertRefused(mutate(hosted, "auth.database.namespace", ns), "auth-namespace")
        dedicated = hosted_identity(d)
        self.assertRefused(mutate(dedicated, "auth.database.project_ref", d["project"]["ref"]), "auth-project")
        self.assertRefused(mutate(hosted_identity(d, "same-project-dedicated-schema"), "auth.database.accepts_shared_failure_domain", False),
                           "auth-shared-domain")
        self.assertRefused(mutate(d, "auth.database.placement", "somewhere-else"), "auth-placement")
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


class SelfHostedIdentity(Base):
    """Required-field, type and mixed-topology rules of the self-hosted identity placement (offline, fabricated values)."""

    def test_each_identity_field_is_required_and_typed(self):
        for field in ("placement", "instance_id", "name", "namespace", "role"):
            for bad in (DELETE, None, "", 5, True, ["x"], {"a": 1}):
                with self.subTest(field=field, bad=repr(bad)):
                    self.assertEqual(self.validate(mutate(self.doc, f"auth.database.{field}", bad)).returncode, 2)
        self.assertEqual(self.validate(mutate(self.doc, "auth.database", DELETE)).returncode, 2)
        for bad in (None, [], "auth", 5):
            self.assertEqual(self.validate(mutate(self.doc, "auth.database", bad)).returncode, 2)
        for bad in ("Upper", "-lead", "with space", "x", "a" * 64, "under_score", "dot.ted"):
            self.assertRefused(mutate(self.doc, "auth.database.instance_id", bad), "auth-instance")
        for bad in ("Upper", "1lead", "with-dash", "a" * 64, "postgres", "template0", "template1", "pg_identity"):
            self.assertRefused(mutate(self.doc, "auth.database.name", bad), "auth-database-name")
        self.assertRefused(mutate(self.doc, "auth.database.instance_id", self.doc["project"]["ref"]), "auth-instance")
        self.assertRefused(mutate(self.doc, "auth.database.instance_id", "UNDECIDED:D08"), "undecided")

    def test_hosted_and_credential_fields_make_a_mixed_topology(self):
        for key, value in (("project_ref", AYA_AUTH_REF), ("accepts_shared_failure_domain", True)):
            self.assertRefused(mutate(self.doc, f"auth.database.{key}", value), "auth-mixed-topology")
        for key in ("dsn", "password", "host", "port", "url", "token", "connection_string", "dsn_file"):
            r = self.assertRefused(mutate(self.doc, f"auth.database.{key}", "never-echoed-value-123456"), "auth-identity-field")
            self.assertNotIn("never-echoed-value-123456", r.stdout + r.stderr)

    def test_a_connection_string_is_refused_wherever_it_appears(self):
        secret = "s3cretpassw0rdvalue99"
        for dotted in ("auth.database.name", "auth.database.role", "auth.smtp.provider", "backup.strategy", "organization.slug"):
            bad = mutate(self.doc, dotted, f"postgres://identity:{secret}@10.0.0.9:5432/x")
            r = self.assertRefused(bad, "manifest-credential")
            self.assertNotIn(secret, r.stdout + r.stderr)
        r = self.assertRefused(mutate(self.doc, "auth.database.extra", f"postgresql://u:{secret}@h/d"), "manifest-credential")
        self.assertNotIn(secret, r.stdout + r.stderr)

    def test_placement_and_namespace_do_not_cross(self):
        # Vendor namespace `auth` is allowed only with the self-hosted placement; never with a hosted one.
        for placement in ("dedicated-project", "same-project-dedicated-schema"):
            r = self.assertRefused(mutate(hosted_identity(self.doc, placement), "auth.database.namespace", "auth"), "auth-namespace")
            self.assertIn("auth-placement-unsupported", r.stderr)
        mixed = mutate(self.doc, "auth.database.placement", "dedicated-project")
        self.assertRefused(mixed, "auth-placement-unsupported")
        self.assertRefused(mixed, "auth-namespace")
        self.assertRefused(mutate(self.doc, "auth.database.placement", "UNDECIDED:D08"), "undecided")

    def test_hosted_confusion_is_still_refused_with_the_new_default(self):
        d = self.doc
        hosted = "https://" + d["project"]["ref"] + ".supabase.co"
        self.assertRefused(mutate(mutate(d, "auth.public_origin", hosted), "auth.issuer", hosted), "auth-hosted")
        self.assertRefused(mutate(d, "auth.provider", "supabase-hosted"), "auth-provider")

    def test_wrapper_surfaces_only_the_application_database(self):
        d = self.doc
        ident = d["auth"]["database"]
        path = self.manifest()
        for args in (("render-env", path, "--role", "migration"), ("render-env", path, "--role", "runtime"),
                     ("migrate", path, "--migrate-bin", "/usr/bin/true"), ("verify", path, "--role", "migration")):
            r = run_tool(*args)
            for value in (ident["instance_id"], ident["name"], ident["role"]):
                self.assertNotIn(value, r.stdout + r.stderr, args[0])
        # An identity-database connection string is not accepted as an application target.
        pw = secrets.token_hex(16)
        dsn = f"postgres://{d['roles']['migration']}:{pw}@{ident['instance_id']}.fixture.net:5432/{ident['name']}?sslmode=verify-full&sslrootcert={self.ca}"
        private_file(Path(d["secrets"]["migration_dsn_file"]), dsn)
        r = run_tool("dsn-check", path, "--role", "migration")
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED dsn-target ", r.stderr)
        self.assertNotIn(pw, r.stdout + r.stderr)

    def test_example_template_declares_the_self_hosted_topology(self):
        ident = json.loads(EXAMPLE.read_text())["auth"]["database"]
        self.assertEqual(ident["placement"], "self-hosted-postgres")
        self.assertEqual(ident["namespace"], "auth")
        self.assertNotIn("project_ref", ident)
        self.assertEqual(set(ident), {"placement", "instance_id", "name", "namespace", "role"})
        self.assertTrue(ident["instance_id"].startswith("UNDECIDED:D08") and ident["name"].startswith("UNDECIDED:D08"))


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
            "peer-auth-database": mutate(mutate(theirs, "auth.database.instance_id", mine["auth"]["database"]["instance_id"]),
                                         "auth.database.name", mine["auth"]["database"]["name"]),
            "peer-secret": mutate(theirs, "secrets.runtime_dsn_file", mine["secrets"]["runtime_dsn_file"]),
            "peer-role": mutate(theirs, "roles.runtime", mine["roles"]["runtime"]),
            "peer-listen": mutate(theirs, "runtime.listen", mine["runtime"]["listen"]),
        }
        for code, bad in cases.items():
            r = self.peer(mine, bad)
            self.assertEqual(r.returncode, 2, code)
            self.assertIn(f"REFUSED {code} ", r.stderr)

    def test_identity_stores_are_kept_apart(self):
        other = "ayangaji" if APP == "umar" else "umar"
        mine, theirs = self.docs[APP], self.docs[other]
        # The same vendor namespace name in two different identity databases is not shared storage.
        self.assertEqual(mine["auth"]["database"]["namespace"], theirs["auth"]["database"]["namespace"])
        self.assertEqual(self.peer(mine, theirs).returncode, 0)
        same_instance = mutate(theirs, "auth.database.instance_id", mine["auth"]["database"]["instance_id"])
        self.assertEqual(self.peer(mine, same_instance).returncode, 0, "one instance with two databases is a separate store")
        same_name = mutate(theirs, "auth.database.name", mine["auth"]["database"]["name"])
        self.assertEqual(self.peer(mine, same_name).returncode, 0, "the same database name on two instances is a separate store")
        # An identity instance may not be either application's project.
        r = self.peer(mine, mutate(theirs, "auth.database.instance_id", mine["project"]["ref"]))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED peer-auth-project ", r.stderr)
        r = self.peer(mutate(mine, "auth.database.instance_id", theirs["project"]["ref"]), theirs)
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED peer-auth-project ", r.stderr)
        # Hosted topologies still collide when they name the same identity project and namespace.
        a, b = hosted_identity(mine), hosted_identity(theirs)
        b = mutate(mutate(b, "auth.database.project_ref", a["auth"]["database"]["project_ref"]),
                   "auth.database.namespace", a["auth"]["database"]["namespace"])
        r = self.peer(a, b)
        self.assertEqual(r.returncode, 2)
        for code in ("peer-auth-project", "peer-auth-database", "peer-auth-namespace"):
            self.assertIn(f"REFUSED {code} ", r.stderr)

    def test_same_app_twice_is_refused(self):
        r = self.peer(self.docs[APP], self.docs[APP])
        self.assertIn("REFUSED peer-same-app", r.stderr)


class ExecutionPeerPolicy(Base):
    """--execute on a Supabase-kind target needs a valid peer of the other app: the two-app isolation checks cannot be skipped
    by leaving --peer out or by passing something that is not a manifest. Dry runs and offline inspection keep it optional."""

    def setUp(self):
        super().setUp()
        self.other = "ayangaji" if APP == "umar" else "umar"
        self.ref = self.doc["project"]["ref"]
        self.approved = mutate(mutate(self.doc, "status", "owner-approved"), "approvals.migration", f"approved:{self.ref}:migration:2026-10-26")
        self.approved = mutate(self.approved, "approvals.verify", f"approved:{self.ref}:verify:2026-10-26")
        self.password = secrets.token_hex(16)
        self.write_dsn(self.approved, "migration")
        self.write_dsn(self.approved, "runtime")
        # Everything an execution would start records itself: migrate binary and psql.
        self.sentinel = self.tmp / "ran"
        self.fake = self.tmp / "fake-migrate"
        self.fake.write_text(f"#!/bin/sh\ntouch {self.sentinel}\n")
        os.chmod(self.fake, 0o755)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        (self.bin / "psql").write_text(f"#!/bin/sh\ntouch {self.sentinel}\nexit 0\n")
        os.chmod(self.bin / "psql", 0o755)

    def write_dsn(self, doc, kind):
        user = doc["roles"][kind]
        if doc["database"]["connection_mode"] == "session-pooler":
            user += "." + doc["project"]["ref"]
        private_file(Path(doc["secrets"][f"{kind}_dsn_file"]),
                     f"postgres://{user}:{self.password}@{doc['database']['host']}:5432/postgres?sslmode=verify-full&sslrootcert={self.ca}")

    def peer_file(self, doc=None, name="peer.json"):
        return str(write_json(self.tmp / name, doc if doc is not None else self.docs[self.other]))

    def execute(self, command, doc=None, *extra):
        self.sentinel.unlink(missing_ok=True)  # each run answers for itself
        m = self.manifest(doc or self.approved)
        if command == "migrate":
            return run_tool("migrate", m, "--migrate-bin", str(self.fake), "--execute", "--confirm-project", self.ref, *extra)
        return run_tool("verify", m, "--role", "runtime", "--psql-path", str(self.bin), "--execute", "--confirm-project", self.ref, *extra)

    def test_execute_without_a_peer_is_refused_before_any_dsn_or_process_is_touched(self):
        for kind in ("migration", "runtime"):  # the DSN files are gone: reading one would show up as a different refusal
            Path(self.approved["secrets"][f"{kind}_dsn_file"]).unlink()
        for command in ("migrate", "verify"):
            r = self.execute(command)
            self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
            self.assertIn("REFUSED peer-required ", r.stderr)
            for other in ("secret-file", "dsn-", "gate-"):
                self.assertNotIn(other, r.stderr, "refusal must come before the DSN and the gate")
            self.assertFalse(self.sentinel.exists(), command)

    def test_garbage_peers_cannot_stand_in_for_the_other_app(self):
        broken = copy.deepcopy(self.docs[self.other])
        broken["roles"] = CANARY
        broken["runtime"] = [CANARY]
        cases = {
            "an empty object": {}, "an unknown app": {"app": "someone-else"}, "the same app": self.docs[APP],
            "wrong types": broken, "an example": mutate(self.docs[self.other], "status", "example"),
            "a local-test manifest": dict(self.docs[self.other], kind="local-test", status="local-test"),
            "an incomplete one": mutate(self.docs[self.other], "project.ref", DELETE),
        }
        for name, peer in cases.items():
            for command in ("migrate", "verify"):
                with self.subTest(peer=name, command=command):
                    r = self.execute(command, None, "--peer", self.peer_file(peer))
                    self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
                    self.assertIn("REFUSED peer", r.stderr)
                    self.assertNotIn("Traceback", r.stderr)
                    self.assertNotIn(CANARY, r.stdout + r.stderr)
                    self.assertFalse(self.sentinel.exists())
        for name, text in {"not JSON": "{", "a list": "[]", "a string": '"x"'}.items():
            (self.tmp / "raw.json").write_text(text)
            for command in ("migrate", "verify"):
                with self.subTest(peer=name, command=command):
                    r = self.execute(command, None, "--peer", str(self.tmp / "raw.json"))
                    self.assertNotEqual(r.returncode, 0)
                    self.assertNotIn("Traceback", r.stderr)
                    self.assertFalse(self.sentinel.exists())
        r = self.execute("migrate", None, "--peer", str(self.tmp / "no-such-file.json"))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.sentinel.exists())

    def test_a_peer_that_shares_an_identity_is_still_refused_on_execution(self):
        theirs = mutate(self.docs[self.other], "roles.runtime", self.doc["roles"]["runtime"])
        r = self.execute("migrate", None, "--peer", self.peer_file(theirs))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED peer-role ", r.stderr)
        self.assertFalse(self.sentinel.exists())

    def test_a_valid_distinct_app_peer_lets_the_gated_execution_run(self):
        r = self.execute("migrate", None, "--peer", self.peer_file())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(self.sentinel.exists())
        self.sentinel.unlink()
        r = self.execute("verify", None, "--peer", self.peer_file())
        self.assertNotIn("REFUSED peer", r.stderr)
        self.assertTrue(self.sentinel.exists(), "the gated verify reached psql")

    def test_a_shared_session_pooler_endpoint_is_still_valid_for_execution(self):
        pooled = {}
        for app, doc in ((APP, self.approved), (self.other, self.docs[self.other])):
            pooled[app] = mutate(mutate(doc, "database.connection_mode", "session-pooler"),
                                 "database.host", "aws-0-ap-southeast-1.pooler.supabase.com")
        self.assertEqual(pooled[APP]["database"]["host"], pooled[self.other]["database"]["host"])
        self.write_dsn(pooled[APP], "migration")
        r = self.execute("migrate", pooled[APP], "--peer", self.peer_file(pooled[self.other]))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(self.sentinel.exists())

    def test_dry_runs_and_offline_inspection_keep_the_peer_optional(self):
        m = self.manifest(self.approved)
        for args in (("validate", m), ("inventory", m), ("render-env", m, "--role", "runtime"), ("dsn-check", m, "--role", "runtime"),
                     ("migrate", m, "--migrate-bin", str(self.fake)), ("verify", m, "--role", "runtime")):
            with self.subTest(command=args[0]):
                r = run_tool(*args)
                self.assertNotIn("peer-required", r.stderr)
                self.assertNotIn("Traceback", r.stderr)
                if args[0] != "inventory":
                    self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.sentinel.exists(), "dry runs execute nothing")

    def test_an_invalid_peer_is_refused_for_offline_inspection_too(self):
        r = run_tool("validate", self.manifest(self.approved), "--peer", self.peer_file({"app": self.other}))
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSED peer", r.stderr)

    def test_local_test_execution_stays_isolated_and_needs_no_peer(self):
        tool = importlib.util.spec_from_file_location("target_peer_policy", HERE.parent / "supabase_target.py")
        module = importlib.util.module_from_spec(tool)
        tool.loader.exec_module(module)
        local = local_manifest(APP, self.tmp, self.ca, 5999, "db", "ayailmu" if APP == "ayangaji" else "public",
                               f"{'umar' if APP == 'umar' else 'aya'}_migrator", f"{'umar' if APP == 'umar' else 'aya'}_runtime")
        args = argparse.Namespace(execute=True, peer=None, allow_local_test=True)
        self.assertFalse([i for i in module.full_validate(args, local).items if i["code"] == "peer-required"])
        remote = argparse.Namespace(execute=True, peer=None, allow_local_test=True)
        self.assertEqual([i["code"] for i in module.full_validate(remote, self.approved).items], ["peer-required"])


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

    def peer_args(self, *extra) -> tuple:
        """An execution on a Supabase target must name the other app's valid manifest (see ExecutionPeerPolicy)."""
        if "--execute" not in extra:
            return ()
        other = "ayangaji" if APP == "umar" else "umar"
        return ("--peer", str(write_json(self.tmp / "peer.json", self.docs[other])))

    def migrate(self, doc=None, *extra):
        return run_tool("migrate", self.manifest(doc), "--migrate-bin", str(self.fake), *extra, *self.peer_args(*extra))

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
                     *self.peer_args("--execute"), env_extra={"PGHOST": "evil.invalid", "PGSERVICE": "x", "AYA_MODE": "emulator", "UMAR_LISTEN": "0.0.0.0:1"})
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
