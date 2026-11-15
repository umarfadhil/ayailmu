"""No-network checks of the native Release boundary; all hosts are fixtures."""
import os
from pathlib import Path
import subprocess
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/validate-build-config.sh"


class ReleaseConfigurationTests(unittest.TestCase):
    def run_guard(self, **changes):
        env = dict(os.environ)
        env.update(
            CONFIGURATION="Release",
            SWIFT_ACTIVE_COMPILATION_CONDITIONS="",
            AYAILMU_QA_CA_DER="",
            AYAILMU_ORIGIN="https://api.qa.example.invalid",
            AYAILMU_RELEASE_APPROVED_ORIGIN="https://api.qa.example.invalid",
            AYAILMU_DECLARATION_VERSION="adult-owner-v1",
            AYAILMU_SYNC_POLICY_VERSION="fixture-owner-sync-v1",
            AYAILMU_REGISTRY_SOURCE_COMMIT="c" * 40,
        )
        env.update(changes)
        return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, timeout=10).returncode

    def test_explicitly_approved_public_qa_name_is_allowed(self):
        self.assertEqual(0, self.run_guard())

    def test_unapproved_origin_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_RELEASE_APPROVED_ORIGIN=""))

    def test_mismatched_approval_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_RELEASE_APPROVED_ORIGIN="https://other.example.invalid"))

    def test_http_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_ORIGIN="http://api.example.invalid", AYAILMU_RELEASE_APPROVED_ORIGIN="http://api.example.invalid"))

    def test_localhost_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_ORIGIN="https://localhost:58443", AYAILMU_RELEASE_APPROVED_ORIGIN="https://localhost:58443"))

    def test_private_compilation_flag_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(SWIFT_ACTIVE_COMPILATION_CONDITIONS="PRIVATE_OWNER_QA"))

    def test_missing_sync_policy_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_SYNC_POLICY_VERSION=""))

    def test_malformed_sync_policy_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_SYNC_POLICY_VERSION="not a version"))

    def test_missing_registry_source_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_REGISTRY_SOURCE_COMMIT=""))

    def test_malformed_registry_source_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_REGISTRY_SOURCE_COMMIT="not-a-source-hash"))

    def test_account_free_release_is_allowed(self):
        self.assertEqual(0, self.run_guard(AYAILMU_ORIGIN="", AYAILMU_RELEASE_APPROVED_ORIGIN="", AYAILMU_DECLARATION_VERSION="", AYAILMU_SYNC_POLICY_VERSION=""))

    def test_account_free_release_still_needs_registry_source(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_ORIGIN="", AYAILMU_RELEASE_APPROVED_ORIGIN="", AYAILMU_DECLARATION_VERSION="", AYAILMU_SYNC_POLICY_VERSION="", AYAILMU_REGISTRY_SOURCE_COMMIT=""))

    def test_account_values_without_origin_are_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_ORIGIN="", AYAILMU_RELEASE_APPROVED_ORIGIN=""))

    def test_approval_without_origin_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_ORIGIN=""))



if __name__ == "__main__":
    unittest.main()
