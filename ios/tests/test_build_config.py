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

    def test_private_ca_is_rejected(self):
        self.assertNotEqual(0, self.run_guard(AYAILMU_QA_CA_DER="fixture-public-ca.der"))


if __name__ == "__main__":
    unittest.main()
