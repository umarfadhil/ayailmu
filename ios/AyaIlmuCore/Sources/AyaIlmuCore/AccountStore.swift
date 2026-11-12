import Foundation
/// One active local-only owner, independent of Auth credentials and historical deletion proofs.
public struct CurrentLocalOwner: Codable, Equatable {
    public let origin:String
    public let ownerID:String
    public func validate(origin:String) throws {
        guard self.origin == origin, accountDeletionUUID(ownerID) else { throw AccountError.storage }
    }
}
public protocol CurrentLocalOwnerVault: AnyObject {
    func read() throws -> CurrentLocalOwner?
    func write(_ owner:CurrentLocalOwner) throws
    func delete() throws
}
@MainActor public final class AccountStore {
    public private(set) var email: String?
    public private(set) var isOffline = false
    private let api: AccountAPI; private let vault: SessionVault; private var generation = 0
    private var currentSession: SavedSession?
    private let localOwnerVault: CurrentLocalOwnerVault?
    private var currentLocalOwner: CurrentLocalOwner?
    private var restoreTask: Task<Void, Error>?
    public init(api:AccountAPI,vault:SessionVault,localOwnerVault:CurrentLocalOwnerVault? = nil) { self.api = api; self.vault = vault; self.localOwnerVault = localOwnerVault }
    private func begin() -> Int { generation += 1; isOffline = false; currentSession = nil; currentLocalOwner = nil; restoreTask?.cancel(); restoreTask = nil; return generation }
    private func deleteCurrentLocalOwner() throws {
        guard let localOwnerVault else { return }
        try localOwnerVault.delete()
        guard try localOwnerVault.read() == nil else { throw AccountError.storage }
    }
    private func beginAuthentication() throws -> Int {
        let mark = begin(); email = nil
        // Invalidate the old local owner before any new sign-in or account-switch I/O.
        try deleteCurrentLocalOwner(); return mark
    }
    private func check(_ mark:Int) throws { guard generation == mark, !Task.isCancelled else { throw AccountError.superseded } }
    public func suspendForReauthentication() { _ = begin(); email = nil }
    public func cancel() { _ = begin() }
    private func verified(_ session:AuthSession,email:String) async throws -> AuthSession {
        let user = try await api.user(session.accessToken)
        guard user.id == session.user.id, user.email.lowercased() == email.lowercased(), session.user.email.lowercased() == email.lowercased(), let confirmed = user.emailConfirmedAt, !confirmed.isEmpty else { throw AccountError.identity }; return AuthSession(accessToken:session.accessToken,refreshToken:session.refreshToken,expiresIn:session.expiresIn,tokenType:session.tokenType,user:user)
    }
    private func install(_ s:AuthSession,email:String,mark:Int) async throws {
        let live = try await verified(s,email:email); try check(mark)
        let owner = try await api.owner(live.accessToken,activate:true); try check(mark)
        let saved = SavedSession(session:live,accountID:owner,origin:api.config.origin)
        try vault.write(saved); currentSession = saved; self.email = live.user.email
    }
    public func signIn(email:String,password:String,adult:Bool) async throws { guard adult else { throw AccountError.input }; let mark = try beginAuthentication(); let s = try await api.signIn(email:email,password:password); try check(mark); try await install(s,email:email,mark:mark) }
    public func confirm(email:String,code:String,adult:Bool) async throws { guard adult else { throw AccountError.input }; let mark = try beginAuthentication(); let s = try await api.verify(email:email,code:code,type:"signup"); try check(mark); try await install(s,email:email,mark:mark) }
    public func signUp(email:String,password:String,adult:Bool) async throws { guard adult else { throw AccountError.input }; let mark = try beginAuthentication(); try await api.signUp(email:email,password:password); try check(mark) }
    public func recover(email:String) async throws { let mark = try beginAuthentication(); try await api.recover(email:email); try check(mark) }
    public func resend(email:String) async throws { let mark = try beginAuthentication(); try await api.resend(email:email); try check(mark) }
    public func reset(email:String,code:String,password:String) async throws {
        guard AccountAPI.passwordValid(password) else { throw AccountError.input }
        let mark = try beginAuthentication(); let s = try await api.verify(email:email,code:code,type:"recovery"); try check(mark)
        _ = try await verified(s,email:email); try check(mark)
        let user = try await api.password(password,token:s.accessToken); try check(mark)
        guard user.id == s.user.id, user.email.lowercased() == email.lowercased() else { throw AccountError.identity }
        try vault.delete(); self.email = nil
        try? await api.logout(s.accessToken)
    }
    public func restore() async throws {
        if let task = restoreTask { try await task.value; return }
        let mark = begin()
        let task = Task { try await self.performRestore(mark) }
        restoreTask = task
        defer { if generation == mark { restoreTask = nil } }
        try await task.value
    }
    private func performRestore(_ mark:Int) async throws {
        try check(mark); email = nil
        let stored = try vault.read()
        if try restoreCurrentLocalOwner(stored:stored) { return }
        guard let stored else { return }
        do {
            guard stored.origin == api.config.origin else { throw AccountError.identity }
            var s = stored.session
            do { s = try await verified(s,email:s.user.email) }
            catch let AccountError.http(status,code) where status == 401 || status == 403 && code == "bad_jwt" {
                try check(mark); s = try await api.refresh(s.refreshToken); try check(mark)
                guard s.user.id == stored.session.user.id else { throw AccountError.identity }
                s = try await verified(s,email:stored.session.user.email)
            }
            try check(mark); let owner = try await api.owner(s.accessToken,activate:false); try check(mark)
            guard owner == stored.accountID else { throw AccountError.identity }
            let saved = SavedSession(session:s,accountID:owner,origin:stored.origin)
            try vault.write(saved); currentSession = saved; email = s.user.email
        } catch {
            // Preserve recoverable network/forbidden failures. Delete only this generation's invalid identity.
            if generation == mark {
                if case AccountError.identity = error { try vault.delete() }
                else if case AccountError.http(let status,let code) = error, status == 400 || status == 401 || status == 403 && code == "bad_jwt" { try vault.delete() }
            }
            throw error
        }
    }
    private func installCurrentLocalOwner(_ owner:CurrentLocalOwner) {
        currentSession = nil; currentLocalOwner = owner; isOffline = true; email = "Deleted account · device history"
    }
    private func restoreCurrentLocalOwner(stored:SavedSession?) throws -> Bool {
        guard let owner = try localOwnerVault?.read() else { return false }
        try owner.validate(origin:api.config.origin)
        if let stored, stored.accountID != owner.ownerID || stored.origin != owner.origin {
            // A different saved owner wins; never reveal or preserve the old owner's capability.
            try deleteCurrentLocalOwner(); return false
        }
        // Recover the interrupted write-local-owner/delete-Auth sequence without Auth I/O.
        if stored != nil { try vault.delete() }
        installCurrentLocalOwner(owner); return true
    }
    /// Explicit local-only restore of an identity previously verified and saved in this app's Keychain.
    /// It confers no network access; successful logout removes the only durable source.
    public func restoreLocalSession() throws {
        _ = begin(); email = nil
        let stored = try vault.read()
        if try restoreCurrentLocalOwner(stored:stored) { return }
        guard let stored, stored.origin == api.config.origin,
              validID(stored.accountID), validID(stored.session.user.id),
              AccountAPI.emailValid(stored.session.user.email),
              let confirmed = stored.session.user.emailConfirmedAt, !confirmed.isEmpty else { throw LearningError.signInRequired }
        currentSession = stored; isOffline = true; email = stored.session.user.email
    }
    /// Opaque, memory-only capability. Every request and durable commit rechecks its generation.
    public func ownerSession() throws -> OwnerSession {
        let mark = generation
        if let owner = currentLocalOwner {
            return OwnerSession(api:api,retainedOwnerID:owner.ownerID,isCurrent:{ [self] in generation == mark && currentLocalOwner == owner })
        }
        guard let saved = currentSession else { throw LearningError.signInRequired }
        return OwnerSession(api:api,saved:saved,networkVerified:!isOffline,isCurrent:{ [self] in generation == mark && currentSession != nil })
    }
    /// Synchronous owner fence: an old receipt cannot delete a newer owner's credentials.
    public func clearErasedOwner(ownerID:String,origin:String) throws -> Bool {
        if let current = currentSession, current.accountID != ownerID || current.origin != origin { return false }
        guard let saved = try vault.read(), saved.accountID == ownerID, saved.origin == origin else { return false }
        guard origin == api.config.origin, accountDeletionUUID(ownerID), validID(saved.session.user.id),
              AccountAPI.emailValid(saved.session.user.email), let confirmed = saved.session.user.emailConfirmedAt, !confirmed.isEmpty else { throw AccountError.identity }
        let owner = CurrentLocalOwner(origin:origin,ownerID:ownerID)
        // Establish exactly one local owner while its matching verified saved session exists.
        // If interrupted, restore finishes deleting that same session before exposing local data.
        if let localOwnerVault {
            try localOwnerVault.write(owner)
            guard try localOwnerVault.read() == owner else { throw AccountError.storage }
        }
        try vault.delete(); _ = begin(); installCurrentLocalOwner(owner); return true
    }
    /// True means provider local-session revocation was acknowledged; false means local removal only.
    public func signOut(revoke:Bool = true) async throws -> Bool {
        _ = begin()
        // Corrupt/unreadable payloads must not prevent the independent local delete.
        let snapshot = Result { try vault.read() }
        try deleteCurrentLocalOwner()
        try vault.delete(); email = nil
        guard revoke else { return false }
        switch snapshot {
        case .failure: return false
        case .success(nil): return true
        case .success(let stored?):
            do { try await api.logout(stored.session.accessToken); return true } catch { return false }
        }
    }
}
