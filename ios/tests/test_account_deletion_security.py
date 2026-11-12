"""Source guardrails only; these tests do not touch a real Keychain or an account."""
from pathlib import Path
import unittest
root = Path(__file__).resolve().parents[1]
class AccountDeletionSecurity(unittest.TestCase):
    def test_separate_device_only_non_syncing_keychain_record(self):
        code = (root / 'AyaIlmu/KeychainVault.swift').read_text().split('final class KeychainAccountDeletionVault', 1)[1].split('final class KeychainCurrentLocalOwnerVault', 1)[0]
        self.assertIn('".account-deletion|"', code)
        self.assertIn('"pending-account-deletions"', code)
        self.assertIn('kSecAttrSynchronizable as String: false', code)
        self.assertIn('kSecAttrAccessibleWhenUnlockedThisDeviceOnly', code)
        self.assertNotIn('SecItemDelete', code)
        self.assertNotIn('print(', code)
    def test_single_current_local_owner_is_separate_and_removed_on_logout(self):
        code = (root / 'AyaIlmu/KeychainVault.swift').read_text().split('final class KeychainCurrentLocalOwnerVault', 1)[1]
        self.assertIn('".current-local-owner|"', code)
        self.assertIn('"current-local-owner"', code)
        self.assertIn('kSecAttrAccessibleWhenUnlockedThisDeviceOnly', code)
        self.assertIn('kSecAttrSynchronizable as String:false', code)
        self.assertIn('SecItemDelete', code)
        self.assertNotIn('recoveryToken', code)
        self.assertNotIn('accessToken', code)
    def test_secure_random_and_no_learning_secret_persistence(self):
        code = (root / 'AyaIlmuCore/Sources/AyaIlmuCore/AccountDeletion.swift').read_text()
        self.assertIn('SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)', code)
        self.assertIn('[UInt8](repeating: 0, count: 32)', code)
        self.assertIn('String(format: "%02x", $0)', code)
        for name in ['SQLiteJournal.swift', 'LearningStore.swift', 'LearningContracts.swift']:
            self.assertNotIn('recoveryToken', (root / 'AyaIlmuCore/Sources/AyaIlmuCore' / name).read_text())
    def test_network_transport_keeps_redirect_and_cookie_protection(self):
        for name in ['AyaIlmu/PrivateQATrust.swift', 'AyaIlmuCore/Sources/AyaIlmuCore/HTTPClient.swift']:
            code = (root / name).read_text()
            self.assertIn('httpCookieStorage = nil', code)
            self.assertIn('httpShouldSetCookies = false', code)
            self.assertIn('completionHandler(nil)', code)
    def test_recovery_and_local_history_are_explicit(self):
        code = (root / 'AyaIlmu/AccountView.swift').read_text()
        self.assertIn('Delete entire account', code)
        self.assertIn('Permanently delete this entire account?', code)
        self.assertIn('Check deletion status', code)
        self.assertNotIn('Open retained device history', code)
        self.assertIn('!model.deletionStorageReady', code)
        self.assertIn('Delete server copy', code)
if __name__ == '__main__': unittest.main()
