import unittest

from tunnel_plan import build_plan


class TunnelPlanTest(unittest.TestCase):
    def test_exact_origin_is_shared_and_only_router_is_exposed(self):
        origin = "https://umar-test.example.invalid"
        plan = build_plan(origin, ["8.8.8.8/32"], 60)
        self.assertEqual(origin, plan.get("public_origin"))
        self.assertEqual(origin, plan.get("api_env", {}).get("UMAR_OIDC_ISSUER"))
        self.assertEqual(origin, plan.get("auth_env", {}).get("GOTRUE_JWT_ISSUER"))
        self.assertEqual("true", plan.get("auth_env", {}).get("GOTRUE_DISABLE_SIGNUP"))
        self.assertIn("http://127.0.0.1:8188", plan.get("ngrok", []))
        self.assertIn("--inspect=false", plan.get("ngrok", []))
        self.assertIn("--cidr-allow=8.8.8.8/32", plan.get("ngrok", []))
        self.assertNotIn("--authtoken", " ".join(plan.get("ngrok", [])))
        self.assertEqual(60, plan.get("seconds"))
        self.assertIn("-duration=60s", plan.get("router", []))

    def test_remote_identity_is_stable_origin_scoped_and_matches_callback(self):
        first = build_plan("https://umar-a.example.invalid", ["8.8.8.8/32"])
        same = build_plan("https://umar-a.example.invalid", ["1.1.1.1/32"], 30)
        other = build_plan("https://umar-b.example.invalid", ["8.8.8.8/32"])
        self.assertEqual(first["android_application_id"], same["android_application_id"])
        self.assertNotEqual(first["android_application_id"], other["android_application_id"])
        self.assertRegex(first["android_application_id"], r"^id\.petalytix\.ayailmu\.synclab\.remote\.r[0-9a-f]{64}$")
        callback = first["android_application_id"] + "://auth-callback"
        self.assertEqual(callback, first["compose_env"]["UMAR_REMOTE_CALLBACK"])
        self.assertEqual(callback, first["auth_env"]["GOTRUE_SITE_URL"])
        self.assertEqual(callback, first["auth_env"]["GOTRUE_URI_ALLOW_LIST"])

    def test_requires_exact_tester_addresses_and_bounded_lifetime(self):
        for cidrs in [[], ["0.0.0.0/0"], ["::/0"], ["8.8.8.0/24"], ["not-an-ip"]]:
            with self.subTest(cidrs=cidrs), self.assertRaises(ValueError):
                build_plan("https://umar-test.example.invalid", cidrs)
        for seconds in [0, -1, 1801]:
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                build_plan("https://umar-test.example.invalid", ["8.8.8.8/32"], seconds)

    def test_rejects_origins_that_cannot_match_the_apk_and_issuer(self):
        for origin in ["", "http://example.invalid", " https://example.invalid", "https://EXAMPLE.invalid", "https://user:secret@example.invalid", "https://example.invalid/", "https://example.invalid/auth", "https://example.invalid?", "https://example.invalid#", "https://example.invalid:0", "https://example.invalid:65536", "https://example.invalid:0443"]:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                build_plan(origin, ["8.8.8.8/32"])


if __name__ == "__main__":
    unittest.main()
