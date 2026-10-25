"""Independent review regressions: required target fields and shared session-pooler identity.

Offline only. Fabricated project identifiers are never resolved or contacted.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import DELETE, TOOL, mutate, supabase_manifest

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


if __name__ == "__main__":
    unittest.main()
