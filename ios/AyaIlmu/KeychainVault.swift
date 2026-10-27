import Foundation
import Security
import AyaIlmuCore
/// App + exact origin namespace; no shared access group or plaintext fallback.
final class KeychainVault: SessionVault {
    private let service: String
    init(origin: String) { service = (Bundle.main.bundleIdentifier ?? "id.petalytix.ayailmu.ios") + ".session|" + origin }
    private var query: [String: Any] { [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"owner-session", kSecAttrSynchronizable as String:false] }
    func read() throws -> SavedSession? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary,&item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, data.count <= 65536, let value = try? JSONDecoder().decode(SavedSession.self,from:data) else { throw AccountError.storage }; return value
    }
    func write(_ value: SavedSession) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String:data, kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
        if status == errSecItemNotFound { var q = query; attributes.forEach { q[$0.key] = $0.value }; status = SecItemAdd(q as CFDictionary,nil) }
        guard status == errSecSuccess else { throw AccountError.storage }
    }
    func delete() throws { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw AccountError.storage } }
}
