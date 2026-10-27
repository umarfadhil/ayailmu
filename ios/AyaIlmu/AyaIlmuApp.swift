import SwiftUI
import AyaIlmuCore
@main struct AyaIlmuApp: App {
    var body: some Scene { WindowGroup { AccountView() } }
}
@MainActor final class AccountModel: ObservableObject {
    @Published var ownerSession:OwnerSession?; @Published var offline = false
    @Published var email: String?; @Published var busy = false; @Published var message = ""
    let transport = AppTransport()
    private var store: AccountStore?
    init() {
        do {
            let origin = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuOrigin") as? String ?? ""
            let version = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuDeclarationVersion") as? String ?? ""
            #if DEBUG && PRIVATE_OWNER_QA
            let allowed: Set<String> = ["https://localhost:58443"]
            #else
            let approved = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuApprovedOrigin") as? String ?? ""
            guard let host = URL(string:origin)?.host, !["localhost","127.0.0.1","::1","[::1]"].contains(host), !approved.isEmpty else { throw AccountError.configuration }
            let allowed: Set<String> = [approved]
            #endif
            let policy = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuSyncPolicyVersion") as? String ?? ""
            let source = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuRegistrySourceCommit") as? String ?? ""
            let config = try Configuration(origin:origin,allowedOrigins:allowed,declarationVersion:version,syncPolicyVersion:policy,registrySourceCommit:source)
            store = AccountStore(api:AccountAPI(config:config,transport:transport),vault:KeychainVault(origin:origin))
        } catch { message = "The account service configuration is invalid." }
    }
    func run(_ action:@escaping (AccountStore) async throws -> String) async -> Bool {
        guard let store else { return false }; busy = true; message = ""
        defer { busy = false; email = store.email; offline = store.isOffline; if ownerSession == nil { ownerSession = try? store.ownerSession() } }
        do { message = try await action(store); return true }
        catch let e as AccountError { message = e.description }
        catch is CancellationError { message = "Account operation cancelled." }
        catch { message = "Cannot connect to the account service. Check your connection and try again." }
        return false
    }
    func restore() async { ownerSession = nil; _ = await run { store in
        do { try await store.restore(); return "" }
        catch is URLError { try store.restoreLocalSession(); return "Offline. Showing saved progress on this device." }
    }
        #if DEBUG && PRIVATE_OWNER_QA
        if ProcessInfo.processInfo.arguments.contains("--no-mail-tls-probe") {
            let core = AppSharedCore.make()
            if let documents = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first { try? "shared_core=\(core.isAvailable ? "available":"unavailable")\nversion=\(core.versionID)\n".write(to:documents.appendingPathComponent("CoreAvailability.txt"),atomically:true,encoding:.utf8) }
            await transport.probe()
        }
        #endif
    }
    func logout() async { ownerSession = nil; email = nil; offline = false; _ = await run { let revoked = try await $0.signOut(); return revoked ? "Signed out." : "Signed out on this device. The server could not confirm session revocation." } }
    func reauthenticate() { ownerSession = nil; store?.suspendForReauthentication(); email = nil; offline = false; message = "Sign in again with your password." }
    func cancel() { store?.cancel() }
}
