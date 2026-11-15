import XCTest
@testable import AyaIlmuCore

/// Account-free learning: profiles and answers stay on the device, with no account and no network.
@MainActor final class DeviceLearningTests: XCTestCase {
    private let source = String(repeating:"c",count:40)
    private func journalURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("learning.sqlite") }

    func testDeviceSessionRejectsInvalidSourceAndNeverNetworks() async throws {
        XCTAssertThrowsError(try OwnerSession(deviceRegistrySourceCommit:""))
        XCTAssertThrowsError(try OwnerSession(deviceRegistrySourceCommit:"not-a-commit"))
        let session = try OwnerSession(deviceRegistrySourceCommit:source)
        XCTAssertTrue(session.isDeviceOnly); XCTAssertFalse(session.networkVerified)
        XCTAssertEqual(session.origin,OwnerSession.deviceOrigin)
        do { _ = try await session.request("GET","/v1/learners"); XCTFail("device session must not send requests") }
        catch LearningError.signInRequired {}
    }

    func testCreateProfileAnswerAndRestartWithoutAccount() async throws {
        let url = journalURL()
        let store = LearningStore(session:try OwnerSession(deviceRegistrySourceCommit:source),journal:try SQLiteJournal(url:url))
        XCTAssertTrue(store.profiles.isEmpty)
        try await store.createAdult(language:"en")
        XCTAssertEqual(store.profiles.count,1)
        let learner = try XCTUnwrap(store.profiles.first)
        XCTAssertEqual(learner.kind,"ADULT"); XCTAssertEqual(learner.lang,"en"); XCTAssertEqual(store.scope?.learner,learner.id)
        let event = fixtureEvent.replacingOccurrences(of:"\"learner_id\":\"native-a\"",with:"\"learner_id\":\"\(learner.client_learner_id)\"")
        try store.capture(event,proof:fixtureProof())
        let summary = try store.summary()
        XCTAssertEqual(summary.localAnswers,1); XCTAssertEqual(summary.pending,0); XCTAssertFalse(summary.enabled)
        do { try await store.sync(); XCTFail("device profiles cannot sync") } catch {}

        let reopened = LearningStore(session:try OwnerSession(deviceRegistrySourceCommit:source),journal:try SQLiteJournal(url:url))
        try await reopened.loadProfiles()
        XCTAssertEqual(reopened.profiles.map(\.id),[learner.id]); XCTAssertEqual(reopened.scope?.learner,learner.id)
        XCTAssertEqual(try reopened.summary().localAnswers,1)
    }

    func testDeviceProfilesAreSeparateFromAccountProfiles() async throws {
        let url = journalURL(); let journal = try SQLiteJournal(url:url)
        let store = LearningStore(session:try OwnerSession(deviceRegistrySourceCommit:source),journal:journal)
        try await store.createAdult(language:"id"); try await store.createAdult(language:"en")
        XCTAssertEqual(store.profiles.count,2)
        XCTAssertTrue(try journal.account(origin:"https://localhost:58443",owner:"backend-a").profiles.isEmpty)
        XCTAssertEqual(try journal.account(origin:OwnerSession.deviceOrigin,owner:OwnerSession.deviceOwnerID).profiles.count,2)
    }
}
