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
    private let store: AccountStore?
    private var generation = 0

    public init(store: AccountStore?) {
        self.store = store
        if store == nil { message = AccountError.configuration.description }
    }

    @discardableResult public func run(progress: String = "Contacting the account service…", _ action: @escaping (AccountStore) async throws -> String) async -> Bool {
        // Also guard here: restore/resend and submit must never race, even before the UI redraws.
        guard !busy else { return false }
        guard let store else { message = AccountError.configuration.description; return false }
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

    open func restore() async {
        guard !busy else { return }
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
        await run(progress: "Signing out…") {
            let revoked = try await $0.signOut()
            return revoked ? "Signed out." : "Signed out on this device. The server could not confirm session revocation."
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
