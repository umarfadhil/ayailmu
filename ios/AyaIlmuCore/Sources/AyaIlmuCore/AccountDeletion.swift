import Foundation
import Security

func accountDeletionUUID(_ value:String) -> Bool { canonicalUUID(value) && value != "00000000-0000-0000-0000-000000000000" }

public struct AccountDeletionReceipt: Codable, Equatable, Sendable {
    public let deletion_id: String
    public let scope: String
    public let request_id: String
    public let status: String
    public let app_data_erased_at: String
    public let identity_deleted_at: String?
    public var completed: Bool { status == "completed" }
    static func timestamp(_ value: String) -> Date? {
        guard value.count <= 40, value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$", options: .regularExpression) != nil else { return nil }
        let day = String(value.prefix(10))
        let calendar = DateFormatter(); calendar.locale = Locale(identifier:"en_US_POSIX"); calendar.timeZone = TimeZone(secondsFromGMT:0)
        calendar.dateFormat = "yyyy-MM-dd"; calendar.isLenient = false
        guard let date = calendar.date(from:day), calendar.string(from:date) == day else { return nil }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    func validate(request: String) throws {
        guard accountDeletionUUID(deletion_id), scope == "account", accountDeletionUUID(request_id), request_id == request,
              let erased = Self.timestamp(app_data_erased_at) else { throw LearningError.invalidData }
        switch status {
        case "identity_deletion_pending": guard identity_deleted_at == nil else { throw LearningError.invalidData }
        case "completed": guard let raw = identity_deleted_at, let deleted = Self.timestamp(raw), deleted >= erased else { throw LearningError.invalidData }
        default: throw LearningError.invalidData
        }
    }
    static func parse(_ data: Data, request: String) throws -> Self {
        let base: Set<String> = ["deletion_id", "scope", "request_id", "status", "app_data_erased_at"]
        guard data.count <= 2048, let raw = String(data: data, encoding: .utf8) else { throw LearningError.invalidData }
        let object = try StrictJSON.object(raw, keys: base.union(["identity_deleted_at"]))
        let required = object["status"] as? String == "completed" ? base.union(["identity_deleted_at"]) : base
        guard Set(object.keys) == required else { throw LearningError.invalidData }
        let receipt = try JSONDecoder().decode(Self.self, from: data); try receipt.validate(request: request); return receipt
    }
}

/// Only the separate secure vault encodes this record. Never put it in learning exports or logs.
public struct PendingAccountDeletion: Codable, Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public let origin: String
    public let ownerID: String
    public let requestID: String
    let recoveryToken: String
    public internal(set) var receipt: AccountDeletionReceipt?
    public var description: String { "PendingAccountDeletion(redacted)" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["state": "redacted"]) }
    public func validate(origin: String) throws {
        guard self.origin == origin, accountDeletionUUID(ownerID), accountDeletionUUID(requestID), recoveryToken.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw AccountError.storage }
        try receipt?.validate(request: requestID)
    }
    static func generate(origin: String, ownerID: String) throws -> Self {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw AccountError.storage }
        return Self(origin: origin, ownerID: ownerID, requestID: UUID().uuidString.lowercased(), recoveryToken: bytes.map { String(format: "%02x", $0) }.joined())
    }
}
public protocol AccountDeletionVault: AnyObject {
    func read() throws -> [PendingAccountDeletion]
    func write(_ records: [PendingAccountDeletion]) throws
}
public struct AccountDeletionSummary: Identifiable, Equatable {
    public let id: String
    public let ownerID: String
    public let receipt: AccountDeletionReceipt?
}
public enum AccountDeletionLookup { case notRegistered, receipt(AccountDeletionReceipt) }

extension AccountAPI {
    /// Auth-free, read-only recovery. No session or cookie participates in this route.
    func accountDeletionStatus(_ pending: PendingAccountDeletion) async throws -> AccountDeletionLookup {
        try pending.validate(origin: config.origin)
        do {
            let data = try await request("POST", "/v1/account/deletion/status", body: ["request_id": pending.requestID, "recovery_token": pending.recoveryToken], errorField: "error", maxBodyBytes: 1024, maxResponseBytes: 2048, validateResponse: { status,_ in guard status == 200 else { throw LearningError.invalidData } })
            return .receipt(try AccountDeletionReceipt.parse(data, request: pending.requestID))
        } catch AccountError.http(404, _) { return .notRegistered }
    }
}

@MainActor public final class AccountDeletionStore {
    private let api: AccountAPI
    private let vault: AccountDeletionVault
    private let journal: SQLiteJournal
    public var origin: String { api.config.origin }
    private var busy = false
    public init(api: AccountAPI, vault: AccountDeletionVault, journal: SQLiteJournal) { self.api = api; self.vault = vault; self.journal = journal }
    private func records() throws -> [PendingAccountDeletion] {
        let values = try vault.read()
        guard values.count <= 1000, Set(values.map(\.ownerID)).count == values.count, Set(values.map(\.requestID)).count == values.count else { throw AccountError.storage }
        try values.forEach { try $0.validate(origin: api.config.origin) }; return values
    }
    public func restore() throws -> [AccountDeletionSummary] {
        let values = try records()
        // A crash between Keychain persistence and the SQLite fence must not re-enable uploads.
        for record in values { try journal.freezeAccount(origin: record.origin, owner: record.ownerID, request: record.requestID) }
        return values.map { AccountDeletionSummary(id: $0.requestID, ownerID: $0.ownerID, receipt: $0.receipt) }
    }
    private func retain(_ receipt: AccountDeletionReceipt, for pending: PendingAccountDeletion) throws {
        var values = try records()
        guard let index = values.firstIndex(where: { $0.ownerID == pending.ownerID }), values[index].requestID == pending.requestID, values[index].recoveryToken == pending.recoveryToken else { throw LearningError.staleSession }
        if let old = values[index].receipt {
            guard old.deletion_id == receipt.deletion_id, old.app_data_erased_at == receipt.app_data_erased_at, !old.completed || old == receipt else { throw LearningError.invalidData }
        }
        values[index].receipt = receipt; try vault.write(values)
        guard try records() == values else { throw AccountError.storage }
    }
    public func begin(session: OwnerSession, confirmed: Bool) async throws -> AccountDeletionReceipt {
        guard confirmed, !busy else { throw LearningError.invalidData }
        try session.check()
        guard session.networkVerified, session.origin == api.config.origin, accountDeletionUUID(session.ownerID) else { throw LearningError.signInRequired }
        busy = true; defer { busy = false }
        var values = try records()
        let pending: PendingAccountDeletion
        if let old = values.first(where: { $0.ownerID == session.ownerID }) { pending = old }
        else {
            pending = try .generate(origin: session.origin, ownerID: session.ownerID)
            values.append(pending); try vault.write(values)
            // Verify durability before any account erasure I/O. Failure leaves sync closed on restart.
            guard try records() == values else { throw AccountError.storage }
        }
        try journal.freezeAccount(origin: pending.origin, owner: pending.ownerID, request: pending.requestID)
        if let receipt = pending.receipt { return receipt }
        let data = try await session.request("POST", "/v1/account/deletion", body: ["account_id": pending.ownerID, "request_id": pending.requestID, "recovery_token": pending.recoveryToken, "confirmed": true], validateResponse: { status,bytes in
            let receipt = try AccountDeletionReceipt.parse(bytes,request:pending.requestID)
            guard status == (receipt.completed ? 200 : 202) else { throw LearningError.invalidData }
        })
        let receipt = try AccountDeletionReceipt.parse(data, request: pending.requestID)
        try retain(receipt, for: pending); return receipt
    }
    public func checkStatus(requestID: String) async throws -> AccountDeletionLookup {
        guard !busy else { throw LearningError.busy }
        guard let pending = try records().first(where: { $0.requestID == requestID }) else { throw AccountError.storage }
        busy = true; defer { busy = false }
        try journal.freezeAccount(origin: pending.origin, owner: pending.ownerID, request: pending.requestID)
        let status = try await api.accountDeletionStatus(pending)
        if case .receipt(let receipt) = status { try retain(receipt, for: pending) }
        else if pending.receipt != nil { throw LearningError.invalidData }
        return status
    }
}
