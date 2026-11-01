#!/usr/bin/env python3
"""Verify generated Android identity/redirect isolation; no install, auth or public endpoint."""
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
BASE_ID = "id.petalytix.ayailmu.synclab"
sys.path.insert(0, str(ROOT / "integration/tunnel"))
from tunnel_plan import build_plan


def expected_id(origin):
    if not origin:
        return BASE_ID
    return BASE_ID + ".remote.r" + hashlib.sha256(origin.encode("ascii")).hexdigest()


def main():
    identities = []
    # Always restore local generated output, including after a failed assertion.
    try:
        for origin in ("https://umar-a.example.invalid", "https://umar-b.example.invalid"):
            verify(origin)
            identities.append(expected_id(origin))
        assert len(set(identities)) == 2, "Different origins must have separate Android sandboxes"
    finally:
        verify("")
    print("PASS: two remote origins have separate identities/redirects; local identity preserved")


def verify(origin):
    subprocess.run([
        "sh", str(ANDROID / "gradlew"), "-p", str(ANDROID),
        ":app:generateSyncLabDebugBuildConfig", ":app:processSyncLabDebugManifest",
        "-Pumar.syncLab.publicOrigin=" + origin, "--no-daemon", "--console=plain",
    ], check=True)
    build = ANDROID / "app/build"
    source = (build / "generated/source/buildConfig/syncLab/debug/id/petalytix/ayailmu/BuildConfig.java").read_text()
    actual = re.search(r'APPLICATION_ID = "([^"]+)"', source).group(1)
    assert actual == expected_id(origin), "Generated app identity does not isolate this origin"
    configured = re.search(r'SYNC_LAB_PUBLIC_ORIGIN = "([^"]*)"', source).group(1)
    assert configured == origin, "Generated endpoint changed"
    manifest = ET.parse(build / "intermediates/merged_manifests/syncLabDebug/processSyncLabDebugManifest/AndroidManifest.xml").getroot()
    assert manifest.attrib["package"] == actual
    android = "{http://schemas.android.com/apk/res/android}"
    receiver = next(node for node in manifest.findall(".//activity")
                    if node.attrib.get(android + "name") == "net.openid.appauth.RedirectUriReceiverActivity")
    redirects = [node.attrib.get(android + "scheme") for node in receiver.findall(".//data")]
    assert redirects == [actual], "Callback scheme must belong to this exact app sandbox"
    if origin:
        plan = build_plan(origin, ["192.0.2.1/32"])
        assert plan["android_application_id"] == actual, "Tunnel planner and actual APK identity differ"
        assert plan["compose_env"]["UMAR_REMOTE_CALLBACK"] == actual + "://auth-callback"


if __name__ == "__main__":
    main()
