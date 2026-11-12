import XCTest
@testable import AyaIlmuCore

@MainActor final class AccountPresentationTests: XCTestCase {
    private func setup() throws -> (AccountPresentationModel, AccountStore, MemoryVault, FixtureTransport) {
        let transport = FixtureTransport(), vault = MemoryVault()
        let config = try Configuration(origin:"https://localhost:58443",allowedOrigins:["https://localhost:58443"],declarationVersion:"qa-adult-owner-v1")
        let store = AccountStore(api:AccountAPI(config:config,transport:transport),vault:vault)
        transport.handler = { path in
            if path.contains("/token") || path == "POST /verify" { return reply(sessionJSON) }
            if path == "GET /user" { return reply(userJSON) }
            return reply("{\"account_id\":\"backend-a\"}")
        }
        return (AccountPresentationModel(store:store),store,vault,transport)
    }
    private func waitFor(_ predicate:() -> Bool) async {
        for _ in 0..<1000 { if predicate() { return }; await Task.yield() }
        XCTFail("Fixture request did not start")
    }
    private func signup(_ model:AccountPresentationModel) async -> Bool {
        await model.run(progress:AccountFormMode.signup.progressTitle) {
            try await $0.signUp(email:"test@example.invalid",password:"fixture-password",adult:true)
            return "Registration submitted. Check your inbox."
        }
    }

    func testInvalidConfigurationIsVisibleWithoutRunningAction() async {
        let model = AccountPresentationModel(store:nil)
        model.message = ""
        let result = await model.run { _ in XCTFail("No configured store"); return "" }
        XCTAssertFalse(result); XCTAssertFalse(model.busy)
        XCTAssertEqual(model.message,AccountError.configuration.description)
    }

    func testFailedSignupReportsSafeMessageAndCanRetryWithoutClaimingLogin() async throws {
        let (model,_,vault,transport) = try setup()
        transport.handler = { _ in reply("{\"error_code\":\"bad_request\",\"message\":\"fixture-password fixture-access test@example.invalid\"}",400) }
        let failed = await signup(model)
        XCTAssertFalse(failed); XCTAssertFalse(model.busy); XCTAssertEqual(model.progress,"")
        XCTAssertFalse(model.message.isEmpty)
        for secret in ["fixture-password","fixture-access","test@example.invalid"] { XCTAssertFalse(model.message.contains(secret)) }
        XCTAssertNil(model.email); XCTAssertNil(model.ownerSession); XCTAssertNil(vault.value)
        transport.handler = { _ in reply("{}") }
        let succeeded = await signup(model)
        XCTAssertTrue(succeeded); XCTAssertEqual(transport.calls,["POST /signup","POST /signup"])
        XCTAssertEqual(model.message,"Registration submitted. Check your inbox.")
        XCTAssertNil(model.email); XCTAssertNil(model.ownerSession); XCTAssertNil(vault.value)
    }

    func testProgressDuplicateSubmitAndRestoreCannotOverlapSignup() async throws {
        let (model,_,_,transport) = try setup()
        var response:CheckedContinuation<HTTPReply,Error>?
        transport.handler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let first = Task { await self.signup(model) }
        await waitFor { response != nil }
        XCTAssertTrue(model.busy); XCTAssertEqual(model.progress,"Creating account…"); XCTAssertEqual(model.message,"")
        let duplicate = await signup(model)
        await model.restore()
        XCTAssertFalse(duplicate); XCTAssertEqual(transport.calls,["POST /signup"])
        XCTAssertTrue(model.busy); XCTAssertEqual(model.progress,"Creating account…")
        response?.resume(returning:reply("{}"))
        let succeeded = await first.value
        XCTAssertTrue(succeeded); XCTAssertFalse(model.busy); XCTAssertEqual(model.progress,"")
    }

    func testRestoreBlocksSignupUntilVerifiedAndPreservesRestoredOwner() async throws {
        let (model,store,_,transport) = try setup()
        try await store.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        transport.calls = []
        var response:CheckedContinuation<HTTPReply,Error>?
        transport.handler = { path in
            if path == "GET /user" { return try await withCheckedThrowingContinuation { response = $0 } }
            return reply("{\"account_id\":\"backend-a\"}")
        }
        let restore = Task { await model.restore() }
        await waitFor { response != nil }
        XCTAssertEqual(model.progress,"Restoring session…")
        let submitted = await signup(model)
        XCTAssertFalse(submitted); XCTAssertEqual(transport.calls,["GET /user"])
        response?.resume(returning:reply(userJSON)); await restore.value
        XCTAssertFalse(model.busy); XCTAssertEqual(model.email,"test@example.invalid")
        XCTAssertNotNil(model.ownerSession); XCTAssertEqual(transport.calls,["GET /user","GET /v1/account"])
    }

    func testCancelledOldRequestCannotEraseNewModeProgressOrMessage() async throws {
        let (model,_,vault,transport) = try setup()
        var signupResponse:CheckedContinuation<HTTPReply,Error>?
        var recoveryResponse:CheckedContinuation<HTTPReply,Error>?
        transport.handler = { path in
            try await withCheckedThrowingContinuation {
                if path == "POST /signup" { signupResponse = $0 } else { recoveryResponse = $0 }
            }
        }
        let old = Task { await self.signup(model) }
        await waitFor { signupResponse != nil }
        model.cancel(); model.message = "" // Explicit mode change clears old feedback.
        XCTAssertFalse(model.busy)
        let next = Task { await model.run(progress:"Sending recovery code…") { try await $0.recover(email:"test@example.invalid"); return "Recovery requested." } }
        await waitFor { recoveryResponse != nil }
        signupResponse?.resume(returning:reply("{}"))
        let oldResult = await old.value
        XCTAssertFalse(oldResult); XCTAssertTrue(model.busy)
        XCTAssertEqual(model.progress,"Sending recovery code…"); XCTAssertEqual(model.message,"")
        recoveryResponse?.resume(returning:reply("{}"))
        let nextResult = await next.value
        XCTAssertTrue(nextResult); XCTAssertFalse(model.busy); XCTAssertEqual(model.message,"Recovery requested.")
        XCTAssertNil(vault.value); XCTAssertNil(model.email)
    }

    func testLogoutFencesPendingLoginPresentationAndSecurePersistence() async throws {
        let (model,_,vault,transport) = try setup()
        var response:CheckedContinuation<HTTPReply,Error>?
        transport.handler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let login = Task { await model.run(progress:"Signing in…") {
            try await $0.signIn(email:"test@example.invalid",password:"fixture-password",adult:true); return "Signed in."
        } }
        await waitFor { response != nil }; await model.logout()
        response?.resume(returning:reply(sessionJSON))
        let succeeded = await login.value
        XCTAssertFalse(succeeded); XCTAssertFalse(model.busy); XCTAssertEqual(model.message,"Signed out.")
        XCTAssertNil(vault.value); XCTAssertNil(model.email); XCTAssertNil(model.ownerSession)
        XCTAssertEqual(transport.calls,["POST /token?grant_type=password"])
    }

    func testReauthenticationFencesPendingResponse() async throws {
        let (model,_,_,transport) = try setup()
        var response:CheckedContinuation<HTTPReply,Error>?
        transport.handler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let pending = Task { await self.signup(model) }
        await waitFor { response != nil }; model.reauthenticate()
        response?.resume(returning:reply("{}"))
        let succeeded = await pending.value
        XCTAssertFalse(succeeded); XCTAssertEqual(model.message,"Sign in again with your password.")
        XCTAssertFalse(model.busy); XCTAssertNil(model.email); XCTAssertNil(model.ownerSession)
    }

    func testNetworkTimeoutTLSAndCancellationHaveVisibleRedactedMessages() async throws {
        for (error,fragment) in [(URLError.timedOut,"took too long"),(.notConnectedToInternet,"Cannot connect"),(.serverCertificateUntrusted,"secure connection"),(.cancelled,"cancelled")] {
            let (model,_,_,transport) = try setup()
            transport.handler = { _ in throw URLError(error,userInfo:[NSLocalizedDescriptionKey:"fixture-password fixture-access test@example.invalid"]) }
            let succeeded = await signup(model)
            XCTAssertFalse(succeeded); XCTAssertFalse(model.busy); XCTAssertTrue(model.message.contains(fragment))
            for secret in ["fixture-password","fixture-access","test@example.invalid"] { XCTAssertFalse(model.message.contains(secret)) }
        }
    }

    func testHTTPFailuresRetainKnownMappingWithoutRawServerDetails() async throws {
        for (status,code,fragment) in [(429,"rate_limit","Too many attempts"),(400,"email_not_confirmed","Confirm your email"),(401,"bad_request","not accepted"),(503,"server_error","could not complete")] {
            let (model,_,_,transport) = try setup()
            transport.handler = { _ in reply("{\"error_code\":\"\(code)\",\"message\":\"fixture-password\"}",status) }
            let succeeded = await signup(model)
            XCTAssertFalse(succeeded); XCTAssertTrue(model.message.contains(fragment)); XCTAssertFalse(model.message.contains("fixture-password"))
        }
    }

    func testAdultGateStillPreventsNetworkRequest() async throws {
        let (model,_,_,transport) = try setup()
        let succeeded = await model.run(progress:"Creating account…") {
            try await $0.signUp(email:"test@example.invalid",password:"fixture-password",adult:false); return "Unexpected success"
        }
        XCTAssertFalse(succeeded); XCTAssertTrue(transport.calls.isEmpty)
        XCTAssertEqual(model.message,AccountError.input.description)
    }

    func testCancelledRestoreDoesNotSilentlyRestoreOfflineSession() async throws {
        let (model,store,_,transport) = try setup()
        try await store.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        transport.handler = { _ in throw URLError(.cancelled) }
        await model.restore()
        XCTAssertNil(model.email); XCTAssertNil(model.ownerSession); XCTAssertFalse(model.offline)
        XCTAssertEqual(model.message,"Account operation cancelled.")
    }

    func testAllAccountModesHaveSpecificProgressText() {
        XCTAssertEqual(AccountFormMode.signup.progressTitle,"Creating account…")
        XCTAssertEqual(Set(AccountFormMode.allCases.map(\.progressTitle)).count,AccountFormMode.allCases.count)
        XCTAssertTrue(AccountFormMode.allCases.allSatisfy { !$0.progressTitle.isEmpty })
    }
}
