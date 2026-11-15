import SwiftUI
import AyaIlmuCore
@main struct AyaIlmuApp: App {
    var body: some Scene { WindowGroup { AccountView() } }
}
@MainActor final class AccountModel: AccountPresentationModel {
    private let transport: AppTransport
    /// Learning that needs no account, as on Android. Nil only if the bundled content source is missing.
    let deviceSession: OwnerSession?
    /// False in builds without a backend origin: the app is then account-free, with no sign-in shown.
    let accountAvailable: Bool
    init() {
        let transport = AppTransport()
        self.transport = transport
        deviceSession = try? OwnerSession(deviceRegistrySourceCommit:Bundle.main.object(forInfoDictionaryKey:"AyaIlmuRegistrySourceCommit") as? String ?? "")
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
            let api = AccountAPI(config:config,transport:transport)
            let store = AccountStore(api:api,vault:KeychainVault(origin:origin),localOwnerVault:KeychainCurrentLocalOwnerVault(origin:origin))
            let root = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("AyaIlmu",isDirectory:true)
            let deletion = AccountDeletionStore(api:api,vault:KeychainAccountDeletionVault(origin:origin),journal:try SQLiteJournal(url:root.appendingPathComponent("learning.sqlite")))
            accountAvailable = true
            super.init(store:store,deletionStore:deletion)
        } catch {
            accountAvailable = false
            super.init(store:nil)
            message = ""
        }
    }
    override func restore() async {
        guard accountAvailable else { return }
        await super.restore()
        #if DEBUG && PRIVATE_OWNER_QA
        if ProcessInfo.processInfo.arguments.contains("--no-mail-tls-probe") {
            let core = AppSharedCore.make()
            if let documents = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first { try? "shared_core=\(core.isAvailable ? "available":"unavailable")\nversion=\(core.versionID)\n".write(to:documents.appendingPathComponent("CoreAvailability.txt"),atomically:true,encoding:.utf8) }
            await transport.probe()
        }
        #endif
    }
}
