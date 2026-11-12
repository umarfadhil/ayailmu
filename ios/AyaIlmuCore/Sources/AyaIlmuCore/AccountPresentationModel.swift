import Foundation
import Combine

/// Account UI state, separate from the app's secure transport/configuration wiring.
@MainActor open class AccountPresentationModel: ObservableObject {
    @Published public private(set) var ownerSession: OwnerSession?
    @Published public private(set) var offline = false
    @Published public private(set) var email: String?
    @Published public private(set) var busy = false
    @Published public private(set) var progress = ""
    @Published public var message = ""
    @Published public private(set) var deletions: [AccountDeletionSummary] = []
    @Published public private(set) var deletionBusy = false
    @Published public private(set) var deletionMessage = ""
    @Published public private(set) var deletionStorageReady: Bool
    private let deletionStore: AccountDeletionStore?
    private let store: AccountStore?
    private var generation = 0

    public init(store: AccountStore?, deletionStore: AccountDeletionStore? = nil) {
        self.store = store; self.deletionStore = deletionStore; deletionStorageReady = deletionStore == nil
        if store == nil { message = AccountError.configuration.description }
    }

    @discardableResult public func run(progress: String = "Contacting the account service…", _ action: @escaping (AccountStore) async throws -> String) async -> Bool {
        // Also guard here: restore/resend and submit must never race, even before the UI redraws.
        guard !busy, !deletionBusy else { return false }
        guard let store else { message = AccountError.configuration.description; return false }
        guard deletionStorageReady else { deletionMessage = "Secure deletion storage must be restored before account access."; return false }
        do { try refreshDeletions() } catch { closeForDeletionStorageFailure(); return false }
        let mark = generation
        busy = true; self.progress = progress; message = ""
        defer {
            if mark == generation {
                busy = false; self.progress = ""
                email = store.email; offline = store.isOffline
                if ownerSession == nil { ownerSession = try? store.ownerSession() }
            }
        }
        do {
            let result = try await action(store)
            guard mark == generation else { return false }
            guard !Task.isCancelled else { message = "Account operation cancelled."; return false }
            message = result
            return true
        } catch {
            guard mark == generation else { return false }
            message = Self.failureMessage(error)
            return false
        }
    }

    private func refreshDeletions() throws {
        deletions = try deletionStore?.restore() ?? []; deletionStorageReady = true
    }
    private func closeForDeletionStorageFailure() {
        deletionStorageReady = false
        cancel(); ownerSession = nil; email = nil; offline = false
        deletionMessage = "Secure deletion recovery is unavailable. Account access and sync remain closed. Unlock the device and retry secure storage."
    }
    private func removeErasedSession(ownerID:String) throws {
        guard let store, let record = deletions.first(where:{$0.ownerID == ownerID}), record.receipt != nil else { return }
        // The store can establish one local owner only from a matching verified saved session.
        // Historical proofs alone cannot establish or switch that capability.
        if try store.clearErasedOwner(ownerID:ownerID,origin:deletionOrigin()) {
            ownerSession = try store.ownerSession(); email = store.email; offline = store.isOffline
        }
    }
    private func deletionOrigin() -> String { deletionStore?.origin ?? "" }
    public func deleteAccount(expected:OwnerSession,confirmed:Bool) async {
        guard !busy, !deletionBusy, deletionStorageReady, let deletionStore, ownerSession === expected, confirmed else { return }
        deletionBusy = true; deletionMessage = "Saving the deletion request and stopping account sync…"
        defer { deletionBusy = false }
        do {
            let receipt = try await deletionStore.begin(session:expected,confirmed:true)
            try refreshDeletions(); try removeErasedSession(ownerID:expected.ownerID)
            deletionMessage = receipt.completed ? "Account deletion completed. Device history is retained." : "App data erased. Sign-in account deletion is pending. Device history is retained."
        } catch {
            do { try refreshDeletions() } catch { closeForDeletionStorageFailure(); return }
            deletionMessage = "Deletion is not confirmed. Check deletion status before retrying; the saved request will be reused. If fresh authentication is required, sign in again with your password."
        }
    }
    public func checkDeletionStatus(requestID:String) async {
        guard !busy, !deletionBusy, let deletionStore else { return }
        deletionBusy = true; deletionMessage = "Checking deletion status…"
        defer { deletionBusy = false }
        do {
            let result = try await deletionStore.checkStatus(requestID:requestID)
            try refreshDeletions()
            switch result {
            case .notRegistered:
                deletionMessage = "This saved request is not registered on the server. Nothing is confirmed deleted. Sign in to the same account and retry deletion; the saved request will be reused. Sync remains stopped."
            case .receipt(let receipt):
                if let record = deletions.first(where:{$0.id == requestID}) { try removeErasedSession(ownerID:record.ownerID) }
                deletionMessage = receipt.completed ? "Account deletion completed. Device history is retained." : "App data erased. Sign-in account deletion is pending. Check again later."
            }
        } catch {
            do { try refreshDeletions() } catch { closeForDeletionStorageFailure(); return }
            deletionMessage = "Current deletion status is unknown. The saved proof and last verified receipt are retained. Check again when connected."
        }
    }
    open func restore() async {
        guard !busy, !deletionBusy else { return }
        do {
            try refreshDeletions()
            for record in deletions where record.receipt != nil { try removeErasedSession(ownerID:record.ownerID) }
        } catch { closeForDeletionStorageFailure(); return }
        ownerSession = nil
        await run(progress: "Restoring session…") { store in
            do { try await store.restore(); return "" }
            catch let error as URLError where error.code != .cancelled {
                try store.restoreLocalSession()
                return "Offline. Showing saved progress on this device."
            }
        }
    }

    public func logout() async {
        cancel()
        ownerSession = nil; email = nil; offline = false
        // Logout must remove the current local owner even if the proof ledger is unreadable.
        do { try refreshDeletions() } catch { closeForDeletionStorageFailure() }
        guard let store else { message = AccountError.configuration.description; return }
        let mark = generation; busy = true; progress = "Signing out…"
        defer { if mark == generation { busy = false; progress = "" } }
        do {
            let revoked = try await store.signOut(revoke:deletionStorageReady)
            guard mark == generation else { return }
            message = revoked ? "Signed out." : "Signed out on this device. The server could not confirm session revocation."
        } catch {
            guard mark == generation else { return }
            message = "Local sign-out could not be saved. Please retry."
        }
    }

    public func reauthenticate() {
        cancel()
        ownerSession = nil; store?.suspendForReauthentication()
        email = nil; offline = false; message = "Sign in again with your password."
    }

    public func cancel() {
        generation += 1; store?.cancel()
        if busy { message = "Account operation cancelled." }
        busy = false; progress = ""
    }

    private static func failureMessage(_ error: Error) -> String {
        if let error = error as? AccountError { return error.description }
        if error is CancellationError { return "Account operation cancelled." }
        if let error = error as? URLError {
            switch error.code {
            case .cancelled: return "Account operation cancelled."
            case .timedOut: return "The account service took too long to respond. Please try again."
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
                return "A secure connection to the account service could not be established. Please try again."
            default: break
            }
        }
        return "Cannot connect to the account service. Check your connection and try again."
    }
}
