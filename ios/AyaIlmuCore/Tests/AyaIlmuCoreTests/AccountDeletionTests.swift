import XCTest
@testable import AyaIlmuCore

private let eraseOwner = "11111111-1111-4111-8111-111111111111"
private let otherOwner = "22222222-2222-4222-8222-222222222222"
private let eraseOrigin = "https://localhost:58443"
private let deletionID = "33333333-3333-4333-8333-333333333333"
private func receiptJSON(_ request:String, completed:Bool = false) -> String {
    "{\"deletion_id\":\"\(deletionID)\",\"scope\":\"account\",\"request_id\":\"\(request)\",\"status\":\"\(completed ? "completed":"identity_deletion_pending")\",\"app_data_erased_at\":\"2026-11-11T12:00:00Z\"" + (completed ? ",\"identity_deleted_at\":\"2026-11-11T12:00:01Z\"}" : "}")
}
private final class DeletionMemoryVault: AccountDeletionVault {
    var values:[PendingAccountDeletion] = []; var failWrite = false; var failRead = false; var discardWrite = false
    func read() throws -> [PendingAccountDeletion] { if failRead { throw AccountError.storage }; return values }
    func write(_ records:[PendingAccountDeletion]) throws { if failWrite { throw AccountError.storage }; if !discardWrite { values = records } }
}
private final class LocalOwnerMemoryVault: CurrentLocalOwnerVault {
    var value:CurrentLocalOwner?; var failWrite = false; var failRead = false; var failDelete = false; var discardWrite = false; var discardDelete = false
    func read() throws -> CurrentLocalOwner? { if failRead { throw AccountError.storage }; return value }
    func write(_ owner:CurrentLocalOwner) throws { if failWrite { throw AccountError.storage }; if !discardWrite { value = owner } }
    func delete() throws { if failDelete { throw AccountError.storage }; if !discardDelete { value = nil } }
}
private final class DeletionTransport: HTTPTransport {
    var requests:[URLRequest] = []
    var handler:(URLRequest) async throws -> HTTPReply = { _ in throw URLError(.notConnectedToInternet) }
    func send(_ request:URLRequest) async throws -> HTTPReply { requests.append(request); return try await handler(request) }
}
@MainActor final class AccountDeletionTests: XCTestCase {
    private struct Fixture {
        let api:AccountAPI; let account:AccountStore; let session:OwnerSession; let sessions:MemoryVault; let localOwners:LocalOwnerMemoryVault
        let proofs:DeletionMemoryVault; let transport:DeletionTransport; let journal:SQLiteJournal; let url:URL; let deletion:AccountDeletionStore
    }
    private func fixture() throws -> Fixture {
        let config = try Configuration(origin:eraseOrigin,allowedOrigins:[eraseOrigin],declarationVersion:"v1",syncPolicyVersion:"policy-v1",registrySourceCommit:String(repeating:"c",count:40))
        let transport = DeletionTransport(); let api = AccountAPI(config:config,transport:transport)
        let sessions = MemoryVault(); let localOwners = LocalOwnerMemoryVault(); let account = AccountStore(api:api,vault:sessions,localOwnerVault:localOwners)
        let auth = try JSONDecoder().decode(AuthSession.self,from:Data(sessionJSON.utf8))
        sessions.value = SavedSession(session:auth,accountID:eraseOwner,origin:eraseOrigin)
        try account.restoreLocalSession()
        // Test fixture capability is explicitly network-verified; no real account is touched.
        let saved = try XCTUnwrap(sessions.value)
        let session = OwnerSession(api:api,saved:saved,networkVerified:true,isCurrent:{ (try? account.ownerSession().ownerID) == eraseOwner })
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("account-erasure-"+UUID().uuidString).appendingPathComponent("learning.sqlite")
        let journal = try SQLiteJournal(url:url); let proofs = DeletionMemoryVault()
        return Fixture(api:api,account:account,session:session,sessions:sessions,localOwners:localOwners,proofs:proofs,transport:transport,journal:journal,url:url,deletion:AccountDeletionStore(api:api,vault:proofs,journal:journal))
    }
    private func fails(_ operation:() async throws -> Void) async {
        do { try await operation(); XCTFail("Expected failure") } catch {}
    }
    func testStrictReceiptShapeTimestampAndIdentity() throws {
        let request = UUID().uuidString.lowercased(); let pending = receiptJSON(request)
        XCTAssertFalse(try AccountDeletionReceipt.parse(Data(pending.utf8),request:request).completed)
        XCTAssertTrue(try AccountDeletionReceipt.parse(Data(receiptJSON(request,completed:true).utf8),request:request).completed)
        let bad = ["{}", pending.dropLast()+",\"extra\":1}",pending.dropLast()+",\"status\":\"identity_deletion_pending\"}",pending.dropLast()+",\"sta\\u0074us\":\"identity_deletion_pending\"}",pending.dropLast()+",\"identity_deleted_at\":null}",pending.replacingOccurrences(of:"account",with:"learner"),pending.replacingOccurrences(of:request,with:UUID().uuidString.lowercased()),pending.replacingOccurrences(of:deletionID,with:"invalid"),pending.replacingOccurrences(of:"identity_deletion_pending",with:"completed"),pending.replacingOccurrences(of:"2026-11-11T12:00:00Z",with:"2026-11-11"),pending.replacingOccurrences(of:"2026-11-11T12:00:00Z",with:"2026-02-30T12:00:00Z"),receiptJSON(request,completed:true).replacingOccurrences(of:"12:00:01Z",with:"11:59:59Z")]
        for raw in bad { XCTAssertThrowsError(try AccountDeletionReceipt.parse(Data(raw.utf8),request:request),raw) }
    }
    func testProofAndOwnerFenceExistBeforeFirstPost() async throws {
        let f = try fixture()
        f.transport.handler = { request in
            let saved = try XCTUnwrap(f.proofs.values.first)
            XCTAssertTrue(try SQLiteJournal(url:f.url).accountFrozen(origin:eraseOrigin,owner:eraseOwner))
            XCTAssertEqual(saved.recoveryToken.count,64); XCTAssertTrue(saved.recoveryToken.allSatisfy { "0123456789abcdef".contains($0) })
            XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer fixture-access")
            let body = try JSONSerialization.jsonObject(with:request.httpBody!) as! [String:Any]
            XCTAssertEqual(Set(body.keys),["account_id","request_id","recovery_token","confirmed"])
            XCTAssertEqual(body["account_id"] as? String,eraseOwner); XCTAssertNotEqual(body["account_id"] as? String,"owner-a")
            XCTAssertEqual(body["recovery_token"] as? String,saved.recoveryToken); XCTAssertEqual(body["confirmed"] as? Bool,true)
            XCTAssertLessThanOrEqual(request.httpBody!.count,1024)
            return reply(receiptJSON(saved.requestID),202)
        }
        let result = try await f.deletion.begin(session:f.session,confirmed:true)
        XCTAssertFalse(result.completed); XCTAssertEqual(f.proofs.values.first?.receipt,result)
        XCTAssertFalse(String(reflecting:f.proofs.values[0]).contains(f.proofs.values[0].recoveryToken))
    }
    func testCancelBeforeConfirmationWritesNothing() async throws {
        let f = try fixture()
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:false) }
        XCTAssertTrue(f.proofs.values.isEmpty); XCTAssertTrue(f.transport.requests.isEmpty)
        XCTAssertFalse(try f.journal.accountFrozen(origin:eraseOrigin,owner:eraseOwner))
    }
    func testVaultFailureOrUnconfirmedDurabilityPreventsIO() async throws {
        for discard in [false,true] {
            let f = try fixture(); f.proofs.failWrite = !discard; f.proofs.discardWrite = discard
            await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
            XCTAssertTrue(f.transport.requests.isEmpty)
        }
    }
    func testLostResponseRestartReusesIdenticalRequestAndProof() async throws {
        let f = try fixture()
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        let first = try XCTUnwrap(f.transport.requests.first?.httpBody)
        let restarted = AccountDeletionStore(api:f.api,vault:f.proofs,journal:try SQLiteJournal(url:f.url))
        XCTAssertEqual(try restarted.restore().count,1)
        f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID),202) }
        _ = try await restarted.begin(session:f.session,confirmed:true)
        XCTAssertEqual(f.transport.requests.last?.httpBody,first)
    }
    func testLogoutKeepsProofAndStatusHasNoBearerCookieOrAuthCall() async throws {
        let f = try fixture()
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        let proof = try XCTUnwrap(f.proofs.values.first)
        _ = try await f.account.signOut(); XCTAssertNil(f.sessions.value); XCTAssertEqual(f.proofs.values,[proof])
        f.transport.requests = []
        f.transport.handler = { request in
            XCTAssertEqual(request.url?.path,"/v1/account/deletion/status"); XCTAssertNil(request.url?.query)
            XCTAssertNil(request.value(forHTTPHeaderField:"Authorization")); XCTAssertNil(request.value(forHTTPHeaderField:"Cookie"))
            let body = try JSONSerialization.jsonObject(with:request.httpBody!) as! [String:String]
            XCTAssertEqual(body,["request_id":proof.requestID,"recovery_token":proof.recoveryToken])
            return reply(receiptJSON(proof.requestID,completed:true))
        }
        guard case .receipt(let receipt) = try await f.deletion.checkStatus(requestID:proof.requestID) else { return XCTFail() }
        XCTAssertTrue(receipt.completed); XCTAssertEqual(f.transport.requests.count,1)
    }
    func testOnly404MeansNotRegisteredAndErrorsKeepProofFrozen() async throws {
        let f = try fixture()
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        let proof = f.proofs.values[0]
        f.transport.handler = { _ in reply("{}",404) }
        guard case .notRegistered = try await f.deletion.checkStatus(requestID:proof.requestID) else { return XCTFail() }
        for status in [401,403,409,429,500,503,302,200,202] {
            f.transport.handler = { _ in reply("{}",status) }
            await fails { _ = try await f.deletion.checkStatus(requestID:proof.requestID) }
        }
        XCTAssertEqual(f.proofs.values,[proof]); XCTAssertTrue(try f.journal.accountFrozen(origin:eraseOrigin,owner:eraseOwner))
    }
    func testCrashBeforeSQLiteFenceRecoversFromSecureProof() throws {
        let f = try fixture(); f.proofs.values = [try .generate(origin:eraseOrigin,ownerID:eraseOwner)]
        XCTAssertFalse(try f.journal.accountFrozen(origin:eraseOrigin,owner:eraseOwner))
        _ = try f.deletion.restore()
        XCTAssertTrue(try SQLiteJournal(url:f.url).accountFrozen(origin:eraseOrigin,owner:eraseOwner))
        XCTAssertFalse(try f.journal.accountFrozen(origin:eraseOrigin,owner:otherOwner))
    }
    func testFreezePreservesHistoryAndBlocksAllLearningNetworkAndLateGrant() async throws {
        let f = try fixture(); let scope = OwnerScope(origin:eraseOrigin,owner:eraseOwner,learner:"server-a")
        let learner = try JSONDecoder().decode(OwnerLearner.self,from:Data(fixtureLearner.utf8))
        try f.journal.insert(scope,learner:learner)
        try f.journal.updateAccount(origin:eraseOrigin,owner:eraseOwner) { $0.profiles = [learner]; $0.selected = learner.id }
        try f.journal.update(scope) { $0.enabled = true; $0.policyVersion = "policy-v1"; $0.answers["answer-a"] = StoredAnswer(payload:fixtureEvent,eligible:true,acknowledgedSequence:nil); $0.eventOrder = ["answer-a"] }
        let learning = LearningStore(session:f.session,journal:try SQLiteJournal(url:f.url)); try learning.restoreOfflineProfiles()
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        f.transport.requests = []
        await fails { try await learning.sync() }; await fails { try await learning.enableSync(proofs:[fixtureProof()]) }; await fails { try await learning.createAdult(language:"en") }; await fails { try await learning.loadProfiles() }
        XCTAssertTrue(f.transport.requests.isEmpty)
        try f.journal.update(scope) { $0.enabled = true; $0.answers["answer-a"]?.eligible = true }
        let retained = try f.journal.read(scope)
        XCTAssertFalse(retained.enabled); XCTAssertFalse(retained.answers["answer-a"]!.eligible)
        XCTAssertEqual(retained.answers["answer-a"]?.payload,fixtureEvent); XCTAssertEqual(try learning.summary().localAnswers,1)
        XCTAssertFalse(try f.journal.accountFrozen(origin:eraseOrigin,owner:otherOwner))
    }
    func testLateDeletionResponseCannotClearNewOwnerAndProofCanRecover() async throws {
        let f = try fixture(); var resume:CheckedContinuation<HTTPReply,Error>?
        f.transport.handler = { _ in try await withCheckedThrowingContinuation { resume = $0 } }
        let task = Task { try await f.deletion.begin(session:f.session,confirmed:true) }
        while resume == nil { await Task.yield() }
        let original = try XCTUnwrap(f.sessions.value)
        f.sessions.value = SavedSession(session:original.session,accountID:otherOwner,origin:eraseOrigin)
        try f.account.restoreLocalSession()
        resume!.resume(returning:reply(receiptJSON(f.proofs.values[0].requestID),202))
        await fails { _ = try await task.value }
        XCTAssertFalse(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
        XCTAssertEqual(f.sessions.value?.accountID,otherOwner); XCTAssertEqual(try f.account.ownerSession().ownerID,otherOwner)
        f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID,completed:true)) }
        _ = try await f.deletion.checkStatus(requestID:f.proofs.values[0].requestID)
        XCTAssertEqual(f.sessions.value?.accountID,otherOwner)
    }
    func testCompletedReceiptNeverRegressesOrChangesIdentity() async throws {
        let f = try fixture()
        f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID,completed:true)) }
        _ = try await f.deletion.begin(session:f.session,confirmed:true)
        let original = f.proofs.values[0]
        for raw in [receiptJSON(original.requestID),receiptJSON(original.requestID,completed:true).replacingOccurrences(of:deletionID,with:UUID().uuidString.lowercased())] {
            f.transport.handler = { _ in reply(raw) }
            await fails { _ = try await f.deletion.checkStatus(requestID:original.requestID) }
            XCTAssertEqual(f.proofs.values[0],original)
        }
        f.transport.handler = { _ in reply("{}",404) }
        await fails { _ = try await f.deletion.checkStatus(requestID:original.requestID) }
    }
    func testWrongOriginOwnerAndCorruptProofFailClosed() async throws {
        let f = try fixture()
        f.proofs.values = [PendingAccountDeletion(origin:"https://other.invalid",ownerID:eraseOwner,requestID:UUID().uuidString.lowercased(),recoveryToken:String(repeating:"a",count:64))]
        XCTAssertThrowsError(try f.deletion.restore())
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        XCTAssertTrue(f.transport.requests.isEmpty)
    }
    func testSameSubjectReloginFencesTheOldDeletionResponse() async throws {
        let f = try fixture()
        func auth(_ request:URLRequest) -> HTTPReply {
            switch request.url!.path {
            case "/token": return reply(sessionJSON)
            case "/user": return reply(userJSON)
            default: return reply("{\"account_id\":\""+eraseOwner+"\"}")
            }
        }
        f.transport.handler = { auth($0) }
        try await f.account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        let previous = try f.account.ownerSession()
        var resume:CheckedContinuation<HTTPReply,Error>?
        f.transport.handler = { request in
            if request.url!.path == "/v1/account/deletion" { return try await withCheckedThrowingContinuation { resume = $0 } }
            return auth(request)
        }
        let deleting = Task { try await f.deletion.begin(session:previous,confirmed:true) }
        while resume == nil { await Task.yield() }
        try await f.account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        let current = try f.account.ownerSession()
        resume!.resume(returning:reply(receiptJSON(f.proofs.values[0].requestID),202))
        await fails { _ = try await deleting.value }
        XCTAssertThrowsError(try previous.check()); XCTAssertNoThrow(try current.check())
        XCTAssertNotNil(f.sessions.value); XCTAssertNil(f.proofs.values[0].receipt)
    }
    func testSQLiteFenceFailureStopsDeletionIO() async throws {
        let f = try fixture()
        try f.journal.freezeAccount(origin:eraseOrigin,owner:eraseOwner,request:UUID().uuidString.lowercased())
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        XCTAssertTrue(f.transport.requests.isEmpty); XCTAssertEqual(f.proofs.values.count,1)
    }
    func testReceiptWriteFailureLeavesRecoverableProof() async throws {
        let f = try fixture()
        f.transport.handler = { _ in f.proofs.failWrite = true; return reply(receiptJSON(f.proofs.values[0].requestID),202) }
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        XCTAssertNil(f.proofs.values[0].receipt); let proof = f.proofs.values[0]
        f.proofs.failWrite = false
        f.transport.handler = { _ in reply(receiptJSON(proof.requestID,completed:true)) }
        _ = try await f.deletion.checkStatus(requestID:proof.requestID)
        XCTAssertEqual(f.proofs.values[0].recoveryToken,proof.recoveryToken)
        XCTAssertTrue(f.proofs.values[0].receipt!.completed)
    }
    func testRetainedHistoryAfterAuthRemovalCannotReopenAfterLogout() async throws {
        let f = try fixture(); let learner = try JSONDecoder().decode(OwnerLearner.self,from:Data(fixtureLearner.utf8))
        let scope = OwnerScope(origin:eraseOrigin,owner:eraseOwner,learner:learner.id)
        try f.journal.insert(scope,learner:learner)
        try f.journal.updateAccount(origin:eraseOrigin,owner:eraseOwner) { $0.profiles = [learner]; $0.selected = learner.id }
        try f.journal.update(scope) { $0.answers["answer-a"] = StoredAnswer(payload:fixtureEvent,eligible:false,acknowledgedSequence:nil); $0.eventOrder = ["answer-a"] }
        f.transport.handler = { request in
            if request.url!.path == "/user" { return reply(userJSON) }
            if request.url!.path == "/v1/account" { return reply("{\"account_id\":\""+eraseOwner+"\"}") }
            return reply(receiptJSON(f.proofs.values[0].requestID,completed:true))
        }
        let model = AccountPresentationModel(store:f.account,deletionStore:f.deletion)
        await model.restore()
        let current = try XCTUnwrap(model.ownerSession)
        await model.deleteAccount(expected:current,confirmed:true)
        XCTAssertNil(f.sessions.value)
        let offline = try XCTUnwrap(model.ownerSession)
        XCTAssertFalse(offline.networkVerified); XCTAssertEqual(offline.ownerID,eraseOwner); XCTAssertEqual(offline.token,"")
        let learning = LearningStore(session:offline,journal:f.journal)
        try learning.restoreOfflineProfiles(); XCTAssertEqual(try learning.summary().localAnswers,1)
        f.transport.requests = []
        await fails { try await learning.sync() }; XCTAssertTrue(f.transport.requests.isEmpty)
        await model.logout(); XCTAssertThrowsError(try offline.check()); XCTAssertEqual(f.proofs.values.count,1)
        await model.checkDeletionStatus(requestID:f.proofs.values[0].requestID)
        XCTAssertNil(model.ownerSession); XCTAssertNil(model.email)
        await model.restore(); XCTAssertNil(model.ownerSession); XCTAssertNil(model.email)
        let auth = try JSONDecoder().decode(AuthSession.self,from:Data(sessionJSON.utf8))
        f.sessions.value = SavedSession(session:auth,accountID:otherOwner,origin:eraseOrigin)
        _ = await model.run { try $0.restoreLocalSession(); return "" }
        await model.checkDeletionStatus(requestID:f.proofs.values[0].requestID)
        XCTAssertEqual(model.ownerSession?.ownerID,otherOwner)
        XCTAssertEqual(try f.journal.account(origin:eraseOrigin,owner:otherOwner).profiles.count,0)
    }
    func testStorageReadinessBlocksBeforeStartupAndAfterCorruptionUntilRecovery() async throws {
        let f = try fixture(); let model = AccountPresentationModel(store:f.account,deletionStore:f.deletion)
        var called = false
        _ = await model.run { _ in called = true; return "" }
        XCTAssertFalse(called); XCTAssertFalse(model.deletionStorageReady); XCTAssertTrue(f.transport.requests.isEmpty)
        // Simulate a crash after the secure proof write and before the SQLite fence.
        f.proofs.values = [try .generate(origin:eraseOrigin,ownerID:eraseOwner)]
        f.proofs.failRead = true
        await model.restore()
        _ = await model.run { store in called = true; try await store.signIn(email:"test@example.invalid",password:"fixture-password",adult:true); return "" }
        XCTAssertFalse(called); XCTAssertFalse(model.deletionStorageReady); XCTAssertTrue(f.transport.requests.isEmpty)
        XCTAssertNil(model.ownerSession)
        f.proofs.failRead = false
        f.transport.handler = { request in request.url!.path == "/user" ? reply(userJSON) : reply("{\"account_id\":\""+eraseOwner+"\"}") }
        await model.restore()
        XCTAssertTrue(model.deletionStorageReady); XCTAssertTrue(try f.journal.accountFrozen(origin:eraseOrigin,owner:eraseOwner))
        let restored = try XCTUnwrap(model.ownerSession)
        f.proofs.failRead = true; f.transport.requests = []
        _ = await model.run { _ in called = true; return "" }
        XCTAssertFalse(called); XCTAssertFalse(model.deletionStorageReady); XCTAssertThrowsError(try restored.check())
        await model.logout(); XCTAssertNil(f.sessions.value); XCTAssertTrue(f.transport.requests.isEmpty)
    }
    func testExactSuccessStatusAndNonzeroIdentifiersAreRequired() async throws {
        let request = UUID().uuidString.lowercased()
        for raw in [receiptJSON(request).replacingOccurrences(of:deletionID,with:"00000000-0000-0000-0000-000000000000"),receiptJSON("00000000-0000-0000-0000-000000000000")] {
            XCTAssertThrowsError(try AccountDeletionReceipt.parse(Data(raw.utf8),request:request))
        }
        for (status,completed) in [(200,false),(202,true),(201,false),(204,true)] {
            let f = try fixture()
            f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID,completed:completed),status) }
            await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
            XCTAssertNil(f.proofs.values[0].receipt)
        }
        let f = try fixture(); f.proofs.values = [try .generate(origin:eraseOrigin,ownerID:eraseOwner)]
        for code in [201,202,204] {
            f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID,completed:true),code) }
            await fails { _ = try await f.deletion.checkStatus(requestID:f.proofs.values[0].requestID) }
        }
        XCTAssertNil(f.proofs.values[0].receipt)
        f.proofs.values = [PendingAccountDeletion(origin:eraseOrigin,ownerID:eraseOwner,requestID:"00000000-0000-0000-0000-000000000000",recoveryToken:String(repeating:"a",count:64))]
        XCTAssertThrowsError(try f.deletion.restore())
    }
    func testReceiptReadbackFailureIsNotSuccess() async throws {
        let f = try fixture()
        f.transport.handler = { _ in f.proofs.discardWrite = true; return reply(receiptJSON(f.proofs.values[0].requestID),202) }
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        XCTAssertNil(f.proofs.values[0].receipt)
    }
    func testStatusRedirectRejectedAndProofGenerationIsIndependent() async throws {
        let f = try fixture(); let first = try PendingAccountDeletion.generate(origin:eraseOrigin,ownerID:eraseOwner)
        let second = try PendingAccountDeletion.generate(origin:eraseOrigin,ownerID:eraseOwner)
        XCTAssertNotEqual(first.requestID,second.requestID); XCTAssertNotEqual(first.recoveryToken,second.recoveryToken)
        f.proofs.values = [first]
        for code in [301,302,303,307,308] {
            f.transport.handler = { _ in reply(receiptJSON(first.requestID,completed:true),code) }
            await fails { _ = try await f.deletion.checkStatus(requestID:first.requestID) }
        }
        XCTAssertNil(f.proofs.values[0].receipt)
        XCTAssertTrue(f.transport.requests.allSatisfy { $0.value(forHTTPHeaderField:"Authorization") == nil && $0.value(forHTTPHeaderField:"Cookie") == nil })
    }

    func testCancellationAndRepeatTapKeepOneDurableRequest() async throws {
        let f = try fixture(); var resume:CheckedContinuation<HTTPReply,Error>?
        f.transport.handler = { _ in try await withCheckedThrowingContinuation { resume = $0 } }
        let task = Task { try await f.deletion.begin(session:f.session,confirmed:true) }
        while resume == nil { await Task.yield() }
        let original = f.proofs.values[0]
        await fails { _ = try await f.deletion.begin(session:f.session,confirmed:true) }
        XCTAssertEqual(f.transport.requests.count,1)
        task.cancel(); resume!.resume(returning:reply(receiptJSON(original.requestID),202))
        await fails { _ = try await task.value }
        XCTAssertEqual(f.proofs.values,[original]); XCTAssertTrue(try f.journal.accountFrozen(origin:eraseOrigin,owner:eraseOwner))
        f.transport.handler = { _ in reply(receiptJSON(original.requestID,completed:true)) }
        _ = try await f.deletion.checkStatus(requestID:original.requestID)
        XCTAssertTrue(f.proofs.values[0].receipt!.completed)
    }

    func testCurrentLocalOwnerRestoresHistoryAfterRestartWithoutAuth() async throws {
        let f = try fixture(); let learner = try JSONDecoder().decode(OwnerLearner.self,from:Data(fixtureLearner.utf8))
        let scope = OwnerScope(origin:eraseOrigin,owner:eraseOwner,learner:learner.id)
        try f.journal.insert(scope,learner:learner)
        try f.journal.updateAccount(origin:eraseOrigin,owner:eraseOwner) { $0.profiles = [learner]; $0.selected = learner.id }
        try f.journal.update(scope) { $0.answers["answer-a"] = StoredAnswer(payload:fixtureEvent,eligible:false,acknowledgedSequence:nil); $0.eventOrder = ["answer-a"] }
        f.transport.handler = { _ in reply(receiptJSON(f.proofs.values[0].requestID,completed:true)) }
        _ = try await f.deletion.begin(session:f.session,confirmed:true)
        XCTAssertTrue(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
        XCTAssertNil(f.sessions.value); XCTAssertEqual(f.localOwners.value?.ownerID,eraseOwner)
        let encoded = try JSONSerialization.jsonObject(with:JSONEncoder().encode(f.localOwners.value!)) as! [String:String]
        XCTAssertEqual(encoded,["origin":eraseOrigin,"ownerID":eraseOwner])
        let restarted = AccountStore(api:f.api,vault:f.sessions,localOwnerVault:f.localOwners)
        f.transport.requests = []; try await restarted.restore()
        XCTAssertTrue(f.transport.requests.isEmpty); XCTAssertTrue(restarted.isOffline)
        let capability = try restarted.ownerSession(); XCTAssertEqual(capability.ownerID,eraseOwner); XCTAssertEqual(capability.token,""); XCTAssertFalse(capability.networkVerified)
        let learning = LearningStore(session:capability,journal:try SQLiteJournal(url:f.url))
        try learning.restoreOfflineProfiles(); XCTAssertEqual(try learning.summary().localAnswers,1)
        await fails { try await learning.sync() }; XCTAssertTrue(f.transport.requests.isEmpty)
        _ = try await restarted.signOut(); XCTAssertNil(f.localOwners.value)
        let afterLogout = AccountStore(api:f.api,vault:f.sessions,localOwnerVault:f.localOwners)
        try await afterLogout.restore(); XCTAssertThrowsError(try afterLogout.ownerSession())
        _ = try await f.deletion.checkStatus(requestID:f.proofs.values[0].requestID)
        try await afterLogout.restore(); XCTAssertThrowsError(try afterLogout.ownerSession()); XCTAssertNil(f.localOwners.value)
        XCTAssertEqual(try f.journal.read(scope).answers.count,1)
    }
    func testSwitchingOwnerDeletesLocalCapabilityBeforeAuthentication() async throws {
        let f = try fixture(); XCTAssertTrue(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
        f.transport.handler = { request in
            XCTAssertNil(f.localOwners.value)
            switch request.url!.path {
            case "/token": return reply(sessionJSON)
            case "/user": return reply(userJSON)
            default: return reply("{\"account_id\":\""+otherOwner+"\"}")
            }
        }
        let old = try f.account.ownerSession()
        try await f.account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        XCTAssertThrowsError(try old.check()); XCTAssertEqual(try f.account.ownerSession().ownerID,otherOwner)
        XCTAssertFalse(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin)); XCTAssertNil(f.localOwners.value)
        let restarted = AccountStore(api:f.api,vault:f.sessions,localOwnerVault:f.localOwners)
        try restarted.restoreLocalSession(); XCTAssertEqual(try restarted.ownerSession().ownerID,otherOwner)
    }
    func testLocalOwnerWriteAndReadbackFailureDoNotDiscardAuth() throws {
        for discard in [false,true] {
            let f = try fixture(); f.localOwners.failWrite = !discard; f.localOwners.discardWrite = discard
            XCTAssertThrowsError(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
            XCTAssertNotNil(f.sessions.value)
        }
    }
    func testInterruptedCredentialRemovalRecoversOnlyMatchingCurrentLocalOwner() async throws {
        let f = try fixture(); f.sessions.failDelete = true
        XCTAssertThrowsError(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
        XCTAssertEqual(f.localOwners.value?.ownerID,eraseOwner); XCTAssertNotNil(f.sessions.value)
        f.sessions.failDelete = false; f.transport.requests = []
        let restarted = AccountStore(api:f.api,vault:f.sessions,localOwnerVault:f.localOwners)
        try await restarted.restore()
        XCTAssertNil(f.sessions.value); XCTAssertTrue(f.transport.requests.isEmpty); XCTAssertTrue(restarted.isOffline)
        XCTAssertEqual(try restarted.ownerSession().ownerID,eraseOwner)
    }
    func testLocalOwnerDeletionFailureBlocksSwitchAndCannotClaimLogout() async throws {
        for discarded in [false,true] {
            let f = try fixture(); XCTAssertTrue(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
            f.localOwners.failDelete = !discarded; f.localOwners.discardDelete = discarded
            await fails { try await f.account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true) }
            XCTAssertTrue(f.transport.requests.isEmpty); XCTAssertThrowsError(try f.account.ownerSession())
            await fails { _ = try await f.account.signOut() }
            XCTAssertNotNil(f.localOwners.value)
            f.localOwners.failDelete = false; f.localOwners.discardDelete = false
            _ = try await f.account.signOut(); XCTAssertNil(f.localOwners.value)
        }
    }
    func testProofCorruptionCannotPreventLocalOwnerLogout() async throws {
        let f = try fixture(); XCTAssertTrue(try f.account.clearErasedOwner(ownerID:eraseOwner,origin:eraseOrigin))
        let model = AccountPresentationModel(store:f.account,deletionStore:f.deletion)
        await model.restore(); XCTAssertEqual(model.ownerSession?.ownerID,eraseOwner)
        f.proofs.failRead = true; f.transport.requests = []
        await model.logout()
        XCTAssertNil(f.localOwners.value); XCTAssertNil(model.ownerSession); XCTAssertFalse(model.deletionStorageReady)
        XCTAssertTrue(f.transport.requests.isEmpty)
    }
    func testForeignOrCorruptLocalOwnerCannotExposeRetainedHistory() async throws {
        let f = try fixture(); let original = try XCTUnwrap(f.sessions.value)
        f.localOwners.value = CurrentLocalOwner(origin:eraseOrigin,ownerID:otherOwner)
        f.account.cancel(); try f.account.restoreLocalSession()
        XCTAssertNil(f.localOwners.value); XCTAssertEqual(try f.account.ownerSession().ownerID,eraseOwner)
        f.localOwners.value = CurrentLocalOwner(origin:"https://other.invalid",ownerID:eraseOwner)
        f.transport.requests = []
        await fails { try await f.account.restore() }; XCTAssertThrowsError(try f.account.ownerSession()); XCTAssertTrue(f.transport.requests.isEmpty)
        f.localOwners.value = nil; f.sessions.value = nil
        XCTAssertFalse(try f.account.clearErasedOwner(ownerID:original.accountID,origin:original.origin))
        XCTAssertNil(f.localOwners.value)
    }

}
