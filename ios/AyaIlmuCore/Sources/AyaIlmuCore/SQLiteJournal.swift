import Foundation
import CSQLite

struct StoredAnswer: Codable { let payload:String; var eligible:Bool; var acknowledgedSequence:Int64? }
public struct LearningPartition: Codable {
    var schemaVersion = 1
    let learner:OwnerLearner
    var proofs:[String:PackProof] = [:]
    var enabled = false
    var policyVersion:String? = nil
    var withdrawalPending = false
    var answers:[String:StoredAnswer] = [:]
    var remote:[RemoteAnswer] = []
    var cursor:Int64 = 0
    var savedSession:SavedLearningSession? = nil
    var eventOrder:[String]? = []
    var seenScreens:[String:[String]]? = [:]
}
struct PendingProfile: Codable { let clientID:String; let language:String }
struct AccountLearningState: Codable {
    var schemaVersion = 1
    var profiles:[OwnerLearner] = []
    var selected:String? = nil
    var pendingProfile:PendingProfile? = nil
}
/// SQLite commits answer payload, outbox eligibility, acknowledgements and pull cursor atomically.
/// Caller owns one instance; FULLMUTEX/BEGIN IMMEDIATE also serialize separate process connections.
public final class SQLiteJournal {
    private var db:OpaquePointer?
    private let lock = NSRecursiveLock()
    private let transient = unsafeBitCast(-1,to:sqlite3_destructor_type.self)
    public init(url:URL) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:directory.path)
        #endif
        guard sqlite3_open_v2(url.path,&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,nil) == SQLITE_OK else { if let db { sqlite3_close(db) }; db = nil; throw LearningError.storage }
        do {
            sqlite3_busy_timeout(db,3000)
            try execute("PRAGMA journal_mode=WAL"); try execute("PRAGMA synchronous=FULL")
            try execute("CREATE TABLE IF NOT EXISTS progress(origin TEXT NOT NULL,owner TEXT NOT NULL,learner TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(origin,owner,learner))")
            try execute("CREATE TABLE IF NOT EXISTS account_state(origin TEXT NOT NULL,owner TEXT NOT NULL,learner TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(origin,owner,learner))")
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
        } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql:String) throws { guard sqlite3_exec(db,sql,nil,nil,nil) == SQLITE_OK else { throw LearningError.storage } }
    private func statement(_ sql:String,scope:OwnerScope) throws -> OpaquePointer {
        var s:OpaquePointer?; guard sqlite3_prepare_v2(db,sql,-1,&s,nil) == SQLITE_OK, let s else { throw LearningError.storage }
        guard sqlite3_bind_text(s,1,scope.origin,-1,transient) == SQLITE_OK, sqlite3_bind_text(s,2,scope.owner,-1,transient) == SQLITE_OK, sqlite3_bind_text(s,3,scope.learner,-1,transient) == SQLITE_OK else { sqlite3_finalize(s); throw LearningError.storage }; return s
    }
    private func readValue<T:Decodable>(_ table:String,scope:OwnerScope,type:T.Type) throws -> T? {
        let s = try statement("SELECT body FROM \(table) WHERE origin=? AND owner=? AND learner=?",scope:scope); defer { sqlite3_finalize(s) }
        let status = sqlite3_step(s); if status == SQLITE_DONE { return nil }
        guard status == SQLITE_ROW, sqlite3_column_bytes(s,0) <= 16_777_216, let bytes = sqlite3_column_blob(s,0) else { throw LearningError.storage }
        do { return try JSONDecoder().decode(type,from:Data(bytes:bytes,count:Int(sqlite3_column_bytes(s,0)))) } catch { throw LearningError.storage }
    }
    private func writeValue<T:Encodable>(_ value:T,_ table:String,scope:OwnerScope) throws {
        let data = try JSONEncoder().encode(value); guard data.count <= 16_777_216 else { throw LearningError.storage }
        let s = try statement("INSERT INTO \(table)(origin,owner,learner,body) VALUES(?,?,?,?) ON CONFLICT(origin,owner,learner) DO UPDATE SET body=excluded.body",scope:scope); defer { sqlite3_finalize(s) }
        let status = data.withUnsafeBytes { sqlite3_bind_blob(s,4,$0.baseAddress,Int32(data.count),transient) }
        guard status == SQLITE_OK, sqlite3_step(s) == SQLITE_DONE else { throw LearningError.storage }
    }
    func account(origin:String,owner:String) throws -> AccountLearningState {
        lock.lock(); defer { lock.unlock() }
        let state = try readValue("account_state",scope:OwnerScope(origin:origin,owner:owner,learner:""),type:AccountLearningState.self) ?? AccountLearningState()
        guard state.schemaVersion == 1 else { throw LearningError.storage }; return state
    }
    func updateAccount(origin:String,owner:String,_ transform:(inout AccountLearningState) throws -> Void) throws {
        lock.lock(); defer { lock.unlock() }; try execute("BEGIN IMMEDIATE")
        do { var next = try account(origin:origin,owner:owner); try transform(&next); try writeValue(next,"account_state",scope:OwnerScope(origin:origin,owner:owner,learner:"")); try execute("COMMIT") } catch { try? execute("ROLLBACK"); throw error }
    }
    public func read(_ scope:OwnerScope) throws -> LearningPartition {
        lock.lock(); defer { lock.unlock() }
        guard let value = try readValue("progress",scope:scope,type:LearningPartition.self), value.schemaVersion == 1, value.learner.id == scope.learner, value.cursor >= 0 else { throw LearningError.storage }
        try value.learner.validate(); return value
    }
    func pendingWithdrawals(origin:String,owner:String) throws -> [OwnerScope] {
        lock.lock(); defer { lock.unlock() }
        var statement:OpaquePointer?
        guard sqlite3_prepare_v2(db,"SELECT learner FROM progress WHERE origin=? AND owner=? ORDER BY learner",-1,&statement,nil) == SQLITE_OK, let statement else { throw LearningError.storage }; defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement,1,origin,-1,transient); sqlite3_bind_text(statement,2,owner,-1,transient)
        var scopes:[OwnerScope] = []
        while true { let status = sqlite3_step(statement); if status == SQLITE_DONE { return scopes }; guard status == SQLITE_ROW,let raw = sqlite3_column_text(statement,0),scopes.count < 1000 else { throw LearningError.storage }; let scope = OwnerScope(origin:origin,owner:owner,learner:String(cString:raw)); if try read(scope).withdrawalPending { scopes.append(scope) } }
    }
    func insert(_ scope:OwnerScope,learner:OwnerLearner) throws {
        lock.lock(); defer { lock.unlock() }; try execute("BEGIN IMMEDIATE")
        do {
            if let existing = try readValue("progress",scope:scope,type:LearningPartition.self) { guard existing.learner == learner, existing.schemaVersion == 1 else { throw LearningError.invalidData } }
            else { try writeValue(LearningPartition(learner:learner),"progress",scope:scope) }
            try execute("COMMIT")
        } catch { try? execute("ROLLBACK"); throw error }
    }
    func update(_ scope:OwnerScope,_ transform:(inout LearningPartition) throws -> Void) throws {
        lock.lock(); defer { lock.unlock() }; try execute("BEGIN IMMEDIATE")
        do { var next = try read(scope); try transform(&next); try writeValue(next,"progress",scope:scope); try execute("COMMIT") } catch { try? execute("ROLLBACK"); throw error }
    }
}
