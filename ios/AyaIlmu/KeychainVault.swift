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

/// Independent of the session namespace and logout. Proofs never enter SQLite or exports.
final class KeychainAccountDeletionVault: AccountDeletionVault {
    private let origin: String
    private let service: String
    init(origin: String) {
        self.origin = origin
        service = (Bundle.main.bundleIdentifier ?? "id.petalytix.ayailmu.ios") + ".account-deletion|" + origin
    }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "pending-account-deletions", kSecAttrSynchronizable as String: false] }
    func read() throws -> [PendingAccountDeletion] {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let data = item as? Data, data.count <= 1_048_576,
              let values = try? JSONDecoder().decode([PendingAccountDeletion].self, from: data), values.count <= 1000 else { throw AccountError.storage }
        try values.forEach { try $0.validate(origin: origin) }; return values
    }
    func write(_ records: [PendingAccountDeletion]) throws {
        try records.forEach { try $0.validate(origin: origin) }
        let data = try JSONEncoder().encode(records)
        guard data.count <= 1_048_576 else { throw AccountError.storage }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { var q = query; attributes.forEach { q[$0.key] = $0.value }; status = SecItemAdd(q as CFDictionary, nil) }
        guard status == errSecSuccess else { throw AccountError.storage }
    }
}

/// One current local owner only. Logout removes it; historical proofs cannot recreate it.
final class KeychainCurrentLocalOwnerVault: CurrentLocalOwnerVault {
    private let origin:String
    private let service:String
    init(origin:String) {
        self.origin = origin
        service = (Bundle.main.bundleIdentifier ?? "id.petalytix.ayailmu.ios") + ".current-local-owner|" + origin
    }
    private var query:[String:Any] { [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"current-local-owner", kSecAttrSynchronizable as String:false] }
    func read() throws -> CurrentLocalOwner? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item:CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary,&item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, data.count <= 1024,
              let owner = try? JSONDecoder().decode(CurrentLocalOwner.self,from:data) else { throw AccountError.storage }
        try owner.validate(origin:origin); return owner
    }
    func write(_ owner:CurrentLocalOwner) throws {
        try owner.validate(origin:origin)
        let attributes:[String:Any] = [kSecValueData as String:try JSONEncoder().encode(owner), kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
        if status == errSecItemNotFound { var q = query; attributes.forEach { q[$0.key] = $0.value }; status = SecItemAdd(q as CFDictionary,nil) }
        guard status == errSecSuccess else { throw AccountError.storage }
    }
    func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AccountError.storage }
    }
}
