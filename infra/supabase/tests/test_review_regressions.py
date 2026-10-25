"""Independent review regressions: required target fields and shared session-pooler identity.

Offline only. Fabricated project identifiers are never resolved or contacted.
"""
import argparse
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import DELETE, TOOL, local_manifest, mutate, run_tool, supabase_manifest, write_json

spec = importlib.util.spec_from_file_location("target_review", TOOL)
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="infra-review-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.ca = self.base / "root.pem"
        self.ca.write_text("public fabricated CA bytes")

    def test_every_required_database_target_field_is_required(self):
        fields = ("project.ref", "project.region", "project.postgres_major",
                  "database.connection_mode", "database.host", "database.port", "database.name",
                  "database.schema", "database.tls.sslmode", "database.tls.root_ca_file",
                  "database.tls.root_ca_sha256", "roles.migration", "roles.runtime",
                  "secrets.migration_dsn_file", "secrets.runtime_dsn_file")
        for app in ("umar", "ayangaji"):
            doc = supabase_manifest(app, self.base, self.ca)
            self.assertFalse(target.validate(doc).items)
            for field in fields:
                for value in (DELETE, None):
                    with self.subTest(app=app, field=field, missing=value is DELETE):
                        findings = target.validate(mutate(doc, field, value))
                        self.assertTrue(findings.items, "incomplete target must not validate")

    def test_distinct_projects_can_share_a_session_pooler_hostname(self):
        docs = [supabase_manifest(app, self.base, self.ca) for app in ("umar", "ayangaji")]
        for doc in docs:
            doc["database"].update(connection_mode="session-pooler",
                                   host="aws-0-ap-southeast-1.pooler.supabase.com")
            self.assertFalse(target.validate(doc).items)
        self.assertNotEqual(docs[0]["project"]["ref"], docs[1]["project"]["ref"])
        self.assertNotEqual(docs[0]["roles"]["runtime"], docs[1]["roles"]["runtime"])
        self.assertFalse(target.peer_findings(*docs).items,
                         "shared pooler endpoint is valid when project refs and application identities differ")
        # Reusing the actual project or identities must still fail closed.
        reused = mutate(docs[1], "project.ref", docs[0]["project"]["ref"])
        self.assertTrue(target.peer_findings(docs[0], reused).items)


    def test_postgres_major_and_hosted_auth_are_not_accepted_as_standalone_configuration(self):
        for app in ("umar", "ayangaji"):
            doc = supabase_manifest(app, self.base, self.ca)
            for invalid in ("anything", "17", "latest"):
                with self.subTest(app=app, major=invalid):
                    self.assertTrue(target.validate(mutate(doc, "project.postgres_major", invalid)).items)
            hosted = "https://" + doc["project"]["ref"] + ".supabase.co"
            bad = mutate(mutate(doc, "auth.public_origin", hosted), "auth.issuer", hosted)
            if app == "ayangaji":
                bad = mutate(bad, "auth.supabase_url", hosted)
            with self.subTest(app=app, hosted_auth=True):
                self.assertTrue(target.validate(bad).items,
                                "hosted project origin cannot stand in for the standalone GoTrue origin")


    def test_self_hosted_identity_database_keeps_the_vendor_auth_namespace(self):
        # The pinned GoTrue v2.197.0 migration 00_init_auth_schema.up.sql names auth.users explicitly.
        # A real disposable probe with GOTRUE_DB_NAMESPACE=gotrue_probe and a protected auth schema failed
        # with 42501, while preserving the app schema. Keeping each GoTrue's separate self-hosted database
        # is an existing supported architecture, not a request to commandeer hosted Supabase Auth.
        docs = []
        for app in ("umar", "ayangaji"):
            doc = supabase_manifest(app, self.base, self.ca)
            identity = doc["auth"]["database"]
            identity.update(placement="self-hosted-postgres", instance_id=app+"-identity-db",
                            name=app+"_identity", namespace="auth")
            identity.pop("project_ref", None)
            with self.subTest(app=app):
                findings = target.validate(doc)
                self.assertFalse(findings.items,
                                 "isolated self-hosted identity PG must be supported without a Supabase identity project")
            docs.append(doc)
        self.assertFalse(target.peer_findings(*docs).items,
                         "the same auth schema name in different identity databases is not shared identity storage")
        shared = mutate(docs[1], "auth.database.instance_id", docs[0]["auth"]["database"]["instance_id"])
        shared = mutate(shared, "auth.database.name", docs[0]["auth"]["database"]["name"])
        self.assertTrue(target.peer_findings(docs[0], shared).items,
                        "the two apps may not share the same identity database")


# A value that must never be echoed back by a finding, however wrongly typed the field that carried it.
CANARY = "CANARY-9f3a1c77-do-not-echo"
WRONG_VALUES = (None, "", CANARY, 0, 7, True, 1.5, [], {}, [CANARY], [{}], [[]], [[CANARY]], [{"k": CANARY}], [None], [1], ["a", "a"],
                {"k": CANARY}, {"k": {"k": [CANARY]}}, [CANARY, CANARY])


def node_paths(doc, prefix=()):
    """Every dotted location of a manifest, nodes and leaves alike."""
    if isinstance(doc, dict):
        for key, value in doc.items():
            yield prefix + (key,)
            yield from node_paths(value, prefix + (key,))


class MalformedManifestTypes(unittest.TestCase):
    """A wrongly typed field is a structured, sanitized finding: no traceback, no echoed value, nothing executed."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="infra-types-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.ca = self.base / "root.pem"
        self.ca.write_text("public fabricated CA bytes")

    def with_value(self, doc, path, value):
        out = copy.deepcopy(doc)
        cur = out
        for part in path[:-1]:
            cur = cur[part]
        cur[path[-1]] = copy.deepcopy(value)
        return out

    def assertSanitized(self, findings, context):
        self.assertIsInstance(findings.items, list, context)
        text = json.dumps(findings.items)
        self.assertNotIn(CANARY, text, f"a finding echoed a manifest value: {context}")

    def test_no_wrongly_typed_field_raises_or_echoes_its_value(self):
        for app in ("umar", "ayangaji"):
            base = supabase_manifest(app, self.base, self.ca)
            self.assertFalse(target.validate(base).items)
            paths = [()] + list(node_paths(base))
            for path in paths:
                for value in WRONG_VALUES:
                    doc = value if not path else self.with_value(base, path, value)
                    if not isinstance(doc, dict):
                        continue  # a non-object document is refused by load_manifest before validation
                    context = f"{app} {'.'.join(path) or '<root>'}={type(value).__name__}"
                    try:
                        findings = target.validate(doc)
                    except Exception as err:  # noqa: BLE001
                        self.fail(f"{context} raised {type(err).__name__}")
                    self.assertSanitized(findings, context)

    def test_named_review_cases_are_refused_with_a_structured_finding(self):
        cases = {
            "roles": ("roles", "not-an-object"), "runtime": ("runtime", CANARY),
        }
        for app in ("umar", "ayangaji"):
            doc = supabase_manifest(app, self.base, self.ca)
            for name, (key, value) in cases.items():
                with self.subTest(app=app, case=name):
                    findings = target.validate(mutate(doc, key, value))
                    self.assertTrue(any(i["code"] == "type" and i["path"] == key for i in findings.items), findings.items)
                    self.assertSanitized(findings, name)
            if app != "ayangaji":
                continue
            for key, code in (("allowed_hosts", "allowed-hosts"), ("cors_origins", "cors-origins"), ("trusted_proxies", "trusted-proxies")):
                for value in ([{}], [[]], [{"k": CANARY}], [[CANARY], [CANARY]], [CANARY, {}]):
                    with self.subTest(app=app, key=key, value=str(value)):
                        findings = target.validate(mutate(doc, "runtime." + key, value))
                        self.assertTrue(any(i["code"] == code for i in findings.items), findings.items)
                        self.assertSanitized(findings, key)

    def test_the_command_line_refuses_without_a_traceback_and_executes_nothing(self):
        sentinel = self.base / "ran"
        fake = self.base / "fake-migrate"
        fake.write_text(f"#!/bin/sh\ntouch {sentinel}\n")
        fake.chmod(0o755)
        for app in ("umar", "ayangaji"):
            doc = supabase_manifest(app, self.base, self.ca)
            doc["status"] = "owner-approved"
            ref = doc["project"]["ref"]
            doc["approvals"]["migration"] = f"approved:{ref}:migration:2026-10-26"
            for key, value in (("roles", CANARY), ("runtime", [CANARY]), ("roles", [{}]), ("auth", [CANARY]), ("database", CANARY)):
                bad = write_json(self.base / "bad.json", mutate(doc, key, value))
                for command in (("validate", str(bad)), ("inventory", str(bad)), ("render-env", str(bad), "--role", "runtime"),
                                ("dsn-check", str(bad), "--role", "runtime"),
                                ("migrate", str(bad), "--migrate-bin", str(fake), "--execute", "--confirm-project", ref),
                                ("verify", str(bad), "--role", "runtime", "--execute", "--confirm-project", ref)):
                    with self.subTest(app=app, key=key, command=command[0]):
                        r = run_tool(*command)
                        text = r.stdout + r.stderr
                        self.assertNotIn("Traceback", text)
                        self.assertNotIn(CANARY, text)
                        if command[0] not in ("inventory",):
                            self.assertEqual(r.returncode, 2, text)
                        self.assertFalse(sentinel.exists(), "a refused manifest must not run anything")

    def test_a_peer_of_the_wrong_types_is_refused_not_a_crash(self):
        for app, other in (("umar", "ayangaji"), ("ayangaji", "umar")):
            mine = supabase_manifest(app, self.base, self.ca)
            theirs = supabase_manifest(other, self.base, self.ca)
            self.assertFalse(target.peer_findings(mine, theirs).items)
            for path in [()] + list(node_paths(theirs)):
                for value in WRONG_VALUES:
                    doc = value if not path else self.with_value(theirs, path, value)
                    if not isinstance(doc, dict):
                        continue
                    context = f"peer {'.'.join(path) or '<root>'}={type(value).__name__}"
                    try:
                        findings = target.peer_findings(mine, doc)
                        validated = target.validate(doc)
                    except Exception as err:  # noqa: BLE001
                        self.fail(f"{context} raised {type(err).__name__}")
                    self.assertSanitized(findings, context)
                    self.assertSanitized(validated, context)


if __name__ == "__main__":
    unittest.main()
