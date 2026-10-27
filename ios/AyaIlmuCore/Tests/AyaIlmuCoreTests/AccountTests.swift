import XCTest
@testable import AyaIlmuCore

final class MemoryVault: SessionVault {
    var value: SavedSession?; var failWrite = false; var failDelete = false; var failRead = false; var deleteAttempts = 0
    func read() throws -> SavedSession? { if failRead { throw AccountError.storage }; return value }
    func write(_ value: SavedSession) throws { if failWrite { throw AccountError.storage }; self.value = value }
    func delete() throws { deleteAttempts += 1; if failDelete { throw AccountError.storage }; value = nil }
}
final class FixtureTransport: HTTPTransport {
    var calls: [String] = []; var bodies: [Data?] = []
    var handler: (String) async throws -> HTTPReply = { _ in HTTPReply(status: 200, data: Data()) }
    func send(_ request: URLRequest) async throws -> HTTPReply {
        calls.append(request.httpMethod! + " " + request.url!.path + (request.url!.query.map { "?" + $0 } ?? "")); bodies.append(request.httpBody)
        return try await handler(calls.last!)
    }
}
let userJSON = "{\"id\":\"owner-a\",\"email\":\"test@example.invalid\",\"email_confirmed_at\":\"2026-01-01\"}"
let sessionJSON = "{\"access_token\":\"fixture-access\",\"refresh_token\":\"fixture-refresh\",\"expires_in\":3600,\"token_type\":\"bearer\",\"user\":" + userJSON + "}"
func reply(_ text: String, _ status: Int = 200) -> HTTPReply { HTTPReply(status: status, data: Data(text.utf8)) }
@MainActor final class AccountTests: XCTestCase {
    func config() throws -> Configuration { try Configuration(origin: "https://localhost:58443", allowedOrigins: ["https://localhost:58443"], declarationVersion: "qa-adult-owner-v1") }
    func setup() throws -> (AccountStore, MemoryVault, FixtureTransport) {
        let t = FixtureTransport(); let v = MemoryVault()
        t.handler = { path in if path.contains("/token") || path.contains("/verify") { return reply(sessionJSON) }; if path == "GET /user" { return reply(userJSON) }; return reply("{\"account_id\":\"backend-a\"}") }
        return (AccountStore(api: AccountAPI(config: try config(), transport: t), vault: v), v, t)
    }
    func testOriginBoundaries() throws {
        for origin in ["http://localhost:58443", "https://evil.invalid", "https://u@localhost:58443", "https://localhost:58443/", "https://localhost:58443?q=1", "https://LOCALHOST:58443", "https://localhost:58443#f"] { XCTAssertThrowsError(try Configuration(origin: origin, allowedOrigins: ["https://localhost:58443"], declarationVersion: "v1")) }
        _ = try config()
    }
    func testLoginActivationAndSecurePersistence() async throws {
        let (s,v,t) = try setup(); try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true)
        XCTAssertEqual(s.email, "test@example.invalid"); XCTAssertEqual(v.value?.accountID, "backend-a")
        XCTAssertEqual(t.calls, ["POST /token?grant_type=password", "GET /user", "POST /v1/account"])
        let body = try JSONSerialization.jsonObject(with: t.bodies[2]!) as! [String: Any]
        XCTAssertEqual(body["synthetic"] as? Bool, false); XCTAssertEqual(body["adult_confirmed"] as? Bool, true); XCTAssertEqual(body["declaration_version"] as? String, "qa-adult-owner-v1")
    }
    func testNoInstallBeforeConfirmation() async throws {
        let(s,v,t) = try setup(); t.handler = { path in path.contains("/token") ? reply(sessionJSON) : reply("{\"id\":\"owner-a\",\"email\":\"test@example.invalid\"}") }
        do { try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true); XCTFail() } catch {}
        XCTAssertNil(v.value); XCTAssertNil(s.email); XCTAssertFalse(t.calls.contains("POST /v1/account"))
    }
    func testRefreshOnlyExpiredJWT() async throws {
        for status in [401,403] {
            let(s,v,t) = try setup(); try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true)
            var first = true; t.calls = []
            t.handler = { path in if path == "GET /user" { if first { first = false; return reply("{\"error_code\":\"bad_jwt\"}", status) }; return reply(userJSON) }; if path.contains("refresh_token") { return reply(sessionJSON) }; return reply("{\"account_id\":\"backend-a\"}") }
            try await s.restore(); XCTAssertNotNil(v.value); XCTAssertTrue(t.calls.contains("POST /token?grant_type=refresh_token")); XCTAssertTrue(t.calls.contains("GET /v1/account")); XCTAssertFalse(t.calls.contains("POST /v1/account"))
        }
    }
    func testUnrelatedForbiddenNeverRefreshes() async throws {
        let(s,_,t) = try setup(); try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true); t.calls = []; t.handler = { _ in reply("{\"error_code\":\"forbidden\"}",403) }
        do { try await s.restore(); XCTFail() } catch {}
        XCTAssertEqual(t.calls,["GET /user"]); XCTAssertNil(s.email)
    }
    func testChangedSubjectAndOwnerFailClosed() async throws {
        for subject in [true,false] {
            let(s,_,t) = try setup(); try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true)
            t.handler = { path in if path == "GET /user" { return subject ? reply("{\"error_code\":\"bad_jwt\"}",403) : reply(userJSON) }; if path.contains("refresh_token") { return reply(sessionJSON.replacingOccurrences(of:"owner-a",with:"owner-b")) }; return reply("{\"account_id\":\"backend-b\"}") }
            do { try await s.restore(); XCTFail() } catch {}; XCTAssertNil(s.email)
        }
    }
    func testVaultFailuresDoNotClaimSuccess() async throws {
        let(s,v,_) = try setup(); v.failWrite = true
        do { try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true); XCTFail() } catch {}; XCTAssertNil(s.email)
        v.failWrite = false; try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true); v.failDelete = true
        do { _ = try await s.signOut(); XCTFail() } catch {}; XCTAssertNotNil(v.value)
    }
    func testLogoutFencesLateLogin() async throws {
        let(s,v,t) = try setup(); var resume: CheckedContinuation<HTTPReply,Error>?
        t.handler = { path in if path.contains("/token") { return try await withCheckedThrowingContinuation { resume = $0 } }; return reply(userJSON) }
        let login = Task { try await s.signIn(email: "test@example.invalid", password: "fixture-password", adult: true) }
        while resume == nil { await Task.yield() }; _ = try await s.signOut(); resume!.resume(returning:reply(sessionJSON))
        do { try await login.value; XCTFail() } catch {}; XCTAssertNil(s.email); XCTAssertNil(v.value)
    }
    func testRedirectRejectedAndDescriptionsRedacted() async throws {
        let(_,_,t) = try setup(); t.handler = { _ in reply("secret",302) }
        let api = AccountAPI(config: try config(), transport:t)
        var sensitive = URLRequest(url:URL(string:"https://example.invalid/token")!); sensitive.httpBody = Data("fixture-password".utf8); sensitive.setValue("Bearer fixture-access",forHTTPHeaderField:"Authorization")
        let native = URLSessionTransport(); let task = URLSession.shared.dataTask(with:sensitive)
        var forwarded: URLRequest? = sensitive
        native.urlSession(.shared,task:task,willPerformHTTPRedirection:HTTPURLResponse(url:sensitive.url!,statusCode:302,httpVersion:nil,headerFields:["Location":"https://other.invalid"])!,newRequest:sensitive) { forwarded = $0 }
        XCTAssertNil(forwarded); task.cancel()
        do { _ = try await api.signIn(email:"test@example.invalid",password:"fixture-password"); XCTFail() } catch { XCTAssertFalse(String(describing:error).contains("secret")) }
    }
    func testConcurrentRestoreUsesOneRotationAndSavesFreshUser() async throws {
        let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        var continuation: CheckedContinuation<HTTPReply,Error>?
        var first = true
        t.calls = []; t.handler = { path in
            if path == "GET /user" { if first { first = false; return reply("{\"error_code\":\"bad_jwt\"}",403) }; return reply(userJSON.replacingOccurrences(of:"2026-01-01",with:"2026-02-02")) }
            if path.contains("refresh_token") { return try await withCheckedThrowingContinuation { continuation = $0 } }
            return reply("{\"account_id\":\"backend-a\"}")
        }
        let a = Task { try await s.restore() }
        while continuation == nil { await Task.yield() }
        let b = Task { try await s.restore() }; for _ in 0..<10 { await Task.yield() }
        continuation!.resume(returning:reply(sessionJSON)); try await a.value; try await b.value
        XCTAssertEqual(t.calls.filter { $0.contains("refresh_token") }.count,1)
        XCTAssertEqual(v.value?.session.user.emailConfirmedAt,"2026-02-02")
    }
    func testConclusiveInvalidRestoreClearsVault() async throws {
        let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        t.handler = { path in path == "GET /user" ? reply("{\"error_code\":\"bad_jwt\"}",403):reply("{}",400) }
        do { try await s.restore(); XCTFail() } catch {}; XCTAssertNil(v.value)
    }
    func testPasswordRejectsControlCharacters() {
        for value in ["fixture-password\n", "fixture-password\r", "fixture-password\0"] { XCTAssertFalse(AccountAPI.passwordValid(value)) }
    }

    func testSignupResendRecoveryAndResetWireContracts() async throws {
        let(s,v,t) = try setup()
        try await s.signUp(email:"test@example.invalid",password:"fixture-password",adult:true)
        XCTAssertNil(s.email); XCTAssertNil(v.value)
        try await s.resend(email:"test@example.invalid"); try await s.recover(email:"test@example.invalid")
        t.handler = { path in path == "POST /verify" ? reply(sessionJSON) : reply(userJSON) }
        try await s.reset(email:"test@example.invalid",code:"123456",password:"new-fixture-password")
        XCTAssertEqual(t.calls,["POST /signup","POST /resend","POST /recover","POST /verify","GET /user","PUT /user","POST /logout?scope=local"])
        let verify = try JSONSerialization.jsonObject(with:t.bodies[3]!) as! [String:String]
        XCTAssertEqual(verify,["email":"test@example.invalid","token":"123456","type":"recovery"])
        XCTAssertNil(v.value); XCTAssertNil(s.email)
    }
    func testLogoutDuringRestoreCannotReinstall() async throws {
        let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        var continuation: CheckedContinuation<HTTPReply,Error>?
        t.handler = { path in if path == "GET /user" { return try await withCheckedThrowingContinuation { continuation = $0 } }; return reply("{}") }
        let restore = Task { try await s.restore() }; while continuation == nil { await Task.yield() }
        _ = try await s.signOut(); continuation!.resume(returning:reply(userJSON))
        do { try await restore.value; XCTFail() } catch {}; XCTAssertNil(v.value); XCTAssertNil(s.email)
    }
    func testLargeResponseAndHeaderInjectionRejected() async throws {
        let(_,_,t) = try setup(); let api = AccountAPI(config:try config(),transport:t)
        do { _ = try await api.user("token\r\nInjected: yes"); XCTFail() } catch {}; XCTAssertTrue(t.calls.isEmpty)
        t.handler = { _ in HTTPReply(status:200,data:Data(repeating:65,count:1048577)) }
        do { _ = try await api.user("fixture-access"); XCTFail() } catch { XCTAssertEqual(String(describing:error), AccountError.tooLarge.description) }
    }

    func testUnreadableVaultStillDeletesAndReportsLocalOnlyLogout() async throws {
        let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        v.failRead = true; t.calls = []
        let providerRevoked = try await s.signOut()
        XCTAssertFalse(providerRevoked); XCTAssertEqual(v.deleteAttempts,1)
        XCTAssertNil(v.value); XCTAssertNil(s.email); XCTAssertTrue(t.calls.isEmpty)
    }
    func testUnreadableVaultDeleteFailureCannotClaimSignout() async throws {
        let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        v.failRead = true; v.failDelete = true; t.calls = []
        do { _ = try await s.signOut(); XCTFail("Delete failure must propagate") } catch {}
        XCTAssertEqual(v.deleteAttempts,1); XCTAssertNotNil(v.value)
        XCTAssertEqual(s.email,"test@example.invalid"); XCTAssertTrue(t.calls.isEmpty)
    }
    func testTerminalRefreshedBadJWTClearsOnlyConclusiveInvalidSession() async throws {
        for failure in ["bad_jwt","forbidden","network"] {
            let(s,v,t) = try setup(); try await s.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
            var userCalls = 0; t.calls = []
            t.handler = { path in
                if path == "GET /user" {
                    userCalls += 1
                    if userCalls == 1 { return reply("{\"error_code\":\"bad_jwt\"}",403) }
                    if failure == "network" { throw URLError(.notConnectedToInternet) }
                    return reply("{\"error_code\":\"" + failure + "\"}",403)
                }
                if path == "POST /token?grant_type=refresh_token" { return reply(sessionJSON.replacingOccurrences(of:"fixture-access",with:"rotated-fixture-access")) }
                XCTFail("Unexpected owner request after failed user verification"); return reply("{}")
            }
            do { try await s.restore(); XCTFail("Restore must fail closed") } catch {}
            XCTAssertEqual(t.calls,["GET /user","POST /token?grant_type=refresh_token","GET /user"])
            XCTAssertEqual(v.value == nil,failure == "bad_jwt"); XCTAssertNil(s.email)
        }
    }

}
