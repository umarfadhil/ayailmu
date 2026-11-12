#if os(iOS) && !canImport(AyaIlmu)
#error("Native learning tests require their actual AyaIlmu app host.")
#endif
#if os(iOS) && !canImport(AyaIlmuSharedLearning)
#error("Native learning tests require the actual shared Kotlin framework; portable SwiftPM is a separate test mode.")
#endif
import XCTest
import CSQLite
@testable import AyaIlmuCore

let fixtureLearner = "{\"id\":\"server-a\",\"client_learner_id\":\"native-a\",\"kind\":\"ADULT\",\"audience\":\"adults\",\"lang\":\"en\",\"created_by\":\"\"}"
let fixtureEvent = "{\"answer_id\":\"answer-a\",\"learner_id\":\"native-a\",\"item_id\":\"ITEM-A\",\"track\":\"math\",\"content_version\":\"v1\",\"rules_version\":\"r1\",\"app_version\":\"0.2\",\"timestamp\":\"2026-10-27T12:00:00Z\",\"local_date\":\"2026-10-27\",\"session_id\":\"session-a\",\"lang\":\"en\",\"pool\":\"PRACT\",\"unit\":\"01\",\"skills\":[\"skill-a\"],\"raw_response\":\"{\\\"kind\\\":\\\"choice\\\",\\\"option_id\\\":\\\"a\\\"}\",\"auto_score\":{\"answer\":\"correct\"},\"outcome\":\"correct\",\"first_attempt\":true,\"fresh_evidence\":false,\"review_status\":\"approved\",\"synthetic\":false,\"item_type\":\"choose\"}"
func fixtureProof() -> PackProof { PackProof(track:"math",contentVersion:"v1",rulesVersion:"r1",packSHA256:String(repeating:"a",count:64),rulesSHA256:String(repeating:"b",count:64),sourceCommit:String(repeating:"c",count:40)) }
@MainActor final class LearningTests: XCTestCase {
    func fixture() async throws -> (AccountStore, LearningStore, SQLiteJournal, FixtureTransport, URL) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("learning.sqlite")
        let vault = MemoryVault(); let t = FixtureTransport()
        t.handler = { path in if path.contains("/token") { return reply(sessionJSON) }; if path == "GET /user" { return reply(userJSON) }; return reply("{\"account_id\":\"backend-a\"}") }
        let c = try Configuration(origin:"https://localhost:58443",allowedOrigins:["https://localhost:58443"],declarationVersion:"qa-adult-owner-v1",syncPolicyVersion:"qa-owner-sync-v1",registrySourceCommit:String(repeating:"c",count:40))
        let account = AccountStore(api:AccountAPI(config:c,transport:t),vault:vault)
        try await account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        let journal = try SQLiteJournal(url:url)
        let learning = LearningStore(session:try account.ownerSession(),journal:journal)
        t.handler = { path in if path == "GET /v1/learners" { return reply("["+fixtureLearner+"]") }; if path == "GET /v1/packs" { return reply("{\"source_commit\":\""+String(repeating:"c",count:40)+"\",\"packs\":[{\"track\":\"math\",\"content_version\":\"v1\",\"rules_version\":\"r1\",\"sha256\":\""+String(repeating:"a",count:64)+"\",\"rules_sha256\":\""+String(repeating:"b",count:64)+"\"}]}") }; return reply("{}") }
        try await learning.loadProfiles(); try learning.select("server-a")
        return(account,learning,journal,t,url)
    }
    func testDurableImmutableAnswersNoBackfillAndRestart() async throws {
        let(_,s,j,_,url) = try await fixture()
        try s.capture(fixtureEvent,proof:fixtureProof())
        XCTAssertEqual(try s.summary().pending,0); XCTAssertEqual(try s.summary().localAnswers,1)
        try await s.enableSync(proofs:[fixtureProof()]); try s.capture(fixtureEvent,proof:fixtureProof())
        XCTAssertEqual(try s.summary().pending,0)
        let next = fixtureEvent.replacingOccurrences(of:"answer-a",with:"answer-b")
        try s.capture(next,proof:fixtureProof()); try s.capture(next,proof:fixtureProof())
        XCTAssertEqual(try s.summary().pending,1)
        XCTAssertThrowsError(try s.capture(next.replacingOccurrences(of:"correct",with:"wrong"),proof:fixtureProof()))
        let reopened = try SQLiteJournal(url:url)
        XCTAssertEqual(try reopened.read(s.scope!).answers["answer-b"]?.payload,next)
        XCTAssertEqual(try j.read(s.scope!).answers.count,2)
    }
    func testMalformedPayloadsAndWrongLearnerRejectedAtomically() async throws {
        let(_,s,_,_,_) = try await fixture()
        for bad in ["{}",fixtureEvent.replacingOccurrences(of:"\"answer_id\":\"answer-a\"",with:"\"answer_id\":\"answer-b\",\"answer_id\":\"answer-a\""),fixtureEvent.dropLast()+",\"password\":\"not-allowed\"}",fixtureEvent.replacingOccurrences(of:"native-a",with:"native-other"),fixtureEvent.replacingOccurrences(of:"approved",with:"draft"),fixtureEvent.replacingOccurrences(of:"\"synthetic\":false",with:"\"synthetic\":true"),fixtureEvent.replacingOccurrences(of:"\"first_attempt\":true,",with:""),fixtureEvent.replacingOccurrences(of:"\"lang\":\"en\"",with:"\"lang\":\"xx\"")] { XCTAssertThrowsError(try s.capture(bad,proof:fixtureProof())) }
        XCTAssertEqual(try s.summary().localAnswers,0)
    }
    func testReceiptIntegrityAndExactRetry() async throws {
        let(_,s,_,t,_) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()]); try s.capture(fixtureEvent,proof:fixtureProof())
        let fallback = t.handler; var sent:[String] = []
        t.handler = { path in if path.contains("POST /v1/learners/server-a/events") { sent.append(String(data:t.bodies.last!!,encoding:.utf8)!); return reply("[{\"answer_id\":\"wrong-id\",\"sequence\":1,\"duplicate\":true,\"registry_status\":\"registered\"}]") }; return try await fallback(path) }
        do { try await s.sync(); XCTFail() } catch {}; XCTAssertEqual(try s.summary().pending,1)
        t.handler = { path in if path.contains("POST /v1/learners/server-a/events") { sent.append(String(data:t.bodies.last!!,encoding:.utf8)!); return reply("[{\"answer_id\":\"answer-a\",\"sequence\":1,\"duplicate\":true,\"registry_status\":\"registered\"}]") }; if path.contains("GET /v1/learners/server-a/events") { return reply("{\"events\":[],\"next_cursor\":0,\"has_more\":false}") }; return try await fallback(path) }
        try await s.sync(); XCTAssertEqual(sent[0],sent[1]); XCTAssertEqual(try s.summary().pending,0)
    }
    func testPullPageAtomicValidationAndConflict() async throws {
        let(_,s,j,t,_) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()])
        let fallback = t.handler
        t.handler = { path in if path.contains("GET /v1/learners/server-a/events") { let record:[String:Any] = ["sequence":2,"payload":fixtureEvent,"registry_status":"registered"]; return HTTPReply(status:200,data:try JSONSerialization.data(withJSONObject:["events":[record],"next_cursor":2,"has_more":false])) }; return try await fallback(path) }
        do { try await s.sync(); XCTFail() } catch {}; XCTAssertEqual(try j.read(s.scope!).cursor,0); XCTAssertEqual(try s.summary().remoteAnswers,0)
    }
    func testLogoutFencesLateLearnerReplyAndContext() async throws {
        let(account,s,_,t,_) = try await fixture(); var continuation:CheckedContinuation<HTTPReply,Error>?
        t.handler = { path in if path == "GET /v1/learners" { return try await withCheckedThrowingContinuation { continuation = $0 } }; return reply("{}") }
        let load = Task { try await s.loadProfiles() }; while continuation == nil { await Task.yield() }
        _ = try await account.signOut(); continuation!.resume(returning:reply("["+fixtureLearner+"]"))
        do { try await load.value; XCTFail() } catch {}; XCTAssertThrowsError(try s.summary()); XCTAssertThrowsError(try account.ownerSession())
    }
    func testDisableOfflinePersistsWithdrawalAndStopsUploads() async throws {
        let(_,s,j,t,url) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()]); try s.capture(fixtureEvent,proof:fixtureProof())
        t.handler = { _ in throw URLError(.notConnectedToInternet) }
        do { try await s.disableSync(); XCTFail() } catch {}
        let state = try SQLiteJournal(url:url).read(s.scope!); XCTAssertFalse(state.enabled); XCTAssertTrue(state.withdrawalPending)
        XCTAssertEqual(try j.read(s.scope!).answers.count,1)
        t.calls = []; do { try await s.sync(); XCTFail() } catch {}; XCTAssertFalse(t.calls.contains(where:{$0.contains("/events")}))
    }
    func testSharedGradingAndContentFailClosed() throws {
        XCTAssertFalse(UnavailableSharedGrader().isAvailable)
        XCTAssertThrowsError(try UnavailableSharedGrader().grade(itemJSON:"{}",responseJSON:"{}",rulesJSON:"{}",language:"en"))
        #if os(iOS)
        XCTAssertEqual(ApprovedLessonLibrary.bundled.lessons.count,2)
        #else
        XCTAssertTrue(ApprovedLessonLibrary.bundled.lessons.isEmpty)
        #endif
    }

    /// Catches missing/altered reviewed resources and accidental widening to draft or synthetic content.
    func testReviewedMathResourcesLoadOnlyTheExactApprovedSubset() throws {
        #if os(iOS)
        let resources = try XCTUnwrap(Bundle.main.resourceURL)
        #else
        let resources = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("AyaIlmu/Resources/ReviewedMath")
        #endif
        let names = ["ApprovedLearning","ReviewedMathPack","ReviewedMathRules","ReviewedCatalog"]
        for name in names { XCTAssertTrue(FileManager.default.fileExists(atPath:resources.appendingPathComponent(name+".json").path),"Missing reviewed resource: \(name)") }
        guard names.allSatisfy({FileManager.default.fileExists(atPath:resources.appendingPathComponent($0+".json").path)}) else { return }
        let pack = try Data(contentsOf:resources.appendingPathComponent("ReviewedMathPack.json"))
        let rules = try Data(contentsOf:resources.appendingPathComponent("ReviewedMathRules.json"))
        let catalog = try Data(contentsOf:resources.appendingPathComponent("ReviewedCatalog.json"))
        let manifest = try Data(contentsOf:resources.appendingPathComponent("ApprovedLearning.json"))
        let source = "b6e0d6123cb359436f83ce3ae0685198ee13a815"
        let expectedIDs = Set((1...14).map { String(format:"MAT-A-P-01-%03d",$0) })
        for language in ["id","en"] {
            let library = try ApprovedLessonLibrary.load(pack:pack,rules:rules,catalog:catalog,source:source,language:language)
            XCTAssertEqual(library.lessons.count,1)
            let lesson = try XCTUnwrap(library.lessons.first)
            XCTAssertEqual(lesson.id,"mat-a-local:01"); XCTAssertEqual(lesson.language,language)
            XCTAssertEqual(Set(lesson.items.map(\.id)),expectedIDs)
            XCTAssertEqual(lesson.screens.map(\.id),["MAT-A-P-01-S1"])
            XCTAssertEqual(lesson.proof.packSHA256,"7ed58f9684e68f6fef43fcd9ea3e65ff50e530663cec495f207bce20b1bcab0c")
            XCTAssertEqual(lesson.proof.rulesSHA256,"1871e9d58f00593138026d7adb332b870b31b9cb5c03b874aae0fdfa68440ce9")
            XCTAssertEqual(lesson.proof.sourceCommit,source)
        }
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:pack+Data(" ".utf8),rules:rules,catalog:catalog,source:source,language:"en"))
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:pack,rules:rules+Data(" ".utf8),catalog:catalog,source:source,language:"en"))
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:pack,rules:rules,catalog:catalog,source:String(repeating:"0",count:40),language:"en"))
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:pack,rules:rules,catalog:catalog,source:source,language:"fr"))
        let changed = Data(String(data:pack,encoding:.utf8)!.replacingOccurrences(of:"\"review_status\": \"approved\"",with:"\"review_status\": \"draft\"").utf8)
        XCTAssertNotEqual(changed,pack)
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:changed,rules:rules,catalog:catalog,source:source,language:"en"))
        let read:(String) throws -> Data = { try Data(contentsOf:resources.appendingPathComponent($0+".json")) }
        let bilingual = try ApprovedLessonLibrary.loadResources(manifest:manifest,source:source,resource:read)
        XCTAssertEqual(bilingual.lessons.map(\.language),["id","en"])
        XCTAssertEqual(bilingual.lessons.map(\.id),["mat-a-local:01","mat-a-local:01"])
        XCTAssertTrue(bilingual.lessons.allSatisfy{$0.items.count == 14 && $0.screens.count == 1})
        XCTAssertThrowsError(try ApprovedLessonLibrary.loadResources(manifest:manifest,source:source) { name in
            if name == "ReviewedMathPack" { return changed }; return try read(name)
        })
        XCTAssertThrowsError(try ApprovedLessonLibrary.loadResources(manifest:manifest,source:source) { name in
            if name == "ReviewedMathRules" { throw CocoaError(.fileNoSuchFile) }; return try read(name)
        })
        for mutation in [
            ["catalog":"../ReviewedCatalog","languages":["en"],"packs":[["pack":"ReviewedMathPack","rules":"ReviewedMathRules"]]],
            ["catalog":"ReviewedCatalog","languages":["fr"],"packs":[["pack":"ReviewedMathPack","rules":"ReviewedMathRules"]]],
            ["catalog":"ReviewedCatalog","languages":["en","en"],"packs":[["pack":"ReviewedMathPack","rules":"ReviewedMathRules"]]],
            ["catalog":"ReviewedCatalog","languages":["en"],"packs":[["pack":"ReviewedMathPack","rules":"ReviewedMathRules"],["pack":"ReviewedMathPack","rules":"ReviewedMathRules"]]],
        ] as [[String:Any]] {
            XCTAssertThrowsError(try ApprovedLessonLibrary.loadResources(manifest:JSONSerialization.data(withJSONObject:mutation),source:source,resource:read))
        }
    }
    func testOwnerAndLearnerNamespacesAndStaleSelection() async throws {
        let(account,s,j,t,url) = try await fixture(); try s.capture(fixtureEvent,proof:fixtureProof())
        let original = s.scope!
        let secondJSON = fixtureLearner.replacingOccurrences(of:"server-a",with:"server-b").replacingOccurrences(of:"native-a",with:"native-b")
        t.handler = { _ in reply("["+fixtureLearner+","+secondJSON+"]") }; try await s.loadProfiles(); try s.select("server-b")
        XCTAssertEqual(try s.summary().localAnswers,0); XCTAssertEqual(try j.read(original).answers.count,1)
        XCTAssertThrowsError(try s.capture(fixtureEvent,proof:fixtureProof()))
        var continuation:CheckedContinuation<HTTPReply,Error>?
        t.handler = { _ in try await withCheckedThrowingContinuation { continuation = $0 } }
        let late = Task { try await s.loadProfiles() }; while continuation == nil { await Task.yield() }
        try s.select("server-a"); continuation!.resume(returning:reply("["+secondJSON+"]"))
        do { try await late.value; XCTFail() } catch {}; XCTAssertEqual(s.scope,original)
        t.handler = { _ in reply("{}") }; _ = try? await account.signOut()
        // A real second account capability is created only through the test fixture provider.
        t.handler = { path in if path.contains("/token") { return reply(sessionJSON.replacingOccurrences(of:"owner-a",with:"owner-b")) }; if path == "GET /user" { return reply(userJSON.replacingOccurrences(of:"owner-a",with:"owner-b")) }; return reply("{\"account_id\":\"backend-b\"}") }
        try await account.signIn(email:"test@example.invalid",password:"fixture-password",adult:true)
        let b = LearningStore(session:try account.ownerSession(),journal:try SQLiteJournal(url:url))
        try b.restoreOfflineProfiles(); XCTAssertTrue(b.profiles.isEmpty)
        t.handler = { _ in reply("["+fixtureLearner+"]") }; try await b.loadProfiles(); try b.select("server-a")
        XCTAssertEqual(try b.summary().localAnswers,0); XCTAssertEqual(try j.read(original).answers.count,1)
        XCTAssertThrowsError(try s.summary())
    }
    func testAtomicTransactionFailureAndCorruptDatabaseFailClosed() async throws {
        let(_,s,j,_,url) = try await fixture(); try s.capture(fixtureEvent,proof:fixtureProof())
        do { try j.update(s.scope!) { state in state.answers.removeAll(); state.cursor = 90; throw LearningError.storage }; XCTFail() } catch {}
        let reopened = try SQLiteJournal(url:url); XCTAssertEqual(try reopened.read(s.scope!).cursor,0); XCTAssertEqual(try reopened.read(s.scope!).answers.count,1)
        let corrupt = url.deletingLastPathComponent().appendingPathComponent("corrupt.sqlite"); try Data("broken".utf8).write(to:corrupt)
        XCTAssertThrowsError(try SQLiteJournal(url:corrupt)); XCTAssertEqual(try Data(contentsOf:corrupt),Data("broken".utf8))
    }
    func testMixedMalformedPullPageRejectsWholePageAndRawConflict() async throws {
        for bad in ["wrong-learner","draft","raw-conflict","cursor","duplicate","unregistered"] {
            let(_,s,j,t,_) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()]); try s.capture(fixtureEvent,proof:fixtureProof())
            let fallback = t.handler
            t.handler = { path in
                if path.contains("POST /v1/learners/server-a/events") { return reply("[{\"answer_id\":\"answer-a\",\"sequence\":1,\"duplicate\":false,\"registry_status\":\"registered\"}]") }
                if path.contains("GET /v1/learners/server-a/events") {
                    let next = fixtureEvent.replacingOccurrences(of:"answer-a",with:bad == "duplicate" ? "answer-a":"answer-b")
                    let payload = bad == "wrong-learner" ? next.replacingOccurrences(of:"native-a",with:"other") : bad == "draft" ? next.replacingOccurrences(of:"approved",with:"draft") : next
                    let firstPayload = bad == "raw-conflict" ? fixtureEvent+" " : fixtureEvent
                    let records:[[String:Any]] = [["sequence":1,"payload":firstPayload,"registry_status":"registered"],["sequence":2,"payload":payload,"registry_status":bad == "unregistered" ? "unregistered":"registered"]]
                    return HTTPReply(status:200,data:try JSONSerialization.data(withJSONObject:["events":records,"next_cursor":bad == "cursor" ? 3:2,"has_more":false]))
                }; return try await fallback(path)
            }
            do { try await s.sync(); XCTFail(bad) } catch {}; XCTAssertEqual(try j.read(s.scope!).cursor,0); XCTAssertEqual(try s.summary().remoteAnswers,0)
        }
    }
    func testBackendConsentErrorAndProfileCreationWireContract() async throws {
        let(_,s,_,t,_) = try await fixture(); let fallback = t.handler
        t.handler = { path in if path == "POST /v1/learners" {
            let body = try JSONSerialization.jsonObject(with:t.bodies.last!!) as! [String:Any]
            XCTAssertEqual(body["kind"] as? String,"ADULT"); XCTAssertEqual(body["synthetic"] as? Bool,false); XCTAssertNil(body["created_by"])
            return reply(fixtureLearner.replacingOccurrences(of:"native-a",with:body["client_learner_id"] as! String).replacingOccurrences(of:"server-a",with:"new-server"))
        }; return try await fallback(path) }
        try await s.createAdult(language:"en"); XCTAssertEqual(s.scope?.learner,"new-server")
        t.handler = { path in if path.contains("/consent") { return reply("{\"error\":\"fresh_authentication_required\"}",403) }; return try await fallback(path) }
        do { try await s.enableSync(proofs:[fixtureProof()]); XCTFail() } catch let LearningError.backend(_,code) { XCTAssertEqual(code,"fresh_authentication_required") } catch { XCTFail("Backend error field was not preserved") }
        XCTAssertFalse(try s.summary().enabled)
    }

    func testActualOfflineAccountRestartAllowsLocalHistoryOnlyUntilVerification() async throws {
        let(account,s,j,t,_) = try await fixture(); try s.capture(fixtureEvent,proof:fixtureProof())
        let saved = MemoryVault(); let originalCapability = try account.ownerSession()
        // Simulate process restart with the original Keychain snapshot, never a fresh login fixture.
        let session = try JSONDecoder().decode(AuthSession.self,from:Data(sessionJSON.utf8))
        saved.value = SavedSession(session:session,accountID:originalCapability.ownerID,origin:originalCapability.origin)
        let restarted = AccountStore(api:originalCapability.api,vault:saved)
        t.handler = { _ in throw URLError(.notConnectedToInternet) }
        do { try await restarted.restore(); XCTFail() } catch {}
        try restarted.restoreLocalSession()
        let local = LearningStore(session:try restarted.ownerSession(),journal:j); try local.restoreOfflineProfiles()
        XCTAssertEqual(try local.summary().localAnswers,1); XCTAssertTrue(restarted.isOffline)
        t.calls = []; do { try await local.loadProfiles(); XCTFail() } catch {}; do { try await local.createAdult(language:"en"); XCTFail() } catch {}
        XCTAssertTrue(t.calls.isEmpty)
        _ = try await restarted.signOut(); XCTAssertThrowsError(try local.summary())
        XCTAssertThrowsError(try restarted.restoreLocalSession()); XCTAssertNil(saved.value)
    }

    func testOwnerWideWithdrawalBeforeNewLearnerGrant() async throws {
        let(_,s,_,t,_) = try await fixture(); let fallback = t.handler
        let second = fixtureLearner.replacingOccurrences(of:"server-a",with:"server-b").replacingOccurrences(of:"native-a",with:"native-b")
        t.handler = { path in path == "GET /v1/learners" ? reply("["+fixtureLearner+","+second+"]"):try await fallback(path) }
        try await s.loadProfiles(); try await s.enableSync(proofs:[fixtureProof()])
        t.handler = { _ in throw URLError(.notConnectedToInternet) }; do { try await s.disableSync(); XCTFail() } catch {}
        try s.select("server-b"); t.calls = []; t.bodies = []
        t.handler = fallback
        try await s.enableSync(proofs:[fixtureProof()])
        XCTAssertEqual(t.calls,["POST /v1/learners/server-a/consent","GET /v1/packs","POST /v1/learners/server-b/consent"])
        let first = try JSONSerialization.jsonObject(with:t.bodies[0]!) as! [String:Any]; XCTAssertEqual(first["granted"] as? Bool,false)
        XCTAssertTrue(try s.summary().enabled)
    }
    func testExpiredNetworkCapabilityRequiresVerifiedRebind() async throws {
        let(account,s,_,t,_) = try await fixture(); let old = try account.ownerSession()
        t.handler = { _ in reply("{\"error\":\"unauthorized\"}",401) }
        do { try await s.loadProfiles(); XCTFail() } catch {}
        t.calls = []; do { try await s.loadProfiles(); XCTFail() } catch {}; XCTAssertTrue(t.calls.isEmpty)
        var calls = 0
        t.handler = { path in
            if path == "GET /user" { calls += 1; return calls == 1 ? reply("{\"error_code\":\"bad_jwt\"}",403):reply(userJSON) }
            if path.contains("refresh_token") { return reply(sessionJSON.replacingOccurrences(of:"fixture-access",with:"fresh-access")) }
            return reply("{\"account_id\":\"backend-a\"}")
        }
        try await account.restore(); XCTAssertThrowsError(try old.check())
        let fresh = try account.ownerSession(); XCTAssertTrue(fresh.networkVerified); XCTAssertEqual(fresh.ownerID,"backend-a")
    }

    func testPresentationWithdrawalFailureIsTruthfulAndNavigationKeepsContext() async throws {
        let(_,s,_,t,url) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()])
        let model = LearningPresentationModel(learning:s)
        // Moving into a lesson preserves this same scoped model; teardown is reserved for account change.
        let retained = model.learning; XCTAssertTrue(retained === s); XCTAssertEqual(retained?.scope,s.scope)
        var db:OpaquePointer?; XCTAssertEqual(sqlite3_open(url.path,&db),SQLITE_OK); defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db,"CREATE TRIGGER fixture_fail BEFORE UPDATE ON progress BEGIN SELECT RAISE(FAIL,'fixture-write-failure'); END",nil,nil,nil),SQLITE_OK)
        await model.disable(); XCTAssertTrue(model.summary?.enabled == true); XCTAssertFalse(model.message.contains("Sync is off")); XCTAssertTrue(model.message.contains("could not be saved"))
        XCTAssertEqual(sqlite3_exec(db,"DROP TRIGGER fixture_fail",nil,nil,nil),SQLITE_OK)
        let fallback = t.handler; var pending:CheckedContinuation<HTTPReply,Error>?
        t.handler = { path in if path.contains("GET /v1/learners/server-a/events") { return try await withCheckedThrowingContinuation { pending = $0 } }; return try await fallback(path) }
        let inFlight = Task { await model.run { try await $0.sync() } }; while pending == nil { await Task.yield() }
        t.handler = { _ in throw URLError(.notConnectedToInternet) }
        await model.disable(); XCTAssertFalse(model.summary?.enabled ?? true); XCTAssertTrue(model.summary?.withdrawalPending == true)
        pending!.resume(returning:reply("{\"events\":[],\"next_cursor\":0,\"has_more\":false}")); await inFlight.value
        XCTAssertFalse(model.summary?.enabled ?? true)
    }
    func testBackendNearLimitPageAndLargeAppendStayBounded() async throws {
        let(_,s,_,t,_) = try await fixture(); try await s.enableSync(proofs:[fixtureProof()])
        let fallback = t.handler
        t.handler = { path in if path.contains("GET /v1/learners/server-a/events") {
            let records:[[String:Any]] = (1...100).map { n in let raw = fixtureEvent.replacingOccurrences(of:"answer-a",with:"answer-"+String(n)); return ["sequence":n,"payload":raw+String(repeating:" ",count:16000-raw.utf8.count),"registry_status":"registered"] }
            let data = try JSONSerialization.data(withJSONObject:["events":records,"next_cursor":100,"has_more":false]); XCTAssertGreaterThan(data.count,1048576); XCTAssertLessThan(data.count,4194304); return HTTPReply(status:200,data:data)
        }; return try await fallback(path) }
        try await s.sync(); XCTAssertEqual(try s.summary().remoteAnswers,100)
    }
    func testNestedPairObjectsRejectUnknownKeys() async throws {
        let(_,s,_,_,_) = try await fixture()
        var object = try JSONSerialization.jsonObject(with:Data(fixtureEvent.utf8)) as! [String:Any]; object["item_type"] = "match_pairs"
        object["raw_response"] = "{\"kind\":\"pairs\",\"pairs\":[{\"left\":\"a\",\"right\":\"b\",\"extra\":\"no\"}]}"
        let raw = String(data:try JSONSerialization.data(withJSONObject:object),encoding:.utf8)!
        XCTAssertThrowsError(try s.capture(raw,proof:fixtureProof()))
        XCTAssertEqual(LocalizedNumberInput.parse("1.234,5",language:"id"),1234.5); XCTAssertEqual(LocalizedNumberInput.parse("1,234.5",language:"en"),1234.5)
        XCTAssertNil(LocalizedNumberInput.parse("12abc",language:"en")); XCTAssertNil(LocalizedNumberInput.parse("1,2,3",language:"en"))
    }

    func testCausalHistoryOrderAndCrossTrackImportedIDConflict() async throws {
        let(_,s,j,_,_) = try await fixture()
        let z = fixtureEvent.replacingOccurrences(of:"answer-a",with:"answer-z")
        try s.capture(z,proof:fixtureProof()); try s.capture(fixtureEvent,proof:fixtureProof())
        XCTAssertEqual(try s.history(),[z,fixtureEvent])
        let reading = PackProof(track:"reading",contentVersion:"v1",rulesVersion:"r1",packSHA256:String(repeating:"d",count:64),rulesSHA256:String(repeating:"e",count:64),sourceCommit:String(repeating:"c",count:40))
        try j.update(s.scope!) { state in state.remote.append(RemoteAnswer(sequence:1,payload:fixtureEvent,registry_status:"registered")); state.cursor = 1; state.proofs["reading"] = reading; state.answers.removeValue(forKey:"answer-a") }
        let replacement = fixtureEvent.replacingOccurrences(of:"\"track\":\"math\"",with:"\"track\":\"reading\"")
        XCTAssertThrowsError(try s.capture(replacement,proof:reading)); XCTAssertEqual(try s.summary().localAnswers,1)
    }
    #if os(macOS)
    func testProcessCrashBeforeSQLiteCommitPreservesAnswersAndCursor() async throws {
        let(_,s,j,_,url) = try await fixture(); try s.capture(fixtureEvent,proof:fixtureProof())
        let process = Process(); process.executableURL = URL(fileURLWithPath:"/usr/bin/python3")
        process.arguments = ["-c","import sqlite3,sys,os; c=sqlite3.connect(sys.argv[1]); c.execute('BEGIN IMMEDIATE'); c.execute(\"UPDATE progress SET body=?\", (b'corrupt-uncommitted-fixture',)); os._exit(23)",url.path]
        try process.run(); process.waitUntilExit(); XCTAssertEqual(process.terminationStatus,23)
        let reopened = try SQLiteJournal(url:url)
        XCTAssertEqual(try reopened.read(s.scope!).answers["answer-a"]?.payload,fixtureEvent); XCTAssertEqual(try reopened.read(s.scope!).cursor,0)
        XCTAssertEqual(try j.read(s.scope!).answers.count,1)
    }
    #endif

    func testNormalKotlinDefaultSyntheticOmissionPreservesExactPayload() async throws {
        let(_,s,j,_,_) = try await fixture()
        let omitted = fixtureEvent.replacingOccurrences(of:",\"synthetic\":false",with:"")
        try s.capture(omitted,proof:fixtureProof())
        XCTAssertEqual(try j.read(s.scope!).answers["answer-a"]?.payload,omitted)
        XCTAssertThrowsError(try s.capture(omitted.replacingOccurrences(of:"\"review_status\":\"approved\"",with:"\"synthetic\":null,\"review_status\":\"approved\""),proof:fixtureProof()))
    }

}

private final class FixtureSharedLessonCore: SharedLessonCore {
    var produced:[String] = []
    func advance(packJSON:String,rulesJSON:String,stateJSON:String,contextJSON:String) throws -> SharedSessionSnapshot { SharedSessionSnapshot(stateJSON:"{\"fixture_step\":2}",currentItemID:nil,step:2,feedbackIDs:[],completed:true) }
    var isAvailable:Bool { true }; var versionID:String { "fixture-only-v1" }
    func start(packJSON:String,rulesJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSessionSnapshot { SharedSessionSnapshot(stateJSON:"{\"fixture_step\":0}",currentItemID:"ITEM-A",step:0,feedbackIDs:[],completed:false) }
    func submit(packJSON:String,rulesJSON:String,stateJSON:String,responseJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSubmission {
        let context = try JSONSerialization.jsonObject(with:Data(contextJSON.utf8)) as! [String:String]
        var event = try JSONSerialization.jsonObject(with:Data(fixtureEvent.utf8)) as! [String:Any]
        event["answer_id"] = context["answer_id"]; event["learner_id"] = context["learner_id"]; event["session_id"] = context["session_id"]; event["raw_response"] = responseJSON; event["item_id"] = "ITEM-A"
        let payload = String(data:try JSONSerialization.data(withJSONObject:event,options:.sortedKeys),encoding:.utf8)!
        produced.append(payload)
        return SharedSubmission(eventPayload:payload,next:SharedSessionSnapshot(stateJSON:"{\"fixture_step\":1}",currentItemID:nil,step:1,feedbackIDs:[],completed:true))
    }
}
extension LearningTests {
    func testApprovedLoaderAndSharedOnlySessionSavesBeforeAdvance() async throws {
        let(account,store,journal,_,url) = try await fixture()
        let pack = Data("{\"meta\":{\"schema_version\":1,\"track\":\"math\",\"content_version\":\"v1\",\"audiences\":[\"adults\"],\"instruction_langs\":[\"en\"],\"title\":{\"en\":\"Fixture only\"}},\"synthetic\":false,\"prompts\":{\"P\":{\"en\":\"Fixture prompt\"}},\"screens\":[],\"items\":[{\"item_id\":\"ITEM-A\",\"unit\":\"01\",\"audience\":\"adults\",\"type\":\"choose\",\"pool\":\"PRACT\",\"skills\":[\"skill-a\"],\"review_status\":\"approved\",\"prompt_id\":\"P\",\"options\":[{\"id\":\"a\",\"text\":{\"en\":\"Fixture A\"},\"correct\":true}]}]}".utf8)
        let rules = Data("{\"track\":\"math\",\"rules_version\":\"r1\"}".utf8)
        let proof = ApprovedLessonLibrary.proof(pack:pack,rules:rules,source:String(repeating:"c",count:40))
        let catalog = try JSONSerialization.data(withJSONObject:["source_commit":proof.sourceCommit,"packs":[["track":"math","content_version":"v1","rules_version":"r1","sha256":proof.packSHA256,"rules_sha256":proof.rulesSHA256]]])
        let library = try ApprovedLessonLibrary.load(pack:pack,rules:rules,catalog:catalog,source:proof.sourceCommit,language:"en")
        XCTAssertEqual(library.lessons.count,1)
        XCTAssertThrowsError(try ApprovedLessonLibrary.load(pack:Data(String(data:pack,encoding:.utf8)!.replacingOccurrences(of:"approved",with:"draft").utf8),rules:rules,catalog:catalog,source:proof.sourceCommit,language:"en"))
        let core = FixtureSharedLessonCore()
        let lesson = try LessonSession(lesson:library.lessons[0],learning:store,core:core)
        XCTAssertEqual(lesson.position,0)
        var db:OpaquePointer?; XCTAssertEqual(sqlite3_open(url.path,&db),SQLITE_OK); defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db,"CREATE TRIGGER fixture_fail BEFORE UPDATE ON progress BEGIN SELECT RAISE(FAIL,'fixture-write-failure'); END",nil,nil,nil),SQLITE_OK)
        XCTAssertThrowsError(try lesson.submit(responseJSON:"{\"kind\":\"choice\",\"option_id\":\"a\"}")); XCTAssertEqual(lesson.position,0); XCTAssertEqual(try store.summary().localAnswers,0); XCTAssertEqual(try journal.read(store.scope!).savedSession?.snapshot.step,0)
        XCTAssertEqual(sqlite3_exec(db,"DROP TRIGGER fixture_fail",nil,nil,nil),SQLITE_OK)
        try lesson.submit(responseJSON:"{\"kind\":\"choice\",\"option_id\":\"a\"}")
        XCTAssertEqual(core.produced.count,1); XCTAssertEqual(try journal.read(store.scope!).answers.values.first?.payload,core.produced.first)
        XCTAssertEqual(lesson.position,1); XCTAssertEqual(try store.summary().localAnswers,1)
        let reopenedStore = LearningStore(session:try account.ownerSession(),journal:try SQLiteJournal(url:url)); try reopenedStore.restoreOfflineProfiles()
        let resumed = try LessonSession(lesson:library.lessons[0],learning:reopenedStore,core:FixtureSharedLessonCore()); XCTAssertEqual(resumed.position,1); XCTAssertNil(resumed.current)
        let stale = try LessonSession(lesson:library.lessons[0],learning:store,core:FixtureSharedLessonCore()); store.detach()
        XCTAssertThrowsError(try stale.submit(responseJSON:"{\"kind\":\"choice\",\"option_id\":\"a\"}")); XCTAssertEqual(stale.position,1)
    }
}

#if canImport(AyaIlmuSharedLearning)
import AyaIlmuSharedLearning
#if canImport(AyaIlmu)
@testable import AyaIlmu
#endif
extension LearningTests {
    #if canImport(AyaIlmu)
    /// Exercises the shipped reviewed resources and real planner/grader in both languages.
    /// Accounts, network, journals and live progress are deliberately absent from this test.
    func testActualNativeReviewedSessionsGradeCorrectAnswersInBothLanguages() throws {
        let responses:[String:[String:Any]] = [
            "001":["kind":"number","value":14700],
            "002":["kind":"number","value":84900],
            "003":["kind":"choice","option_id":"b"],
            "004":["kind":"choice","option_id":"t"],
            "005":["kind":"number","value":572],
            "006":["kind":"pairs","pairs":[["left":"m1","right":"r120"],["left":"m2","right":"r400"],["left":"m3","right":"r385"],["left":"m4","right":"r396"]]],
            "007":["kind":"choice","option_id":"seen"],
            "008":["kind":"number","value":46500],
            "009":["kind":"choice","option_id":"c"],
            "010":["kind":"number","value":75000],
            "011":["kind":"sequence","sequence":["t1","t2","t3"]],
            "012":["kind":"sequence","sequence":["f4"]],
            "013":["kind":"number","value":14750],
            "014":["kind":"choice","option_id":"c"]
        ]
        for language in ["id","en"] {
            let lesson = try XCTUnwrap(ApprovedLessonLibrary.bundled.lessons.first{$0.language == language})
            let core = AppSharedCore.make(); XCTAssertTrue(core.isAvailable)
            var values = ["unit":"01","lang":language,"learner_id":"ios-reviewed-\(language)","session_id":"ios-reviewed-session-\(language)","app_version":"0.1.0","zone_id":"UTC","timestamp":"2026-11-03T00:00:00Z","screens_seen":"[]","time_on_item_ms":"1000"]
            func encode(_ value:Any) throws -> String { String(data:try JSONSerialization.data(withJSONObject:value,options:.sortedKeys),encoding:.utf8)! }
            var history:[String] = []
            var state = try core.start(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,contextJSON:encode(values),historyJSON:"[]")
            var sawIntroduction = false
            var scoredAnswers = 0
            for _ in 0..<64 {
                if state.completed { break }
                if ["screen","feedback"].contains(state.phase) {
                    if state.phase == "screen" { sawIntroduction = true; XCTAssertEqual(state.screenID,"MAT-A-P-01-S1") }
                    state = try core.advance(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:state.stateJSON,contextJSON:encode(values))
                    continue
                }
                XCTAssertEqual(state.phase,"step")
                let item = try XCTUnwrap(lesson.items.first{$0.id == state.currentItemID})
                let suffix = String(item.id.suffix(3))
                values["answer_id"] = "ios-reviewed-\(language)-\(history.count)"
                let result = try core.submit(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:state.stateJSON,responseJSON:encode(XCTUnwrap(responses[suffix])),contextJSON:encode(values),historyJSON:encode(history))
                let event = try XCTUnwrap(JSONSerialization.jsonObject(with:Data(result.eventPayload.utf8)) as? [String:Any])
                XCTAssertEqual(event["item_id"] as? String,item.id)
                XCTAssertEqual(event["lang"] as? String,language)
                XCTAssertEqual(event["review_status"] as? String,"approved")
                XCTAssertFalse(event["synthetic"] as? Bool ?? false)
                XCTAssertEqual(event["outcome"] as? String,item.type == "info_card" ? "not_assessed":"correct")
                if item.type != "info_card" { scoredAnswers += 1 }
                history.append(result.eventPayload); state = result.next
            }
            XCTAssertTrue(sawIntroduction)
            XCTAssertTrue(state.completed,"The actual \(language) planner must finish its session.")
            XCTAssertGreaterThan(scoredAnswers,0)
        }
    }

    /// Pure Kotlin/Native session check: no account transport, mailbox, journal, or backend writes.
    func testActualNativeSharedCoreStartsAndGradesReviewedMathWithoutAccount() throws {
        let lesson = try XCTUnwrap(ApprovedLessonLibrary.bundled.lessons.first{$0.language == "en"})
        XCTAssertEqual(lesson.items.count,14)
        let core = AppSharedCore.make(); XCTAssertTrue(core.isAvailable)
        let values = ["unit":"01","lang":"en","learner_id":"ios-curriculum-isolated","session_id":"ios-curriculum-session","app_version":"0.1.0","zone_id":"UTC","timestamp":"2026-11-03T00:00:00Z","screens_seen":"[]","answer_id":"ios-curriculum-answer","time_on_item_ms":"1000"]
        let context = String(data:try JSONSerialization.data(withJSONObject:values,options:.sortedKeys),encoding:.utf8)!
        var state = try core.start(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,contextJSON:context,historyJSON:"[]")
        for _ in 0..<10 {
            if state.phase == "step" { break }
            XCTAssertTrue(["screen","feedback"].contains(state.phase))
            state = try core.advance(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:state.stateJSON,contextJSON:context)
        }
        XCTAssertEqual(state.phase,"step")
        let item = try XCTUnwrap(lesson.items.first{$0.id == state.currentItemID})
        let isReading = ["info_card","mini_reading"].contains(item.type)
        let response = isReading ? "{\"kind\":\"choice\",\"option_id\":\"seen\"}":"{\"kind\":\"dont_know\"}"
        let submission = try core.submit(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:state.stateJSON,responseJSON:response,contextJSON:context,historyJSON:"[]")
        let event = try XCTUnwrap(JSONSerialization.jsonObject(with:Data(submission.eventPayload.utf8)) as? [String:Any])
        XCTAssertEqual(event["item_id"] as? String,item.id)
        XCTAssertEqual(event["track"] as? String,"mat-a-local")
        XCTAssertEqual(event["content_version"] as? String,"mat-a-local-pemula-0.3")
        XCTAssertEqual(event["review_status"] as? String,"approved")
        XCTAssertEqual(event["outcome"] as? String,isReading ? "not_assessed":"dont_know")
        XCTAssertFalse(event["synthetic"] as? Bool ?? false)
        XCTAssertEqual(event["learner_id"] as? String,"ios-curriculum-isolated")
    }
    #endif
    func testActualNativeSharedCoreMatchesJVMGoldenAndThrowsSafely() async throws {
        let resources = Bundle(for:LearningTests.self)
        func read(_ name:String) throws -> String { try String(contentsOf:XCTUnwrap(resources.url(forResource:name,withExtension:"json")),encoding:.utf8) }
        let pack = try read("bridge-pack"), rules = try read("bridge-rules")
        let golden = try JSONSerialization.jsonObject(with:Data(read("jvm-golden").utf8)) as! [String:Any]
        let proof = ApprovedLessonLibrary.proof(pack:Data(pack.utf8),rules:Data(rules.utf8),source:String(repeating:"c",count:40))
        func catalog(_ proof:PackProof) throws -> Data { try JSONSerialization.data(withJSONObject:["source_commit":proof.sourceCommit,"packs":[["track":proof.track,"content_version":proof.contentVersion,"rules_version":proof.rulesVersion,"sha256":proof.packSHA256,"rules_sha256":proof.rulesSHA256]]]) }
        let library = try ApprovedLessonLibrary.load(pack:Data(pack.utf8),rules:Data(rules.utf8),catalog:catalog(proof),source:proof.sourceCommit,language:"en")
        XCTAssertEqual(library.lessons.count,1); XCTAssertEqual(library.lessons[0].items.count,9)
        XCTAssertTrue(library.lessons[0].items.contains{$0.type == "estimate_slider" && $0.slider?.step == 1})
        XCTAssertTrue(library.lessons[0].items.contains{$0.type == "info_card" && $0.modelAnswer?.isEmpty == false})
        var changed = try JSONSerialization.jsonObject(with:Data(pack.utf8)) as! [String:Any]
        var entries = changed["items"] as! [[String:Any]]; var draft = entries[0]; draft["unit"] = "02"; draft["item_id"] = "DRAFT-OTHER"; draft["review_status"] = "draft"; entries.append(draft); changed["items"] = entries
        let partial = try JSONSerialization.data(withJSONObject:changed); let partialProof = ApprovedLessonLibrary.proof(pack:partial,rules:Data(rules.utf8),source:proof.sourceCommit)
        let partialLibrary = try ApprovedLessonLibrary.load(pack:partial,rules:Data(rules.utf8),catalog:catalog(partialProof),source:proof.sourceCommit,language:"en")
        XCTAssertEqual(partialLibrary.lessons.count,1); XCTAssertFalse(partialLibrary.lessons[0].items.contains{$0.id == "DRAFT-OTHER"})
        let bridge = LearningBridge()
        XCTAssertThrowsError(try bridge.start(packJSON:"{}",rulesJSON:"{}",contextJSON:"{}",historyJSON:"[]"))
        #if canImport(AyaIlmu)
        XCTAssertTrue(AppSharedCore.make().isAvailable)
        #endif
        var state = ""
        for operation in golden["operations"] as! [[String:Any]] {
            let context = String(data:try JSONSerialization.data(withJSONObject:operation["context"]!,options:.sortedKeys),encoding:.utf8)!
            let actual:String
            let activePack = operation["pack"] as? String ?? pack
            switch operation["op"] as! String {
            case "start": actual = try bridge.start(packJSON:activePack,rulesJSON:rules,contextJSON:context,historyJSON:operation["history"] as? String ?? "[]")
            case "submit": actual = try bridge.submit(packJSON:activePack,rulesJSON:rules,stateJSON:state,responseJSON:operation["response"] as! String,contextJSON:context,historyJSON:operation["history"] as! String)
            default: actual = try bridge.advance(packJSON:activePack,rulesJSON:rules,stateJSON:state,contextJSON:context)
            }
            let object = try JSONSerialization.jsonObject(with:Data(actual.utf8)) as! [String:Any]
            XCTAssertTrue(NSDictionary(dictionary:object).isEqual(to:operation["output"] as! [String:Any]),"Shared JVM/native transition differs")
            let next = object["next"] as? [String:Any] ?? object; state = next["stateJSON"] as! String
        }
        let context = "{\"learner_id\":\"native-a\"}"
        let project = try JSONSerialization.jsonObject(with:Data(bridge.project(packJSON:pack,rulesJSON:rules,historyJSON:golden["history"] as! String,contextJSON:context).utf8)) as! [String:Any]
        XCTAssertTrue(NSDictionary(dictionary:project).isEqual(to:golden["projection"] as! [String:Any]))
        #if canImport(AyaIlmu)
        let(account,learning,journal,_,url) = try await fixture()
        let actualCore = AppSharedCore.make(); let nativeSession = try LessonSession(lesson:library.lessons[0],learning:learning,core:actualCore)
        var steps = 0
        while nativeSession.current != nil || nativeSession.canAdvance {
            steps += 1; XCTAssertLessThan(steps,40); if steps >= 40 { break }
            if nativeSession.canAdvance { try nativeSession.advance(); continue }
            let id = nativeSession.current!.id
            let operation = (golden["operations"] as! [[String:Any]]).first { op in
                guard op["op"] as? String == "submit",op["pack"] == nil,let output = op["output"] as? [String:Any],let raw = output["eventPayload"] as? String,let event = try? JSONSerialization.jsonObject(with:Data(raw.utf8)) as? [String:Any] else { return false }
                return event["item_id"] as? String == id
            }
            try nativeSession.submit(responseJSON:try XCTUnwrap(operation?["response"] as? String))
        }
        XCTAssertEqual(try learning.summary().localAnswers,9)
        XCTAssertEqual(try learning.seenScreens(proof:proof),["FIX-S1"])
        let restarted = LearningStore(session:try account.ownerSession(),journal:try SQLiteJournal(url:url)); try restarted.restoreOfflineProfiles()
        let resumed = try LessonSession(lesson:library.lessons[0],learning:restarted,core:actualCore); XCTAssertNil(resumed.current); XCTAssertFalse(resumed.canAdvance)
        XCTAssertEqual(try journal.read(learning.scope!).savedSession?.sessionID,try SQLiteJournal(url:url).read(learning.scope!).savedSession?.sessionID)
        let presentation = LearningPresentationModel(learning:restarted,core:actualCore,library:library)
        XCTAssertNotNil(presentation.projection)
        let rawProjection = try actualCore.project(packJSON:pack,rulesJSON:rules,historyJSON:restarted.historyJSON(),contextJSON:"{\"learner_id\":\"native-a\"}")
        let projected = try SharedProjectionSummary.read(rawProjection)
        XCTAssertEqual(presentation.projection?.learned,projected.learned); XCTAssertEqual(presentation.projection?.practicing,projected.practicing); XCTAssertEqual(presentation.projection?.blocked,projected.blocked)
        #endif
        for vector in golden["platform"] as! [[String:Any]] {
            let request = String(data:try JSONSerialization.data(withJSONObject:vector["request"]!,options:.sortedKeys),encoding:.utf8)!
            let value = try JSONSerialization.jsonObject(with:Data(bridge.platformEvaluate(requestJSON:request).utf8),options:.fragmentsAllowed)
            XCTAssertTrue(NSDictionary(dictionary:["value":value]).isEqual(to:["value":vector["output"]!]),"Shared normalization/calendar/instant platform parity differs")
        }
    }
}
#endif

@MainActor final class LearnerErasureTests: XCTestCase {
    private func erasureFixture() async throws -> (AccountStore,LearningStore,SQLiteJournal,FixtureTransport,URL) {
        let (account,store,journal,transport,url) = try await LearningTests().fixture()
        let old = transport.handler
        transport.handler = { path in
            if path == "GET /v1/learners" { return reply("["+fixtureLearner.replacingOccurrences(of:"server-a",with:"20000000-0000-0000-0000-000000000001")+"]") }
            return try await old(path)
        }
        try await store.loadProfiles(); try store.select("20000000-0000-0000-0000-000000000001")
        return(account,store,journal,transport,url)
    }
    private func receipt(_ transport:FixtureTransport,learner:String) throws -> HTTPReply {
        let body = try JSONSerialization.jsonObject(with:transport.bodies.last!!) as! [String:Any]
        XCTAssertEqual(body["confirmed"] as? Bool,true); XCTAssertEqual(body["synthetic"] as? Bool,false)
        return HTTPReply(status:200,data:try JSONSerialization.data(withJSONObject:["deletion_id":"30000000-0000-0000-0000-000000000001","scope":"learner","learner_id":learner,"request_id":body["request_id"]!,"completed_at":"2026-11-11T12:00:00.123Z"]))
    }
    func testConfirmationRequiredBeforeRequestOrStorageMutation() async throws {
        let(_,s,j,t,_) = try await erasureFixture(); let scope = s.scope!; t.calls = []
        do { _ = try await s.eraseServerCopy(expected:scope,confirmed:false); XCTFail() } catch {}
        XCTAssertTrue(t.calls.isEmpty); XCTAssertNil(try j.read(scope).deletionRequestID)
    }
    func testUncertainErasureSurvivesRestartAndRetainsLocalAnswers() async throws {
        let(account,s,j,t,url) = try await erasureFixture(); let scope = s.scope!
        try await s.enableSync(proofs:[fixtureProof()]); try s.capture(fixtureEvent,proof:fixtureProof())
        t.handler = { _ in throw URLError(.networkConnectionLost) }
        do { _ = try await s.eraseServerCopy(expected:scope,confirmed:true); XCTFail() } catch {}
        let pending = try j.read(scope)
        XCTAssertNotNil(pending.deletionRequestID); XCTAssertFalse(pending.enabled); XCTAssertNil(pending.deletionReceipt)
        let retry = LearningStore(session:try account.ownerSession(),journal:try SQLiteJournal(url:url))
        try retry.restoreOfflineProfiles()
        t.handler = { path in
            if path == "GET /v1/learners" { return reply("[]") }
            if path.hasSuffix("/deletion") { return try self.receipt(t,learner:scope.learner) }
            return reply("{}")
        }
        try await retry.loadProfiles(); XCTAssertEqual(retry.scope,scope)
        let result = try await retry.eraseServerCopy(expected:scope,confirmed:true)
        XCTAssertEqual(result.request_id,pending.deletionRequestID)
        XCTAssertEqual(try j.read(scope).deletionReceipt,result)
        XCTAssertEqual(try j.read(scope).answers["answer-a"]?.payload,fixtureEvent)
        do { try await retry.enableSync(proofs:[fixtureProof()]); XCTFail() } catch {}
        t.calls = []; _ = try await retry.eraseServerCopy(expected:scope,confirmed:true); XCTAssertTrue(t.calls.isEmpty)
    }
    func testWrongReceiptCannotClaimCompletion() async throws {
        let(_,s,j,t,_) = try await erasureFixture(); let scope = s.scope!
        t.handler = { _ in try self.receipt(t,learner:"20000000-0000-0000-0000-000000000002") }
        do { _ = try await s.eraseServerCopy(expected:scope,confirmed:true); XCTFail() } catch {}
        XCTAssertNotNil(try j.read(scope).deletionRequestID); XCTAssertNil(try j.read(scope).deletionReceipt)
    }
    func testWrongSelectedScopeSendsNothing() async throws {
        let(_,s,_,t,_) = try await erasureFixture(); t.calls = []
        let wrong = OwnerScope(origin:s.scope!.origin,owner:"other-owner",learner:s.scope!.learner)
        do { _ = try await s.eraseServerCopy(expected:wrong,confirmed:true); XCTFail() } catch {}
        XCTAssertTrue(t.calls.isEmpty)
    }
    func testLogoutFencesLateReceiptButKeepsDurableErasureIntent() async throws {
        let(account,s,j,t,_) = try await erasureFixture(); let scope = s.scope!
        var continuation:CheckedContinuation<HTTPReply,Error>?
        var response:HTTPReply?
        t.handler = { path in
            if path.hasSuffix("/deletion") { response = try self.receipt(t,learner:scope.learner); return try await withCheckedThrowingContinuation { continuation = $0 } }
            return reply("{}")
        }
        let work = Task { try await s.eraseServerCopy(expected:scope,confirmed:true) }
        while continuation == nil { await Task.yield() }
        _ = try await account.signOut(); continuation!.resume(returning:response!)
        do { _ = try await work.value; XCTFail() } catch {}
        XCTAssertNotNil(try j.read(scope).deletionRequestID)
        XCTAssertNil(try j.read(scope).deletionReceipt)
        XCTAssertFalse(try j.read(scope).enabled)
    }
    func testReceiptRejectsUnknownDuplicateMissingAndMalformedFields() throws {
        let learner = "20000000-0000-0000-0000-000000000001",request = "40000000-0000-0000-0000-000000000001"
        let fields:[String:String] = ["deletion_id":"30000000-0000-0000-0000-000000000001","scope":"learner","learner_id":learner,"request_id":request,"completed_at":"2026-11-11T12:00:00.123456Z"]
        let raw = String(data:try JSONSerialization.data(withJSONObject:fields),encoding:.utf8)!
        XCTAssertNoThrow(try LearnerDeletionReceipt.parse(Data(raw.utf8),learner:learner,request:request))
        for bad in [raw.dropLast()+",\"account_deleted\":true}",raw.dropLast()+",\"scope\":\"learner\"}",raw.replacingOccurrences(of:"learner",with:"account"),raw.replacingOccurrences(of:request,with:"invalid"),raw.replacingOccurrences(of:"2026-11-11T12:00:00.123456Z",with:"tomorrow")] {
            XCTAssertThrowsError(try LearnerDeletionReceipt.parse(Data(bad.utf8),learner:learner,request:request))
        }
    }
    func testFailedStorageReservationNeverSendsDeletion() async throws {
        let(_,s,j,t,url) = try await erasureFixture(); let scope = s.scope!
        var db:OpaquePointer?; XCTAssertEqual(sqlite3_open(url.path,&db),SQLITE_OK); defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db,"CREATE TRIGGER refuse_erasure_update BEFORE UPDATE ON progress BEGIN SELECT RAISE(ABORT,'test disk refusal'); END",nil,nil,nil),SQLITE_OK)
        t.calls = []
        do { _ = try await s.eraseServerCopy(expected:scope,confirmed:true); XCTFail() } catch {}
        XCTAssertTrue(t.calls.isEmpty); XCTAssertNil(try j.read(scope).deletionRequestID)
    }

}
