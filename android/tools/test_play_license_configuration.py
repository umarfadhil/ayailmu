"""Real offline Gradle tests for the optional Play licensing public key.

Only public RFC fixture material is used. The isolated GRADLE_USER_HOME supplied by
this worktree is required so no developer properties or credentials are consulted.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest

ANDROID = Path(__file__).resolve().parents[1]
PUBLIC_KEY = (ANDROID / "tools/fixtures/play_rsa_public_key.b64").read_text().strip()
DIAGNOSTIC = "ayailmu.playLicenseKey must be a Base64-encoded RSA X.509 public key"


def ed25519_public_key() -> str:
    """A public-only X.509 key of a non-RSA kind (RFC 8410), with fixed bytes."""
    import base64

    algorithm = bytes.fromhex("300506032b6570")
    public_bits = b"\0" + bytes(range(32))
    encoded = b"\x30" + bytes([len(algorithm) + 3 + len(public_bits)]) + algorithm
    encoded += b"\x03" + bytes([len(public_bits)]) + public_bits
    return base64.b64encode(encoded).decode()


def run_gradle(task: str, key: str | None = None) -> subprocess.CompletedProcess[str]:
    command = ["sh", "gradlew", "--offline", "--no-daemon", "--console=plain"]
    # Always override the property, including the empty case, to isolate the test
    # from any same-named developer property without reading that property.
    command.append("-Payailmu.playLicenseKey=" + (PUBLIC_KEY if key is None else key))
    command.append(task)
    env = os.environ.copy()
    env.setdefault("JAVA_HOME", "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home")
    return subprocess.run(command, cwd=ANDROID, env=env, text=True, capture_output=True, timeout=180)


class PlayLicenseConfigurationTest(unittest.TestCase):
    def assert_rejected(self, result: subprocess.CompletedProcess[str], supplied: str) -> None:
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertNotIn("not found in project", output)
        self.assertIn(DIAGNOSTIC, output)
        self.assertNotIn(supplied, output)

    def test_blank_key_keeps_unsigned_demo_build_available(self) -> None:
        result = run_gradle(":app:generateDemoDebugBuildConfig", "")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        generated = ANDROID / "app/build/generated/source/buildConfig/demo/debug/id/petalytix/ayailmu/BuildConfig.java"
        self.assertIn('String PLAY_LICENSE_KEY = "";', generated.read_text())

    def test_valid_rsa_key_is_embedded_in_demo_build(self) -> None:
        result = run_gradle(":app:generateDemoDebugBuildConfig")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        generated = ANDROID / "app/build/generated/source/buildConfig/demo/debug/id/petalytix/ayailmu/BuildConfig.java"
        self.assertIn(f'String PLAY_LICENSE_KEY = "{PUBLIC_KEY}";', generated.read_text())

    def test_malformed_base64_is_rejected_before_java_generation(self) -> None:
        supplied = "not-base64!"
        self.assert_rejected(run_gradle(":app:generateDemoDebugBuildConfig", supplied), supplied)

    def test_java_and_line_break_payload_is_rejected_and_sanitized(self) -> None:
        supplied = 'bad"\nString INJECTED = "yes'
        self.assert_rejected(run_gradle(":app:generateDemoDebugBuildConfig", supplied), supplied)

    def test_wrong_public_key_kind_is_rejected(self) -> None:
        self.assert_rejected(run_gradle(":app:generateDemoDebugBuildConfig", ed25519_public_key()), ed25519_public_key())

    def test_explicit_check_allows_no_unsigned_release_candidate(self) -> None:
        result = run_gradle(":app:checkPlayLicenseKey", "")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("not found in project", result.stdout + result.stderr)
        self.assertIn("requires a nonempty Base64-encoded RSA X.509 public key", result.stdout + result.stderr)

    def test_explicit_check_rejects_invalid_key(self) -> None:
        supplied = "also-not-a-key"
        self.assert_rejected(run_gradle(":app:checkPlayLicenseKey", supplied), supplied)

    def test_explicit_check_accepts_valid_rsa_key(self) -> None:
        result = run_gradle(":app:checkPlayLicenseKey")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
