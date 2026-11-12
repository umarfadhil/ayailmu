import pathlib, plistlib, unittest

class AppIdentityTests(unittest.TestCase):
    def test_display_name_is_ayailmu(self):
        plist = pathlib.Path(__file__).resolve().parents[1] / "AyaIlmu/Info.plist"
        with plist.open("rb") as f:
            self.assertEqual(plistlib.load(f)["CFBundleDisplayName"], "AyaIlmu")

if __name__ == "__main__": unittest.main()
