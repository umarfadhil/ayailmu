import SwiftUI
import AyaIlmuCore
@main struct AyaIlmuApp: App {
    var body: some Scene { WindowGroup { AccountView() } }
}
@MainActor final class AccountModel: ObservableObject {
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
            let config = try Configuration(origin:origin,allowedOrigins:allowed,declarationVersion:version)
            store = AccountStore(api:AccountAPI(config:config,transport:transport),vault:KeychainVault(origin:origin))
        } catch { message = "The account service configuration is invalid." }
    }
    func run(_ action:@escaping (AccountStore) async throws -> String) async -> Bool {
        guard let store else { return false }; busy = true; message = ""
        defer { busy = false; email = store.email }
        do { message = try await action(store); return true }
        catch let e as AccountError { message = e.description }
        catch is CancellationError { message = "Account operation cancelled." }
        catch { message = "Cannot connect to the account service. Check your connection and try again." }
        return false
    }
    func restore() async { _ = await run { try await $0.restore(); return "" }
        #if DEBUG && PRIVATE_OWNER_QA
        if ProcessInfo.processInfo.arguments.contains("--no-mail-tls-probe") { await transport.probe() }
        #endif
    }
    func logout() async { _ = await run { let revoked = try await $0.signOut(); return revoked ? "Signed out." : "Signed out on this device. The server could not confirm session revocation." } }
    func cancel() { store?.cancel() }
}
