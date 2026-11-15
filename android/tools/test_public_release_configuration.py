"""Actual offline Gradle configuration tests. No network, account, credential creation, signing or installation.

The supplied GRADLE_USER_HOME is an isolated build cache. Every selected origin/id below is a local
fixture used only to inspect generated configuration, never to connect or publish.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest

ANDROID = Path(__file__).resolve().parents[1]
PUBLIC_KEY = (ANDROID / "tools/fixtures/play_rsa_public_key.b64").read_text().strip()
VALID = dict(format_version="1", application_id="id.petalytix.releasefixture", version_name="1.2.3", version_code="123",
             public_origin="https://api.learn-unit.net", owner_declaration_version="adult-declaration-v1",
             sync_policy_version="learning-sync-v1", registry_source_commit="1234567890abcdef1234567890abcdef12345678",
             play_license_public_key=PUBLIC_KEY, privacy_policy_url="https://www.learn-unit.net/privacy",
             support_url="https://www.learn-unit.net/support", account_deletion_url="https://www.learn-unit.net/account-deletion")


def encoded(values):
    return "".join(f"{key}={value}\n" for key, value in values.items())


class PublicReleaseConfigurationTest(unittest.TestCase):
    def run_gradle(self, text=None, task=":app:checkPublicReleaseInputs", extra=(), symlink=False):
        env = os.environ.copy()
        self.assertIn("GRADLE_USER_HOME", env, "Use the isolated build cache, not the user's default properties")
        with tempfile.TemporaryDirectory(prefix="ayailmu-release-input-test-") as temp:
            command = ["sh", "gradlew", "--offline", "--console=plain", "--no-parallel", "--max-workers=1"]
            if text is not None:
                path = Path(temp) / "inputs.properties"
                path.write_text(text)
                if symlink:
                    link = Path(temp) / "linked.properties"
                    link.symlink_to(path)
                    path = link
                command += ["-Payailmu.publicRelease.inputs=" + str(path)]
            command += list(extra) + [task]
            return subprocess.run(command, cwd=ANDROID, env=env, text=True, capture_output=True, timeout=180)

    def rejected(self, values, task=":app:checkPublicReleaseInputs", extra=(), text=None):
        result = self.run_gradle(encoded(values) if text is None else text, task, extra)
        output = result.stdout + result.stderr
        self.assertNotEqual(0, result.returncode, output)
        self.assertIn("Invalid public release input", output)
        self.assertNotIn("Script compilation error", output)
        return output

    def test_missing_inputs_fail_explicit_gate_and_public_candidate(self):
        for task in (":app:checkPublicReleaseInputs", ":app:assemblePublicReleaseCandidate", ":app:bundlePublicReleaseCandidate"):
            with self.subTest(task=task):
                result = self.run_gradle(task=task)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("Public release inputs are required", result.stdout + result.stderr)
                self.assertNotIn("> Task :app:packageProdRelease", result.stdout)
                self.assertNotIn("> Task :app:signProdReleaseBundle", result.stdout)

    def test_blank_template_cannot_pass(self):
        self.rejected({}, text=(ANDROID / "config/public-release-inputs.example.properties").read_text())

    def test_valid_configuration_generates_only_an_unapproved_plan(self):
        result = self.run_gradle(encoded(VALID))
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        plan = json.loads((ANDROID / "app/build/reports/public-release/configuration-plan.json").read_text())
        self.assertFalse(plan["launch_ready"])
        self.assertEqual("offline-configuration-only", plan["verification"])
        self.assertEqual(VALID["public_origin"], plan["inputs"]["public_origin"])
        self.assertNotIn(PUBLIC_KEY, json.dumps(plan))
        self.assertTrue(plan["selected_prod_features"]["auth"])
        self.assertTrue(plan["selected_prod_features"]["billing"])
        self.assertFalse(plan["selected_prod_features"]["owner_sign_in_only"])
        self.assertGreater(len(plan["unverified_gates"]), 5)

    def test_actual_prod_build_config_uses_exact_inputs_and_normal_flags(self):
        result = self.run_gradle(encoded(VALID), ":app:generateProdReleaseBuildConfig")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        output = (ANDROID / "app/build/generated/source/buildConfig/prod/release/id/petalytix/ayailmu/BuildConfig.java").read_text()
        for expected in ('APPLICATION_ID = "id.petalytix.releasefixture"', 'VERSION_NAME = "1.2.3"', 'VERSION_CODE = 123',
                         'NORMAL_AUTH_APPROVED = true', 'BILLING_ENABLED = true', 'DEVELOPER_DEMO = false',
                         'NORMAL_AUTH_PUBLIC_ORIGIN = "https://api.learn-unit.net"',
                         'NORMAL_AUTH_REQUIRED_ORIGIN = "https://api.learn-unit.net"',
                         f'PLAY_LICENSE_KEY = "{PUBLIC_KEY}"'):
            self.assertIn(expected, output)
        for removed in ('SYNC_LAB_ENABLED', 'NORMAL_OWNER_SIGN_IN_ONLY'):
            self.assertNotIn(removed, output)

    def test_public_inputs_do_not_retarget_demo(self):
        result = self.run_gradle(encoded(VALID), ":app:generateDemoDebugBuildConfig")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        output = (ANDROID / "app/build/generated/source/buildConfig/demo/debug/id/petalytix/ayailmu/BuildConfig.java").read_text()
        self.assertIn('APPLICATION_ID = "id.petalytix.ayailmu.demo"', output)
        self.assertIn('NORMAL_AUTH_APPROVED = false', output)
        self.assertIn('NORMAL_AUTH_PUBLIC_ORIGIN = ""', output)
        self.assertIn('BILLING_ENABLED = false', output)
        self.assertNotIn(VALID["public_origin"], output)

    def test_duplicate_unknown_and_missing_fields_fail(self):
        self.rejected(VALID, text=encoded(VALID) + "version_code=124\n")
        output = self.rejected(VALID, text=encoded(VALID) + "admin_token=do-not-echo-this-sensitive-fixture\n")
        self.assertNotIn("do-not-echo-this-sensitive-fixture", output)
        values = VALID.copy(); del values["support_url"]
        self.rejected(values)

    def test_private_placeholder_and_temporary_origins_fail_before_java_generation(self):
        for value in ("http://api.learn-unit.net", "https://localhost:58443", "https://127.0.0.1", "https://[::1]",
                      "https://api.example.com", "https://a.trycloudflare.com", "https://a.ngrok-free.app",
                      "https://api.learn-unit.net/", "https://api.learn-unit.net?", "https://name@api.learn-unit.net",
                      "https://API.learn-unit.net", "https://api.learn-unit.net:443", "https://api.internal"):
            with self.subTest(value=value):
                self.assertIn("Invalid public release input: public_origin", self.rejected(dict(VALID, public_origin=value), ":app:generateProdReleaseBuildConfig"))

    def test_identity_version_and_registry_validation(self):
        for key, value in (("application_id", "id.petalytix.ayailmu.normalqa"), ("application_id", "com.example.app"),
                           ("version_name", "1.0.0-owner-beta"), ("version_code", "0"), ("version_code", "2100000001"),
                           ("registry_source_commit", "0" * 40), ("owner_declaration_version", "qa-adult-owner-v1"),
                           ("sync_policy_version", "test-sync-v1")):
            with self.subTest(key=key, value=value):
                self.assertIn(f"Invalid public release input: {key}", self.rejected(dict(VALID, **{key: value})))

    def test_required_public_urls_are_not_paths_or_credentials(self):
        for key in ("privacy_policy_url", "support_url", "account_deletion_url"):
            self.assertIn(f"Invalid public release input: {key}", self.rejected(dict(VALID, **{key: "https://user:password@www.learn-unit.net/private"})))
        for path in ("/../privacy", "/%2e%2e/privacy", "/%0aprivacy", "/%5cprivacy"):
            self.assertIn("Invalid public release input: privacy_policy_url", self.rejected(dict(VALID, privacy_policy_url="https://www.learn-unit.net" + path)))

    def test_conflicting_ambient_values_fail_instead_of_overriding(self):
        for key, value in (("umar.normalAuth.approved", "false"), ("umar.normalAuth.publicOrigin", "https://other.learn-unit.net"),
                           ("ayailmu.playLicenseKey", "")):
            with self.subTest(key=key):
                self.assertIn("conflicting build property", self.rejected(VALID, extra=(f"-P{key}={value}",)))

    def test_bad_key_and_line_injection_fail_without_echo(self):
        for value in ("not-a-public-key!", 'bad";INJECTED="yes', "-----BEGIN_PRIVATE_KEY-----"):
            output = self.rejected(dict(VALID, play_license_public_key=value))
            self.assertNotIn(value, output)
            self.assertIn("Invalid public release input: play_license_public_key", output)
        self.rejected(VALID, text=encoded(VALID) + "\\u0061dmin_token=unsafe\n")

    def test_symlink_and_oversized_input_fail(self):
        result = self.run_gradle(encoded(VALID), symlink=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Invalid public release input: file", result.stdout + result.stderr)
        self.rejected(VALID, text="#" + "x" * 17000 + "\n" + encoded(VALID))


if __name__ == "__main__":
    unittest.main(verbosity=2)
