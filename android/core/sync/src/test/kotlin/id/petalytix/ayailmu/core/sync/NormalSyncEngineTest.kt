package id.petalytix.ayailmu.core.sync

import java.io.File
import java.io.IOException
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Normal-mode fixtures contain no real identities and never perform network I/O. */
class NormalSyncEngineTest {
    private val proof = PackProof("arab", "approved-1", "rules-1", "a".repeat(64), "b".repeat(64), "source-1")
    private val learner = Learner("remote-a", "normal-local-a", "ADULT", "adults", "id")

    private class FakeBackend(val proof: PackProof) : Backend {
        val learnersByOwner = mutableMapOf<String, MutableList<Learner>>()
        val uploaded = mutableListOf<String>()
        var appendGate: CompletableDeferred<Unit>? = null
        val appendEntered = CompletableDeferred<Unit>()
        override suspend fun account(token: String) = "owner-$token"
        override suspend fun currentAccount(token: String) = "owner-$token"
        override suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean): String {
            check(adultConfirmed && declarationVersion == "owner-policy-1"); return "owner-$token"
        }
        override suspend fun learners(token: String) = learnersByOwner[token].orEmpty()
        override suspend fun createLearner(token: String, clientId: String) = error("Use the normal learner contract")
        /** Every create request that reached this fake backend. */
        val createCalls = mutableListOf<Triple<String, String, String>>()
        var createGate: CompletableDeferred<Unit>? = null
        override suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String): Learner {
            checkNetwork(token); createGate?.await(); createCalls += Triple(clientId, kind, lang)
            val existing = learnersByOwner[token].orEmpty().firstOrNull { it.clientLearnerId == clientId }
            if (existing != null) {
                if (existing.kind != kind || existing.lang != lang) throw ApiFailure(409, "conflict")
                return existing
            }
            return Learner("remote-$clientId", clientId, kind, if (kind == "ADULT") "adults" else "kids", lang)
                .also { learnersByOwner.getOrPut(token) { mutableListOf() }.add(it) }
        }
        override suspend fun catalog(token: String) = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
        override suspend fun consent(token: String, learnerId: String, granted: Boolean) = checkNetwork(token)
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> {
            checkNetwork(token); appendEntered.complete(Unit); appendGate?.await(); uploaded += payloads
            return payloads.mapIndexed { index, raw -> Receipt(answerId(raw), index + 1L, false, "registered") }
        }
        override suspend fun pull(token: String, learnerId: String, after: Long): Page = Page(emptyList(), after, false)
        private fun checkNetwork(token: String) { check(token == "A" || token == "B") }
        private fun answerId(raw: String) = Json.parseToJsonElement(raw).jsonObject.getValue("answer_id").jsonPrimitive.content
    }

    private fun payload(id: String, owner: Learner = learner, synthetic: Boolean = false) = """{"answer_id":"$id","learner_id":"${owner.clientLearnerId}","item_id":"A01","track":"arab","content_version":"approved-1","rules_version":"rules-1","app_version":"0.1.0","timestamp":"2026-10-26T01:00:00Z","local_date":"2026-10-26","session_id":"session-a","lang":"id","pool":"PRACT","unit":"A","skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"review_status":"approved","synthetic":$synthetic,"item_type":"choose"}"""

    private suspend fun ready(api: FakeBackend, journal: JournalStore = MemoryJournal()): SyncEngine {
        api.learnersByOwner["A"] = mutableListOf(learner)
        return SyncEngine(api, journal, SyncMode.NORMAL).also { it.login("A", NormalOwnerDeclaration("owner-policy-1", true)); it.select(learner, proof) }
    }

    @Test fun normalCaptureRejectsSyntheticAndNeverBackfillsPreOptInHistory() = runTest {
        val api = FakeBackend(proof)
        val engine = ready(api)
        engine.capture(listOf(payload("before")))
        assertEquals(0, engine.pendingCount())
        engine.enable(listOf("before"))
        engine.capture(listOf(payload("before"), payload("after")))
        assertEquals(1, engine.pendingCount())
        assertFailsWith<IllegalArgumentException> { engine.capture(listOf(payload("bad", synthetic = true))) }
        assertEquals(SyncResult.SYNCED, engine.sync())
        assertEquals(listOf("after"), api.uploaded.map { raw -> Json.parseToJsonElement(raw).jsonObject.getValue("answer_id").jsonPrimitive.content })
    }

    @Test fun preflightIsReadOnlyAndRejectsIncompatibleOrEmptyProofsBeforeAnyLearnerExists() = runTest {
        val api = FakeBackend(proof)
        val journal = MemoryJournal()
        val engine = SyncEngine(api, journal, SyncMode.NORMAL)
        assertFailsWith<ApiFailure> { engine.preflightProofs(mapOf(proof.track to proof)) }
        engine.login("A", NormalOwnerDeclaration("owner-policy-1", true))
        val before = journal.read()
        engine.preflightProofs(mapOf(proof.track to proof))
        assertFailsWith<IllegalArgumentException> { engine.preflightProofs(mapOf(proof.track to proof.copy(packSha256 = "c".repeat(64)))) }
        assertFailsWith<IllegalArgumentException> { engine.preflightProofs(mapOf(proof.track to proof.copy(sourceCommit = "source-2"))) }
        assertFailsWith<IllegalArgumentException> { engine.preflightProofs(emptyMap()) }
        assertTrue(api.learnersByOwner.isEmpty())
        assertEquals(before, journal.read())
    }

    @Test fun normalOwnerNamespacesRemainIsolated() = runTest {
        val api = FakeBackend(proof)
        val engine = ready(api)
        engine.enable(emptyList())
        engine.capture(listOf(payload("a-1")))
        assertEquals(1, engine.pendingCount())
        engine.logout()
        val b = learner.copy(id = "remote-b", clientLearnerId = "normal-local-b")
        api.learnersByOwner["B"] = mutableListOf(b)
        engine.login("B", NormalOwnerDeclaration("owner-policy-1", true))
        engine.select(b, proof)
        assertEquals(0, engine.pendingCount())
        assertTrue(engine.history().isEmpty())
        assertFailsWith<IllegalArgumentException> { engine.select(learner, proof) }
    }


    @Test fun suspendedAReplyCannotAcknowledgeOrPublishIntoB() = runTest {
        val api = FakeBackend(proof)
        val engine = ready(api)
        engine.enable(emptyList())
        engine.capture(listOf(payload("a-late")))
        api.appendGate = CompletableDeferred()
        val syncing = async { engine.sync() }
        api.appendEntered.await()
        engine.logout()
        val b = learner.copy(id = "remote-b", clientLearnerId = "normal-local-b")
        api.learnersByOwner["B"] = mutableListOf(b)
        engine.login("B", NormalOwnerDeclaration("owner-policy-1", true))
        engine.select(b, proof)
        api.appendGate!!.complete(Unit)
        assertEquals(SyncResult.SESSION_CHANGED, syncing.await())
        assertEquals(0, engine.pendingCount())
        assertTrue(engine.history().isEmpty())
    }

    @Test fun syntheticModeStillRejectsNormalLearnersAndAnswers() = runTest {
        val api = FakeBackend(proof)
        api.learnersByOwner["A"] = mutableListOf(learner)
        val engine = SyncEngine(api, MemoryJournal()).also { it.login("A", NormalOwnerDeclaration("owner-policy-1", true)) }
        assertFailsWith<IllegalArgumentException> { engine.select(learner, proof) }
    }

    // ---- Durable pending profile-create request (lost-reply replay) ----

    private val declaration = NormalOwnerDeclaration("owner-policy-1", true)
    private fun newEngine(api: FakeBackend, journal: JournalStore = MemoryJournal()) = SyncEngine(api, journal, SyncMode.NORMAL)

    /** Records every journal write so tests can prove which states ever existed on disk. */
    private class RecordingJournal(private val inner: JournalStore = MemoryJournal()) : JournalStore {
        val history = mutableListOf<JournalSnapshot>()
        var failWrites = false
        override fun read() = inner.read()
        override fun update(transform: (JournalSnapshot) -> JournalSnapshot): JournalSnapshot {
            if (failWrites) throw IOException("synthetic journal write failure")
            return inner.update(transform).also { history += it }
        }
    }

    @Test fun reserveRecordsOneImmutableRequestPerOwnerAndReplaysItWithoutANewId() = runTest {
        val engine = newEngine(FakeBackend(proof)).also { it.login("A", declaration) }
        var ids = 0
        val first = engine.reserveNormalAdultCreate("id", { "lrn_fixed-${++ids}" })
        assertEquals(PendingCreate("lrn_fixed-1", "ADULT", "id"), first)
        assertEquals(first, engine.pendingCreate())
        assertEquals(first, engine.reserveNormalAdultCreate("id", { "lrn_fixed-${++ids}" }), "The recorded request is returned, no new id is generated")
        assertEquals(1, ids)
        val conflict = assertFailsWith<PendingCreateConflict> { engine.reserveNormalAdultCreate("en", { "lrn_other" }) }
        assertEquals(first, conflict.pending)
        assertEquals(first, engine.pendingCreate(), "A conflicting language never replaces the request")
        assertFailsWith<IllegalArgumentException> { engine.reserveNormalAdultCreate("fr", { "lrn_other" }) }
        assertFailsWith<IllegalArgumentException> { newEngine(FakeBackend(proof)).also { it.login("A", declaration) }.reserveNormalAdultCreate("id", { "syn_bad" }) }
    }

    @Test fun reserveRequiresASessionAndAcceptedAction() = runTest {
        val journal = RecordingJournal()
        val engine = newEngine(FakeBackend(proof), journal)
        assertFailsWith<ApiFailure> { engine.reserveNormalAdultCreate("id", { "lrn_x" }) }
        engine.login("A", declaration)
        val writes = journal.history.size
        assertFailsWith<IllegalStateException> { engine.reserveNormalAdultCreate("id", { "lrn_x" }, { false }) }
        assertEquals(writes, journal.history.size)
        assertNull(engine.pendingCreate())
    }

    @Test fun createRefusesAnUnrecordedOrDifferentRequestBeforeAnyPost() = runTest {
        val api = FakeBackend(proof)
        val engine = newEngine(api).also { it.login("A", declaration) }
        assertFailsWith<IllegalStateException> { engine.createNormalAdultLearner("lrn_unrecorded", "id") }
        val recorded = engine.reserveNormalAdultCreate("id", { "lrn_recorded" })
        assertFailsWith<IllegalStateException> { engine.createNormalAdultLearner("lrn_other", "id") }
        assertFailsWith<IllegalStateException> { engine.createNormalAdultLearner(recorded.clientLearnerId, "en") }
        assertTrue(api.createCalls.isEmpty())
        engine.createNormalAdultLearner(recorded.clientLearnerId, recorded.lang)
        assertEquals(listOf(Triple("lrn_recorded", "ADULT", "id")), api.createCalls)
    }

    @Test fun concurrentIdenticalRetriesReplayOneBackendLearner() = runTest {
        val api = FakeBackend(proof)
        val engine = newEngine(api).also { it.login("A", declaration) }
        val request = engine.reserveNormalAdultCreate("id", { "lrn_concurrent" })
        api.createGate = CompletableDeferred()
        val first = async { engine.createNormalAdultLearner(request.clientLearnerId, request.lang) }
        val second = async { engine.createNormalAdultLearner(request.clientLearnerId, request.lang) }
        runCurrent()
        api.createGate!!.complete(Unit)
        assertEquals(first.await(), second.await())
        assertEquals(listOf(Triple("lrn_concurrent", "ADULT", "id"), Triple("lrn_concurrent", "ADULT", "id")), api.createCalls)
        assertEquals(1, api.learnersByOwner.getValue("A").size)
    }

    @Test fun failedJournalWriteBeforePostSendsNothingAndRecordsNothing() = runTest {
        val api = FakeBackend(proof)
        val journal = RecordingJournal()
        val engine = newEngine(api, journal).also { it.login("A", declaration) }
        journal.failWrites = true
        assertFailsWith<IOException> { engine.reserveNormalAdultCreate("id", { "lrn_x" }) }
        assertNull(engine.pendingCreate())
        assertFailsWith<IllegalStateException> { engine.createNormalAdultLearner("lrn_x", "id") }
        assertTrue(api.createCalls.isEmpty(), "No network mutation without a durable record")
        journal.failWrites = false
        val recorded = engine.reserveNormalAdultCreate("id", { "lrn_x" })
        assertEquals("lrn_x", recorded.clientLearnerId)
    }

    @Test fun pendingIsKeptAcrossAnAmbiguousPostAndClearedAtomicallyWithTheBinding() = runTest {
        val api = FakeBackend(proof)
        val journal = RecordingJournal()
        val engine = newEngine(api, journal).also { it.login("A", declaration) }
        val request = engine.reserveNormalAdultCreate("id", { "lrn_atomic" })
        val created = engine.createNormalAdultLearner(request.clientLearnerId, request.lang)
        assertEquals(request, engine.pendingCreate(), "The create reply alone never clears the request")
        val fromReserve = journal.history.size - 1
        engine.select(created, mapOf(proof.track to proof))
        assertNull(engine.pendingCreate())
        val sequence = journal.history.drop(fromReserve)
        assertTrue(sequence.size >= 2)
        sequence.forEach { snapshot ->
            val bound = snapshot.owners["owner-A"]?.containsKey(created.id) == true
            val pending = snapshot.pendingCreates.containsKey("owner-A")
            assertTrue(bound != pending, "Every durable state has exactly one of: pending request, or binding")
        }
        assertTrue(sequence.last().owners.getValue("owner-A").containsKey(created.id))
        assertEquals(created.id, engine.binding()!!.learner.id)
        assertFalse(engine.binding()!!.enabled)
    }

    @Test fun selectingAnotherLearnerKeepsTheUnresolvedRequest() = runTest {
        val api = FakeBackend(proof)
        val engine = ready(api)
        val request = engine.reserveNormalAdultCreate("id", { "lrn_unresolved" })
        engine.select(learner, proof)
        assertEquals(request, engine.pendingCreate())
    }

    @Test fun pendingSurvivesRestartLogoutAndReloginButNotOtherOwnersOrDeviceClear() = runTest {
        val dir = Files.createTempDirectory("umar-pending-journal")
        try {
            val file = dir.resolve("journal.json").toFile()
            val api = FakeBackend(proof)
            val engine = newEngine(api, FileJournal(file)).also { it.login("A", declaration) }
            val request = engine.reserveNormalAdultCreate("id", { "lrn_durable" })
            val restarted = newEngine(api, FileJournal(file))
            assertEquals(request, restarted.pendingCreate(), "Restart restores the owner and its request from disk")
            restarted.resume("A")
            var generated = false
            assertEquals(request, restarted.reserveNormalAdultCreate("id", { generated = true; "lrn_new" }))
            assertFalse(generated)
            restarted.logout()
            assertNull(restarted.pendingCreate(), "Signed out: no active owner, nothing exposed")
            assertEquals(request, FileJournal(file).read().pendingCreates["owner-A"])
            restarted.login("B", declaration)
            assertNull(restarted.pendingCreate(), "Another owner never sees it")
            val b = restarted.reserveNormalAdultCreate("id", { "lrn_b" })
            assertNotEquals(request, b)
            restarted.logout()
            restarted.login("A", declaration)
            assertEquals(request, restarted.pendingCreate())
            assertEquals(setOf("owner-A", "owner-B"), FileJournal(file).read().pendingCreates.keys)
            restarted.clearLocal()
            assertNull(restarted.pendingCreate())
            assertTrue(FileJournal(file).read().pendingCreates.isEmpty())
        } finally { dir.toFile().deleteRecursively() }
    }

    @Test fun deletingWithoutAMatchingBindingRetainsEveryPendingOnlyRequest() = runTest {
        val api = FakeBackend(proof)
        val engine = ready(api)
        val mine = engine.reserveNormalAdultCreate("id", { "lrn_removed" })
        engine.logout()
        api.learnersByOwner["B"] = mutableListOf()
        engine.login("B", declaration)
        val theirs = engine.reserveNormalAdultCreate("id", { "lrn_kept" })
        engine.deleteNativeProfile(mine.clientLearnerId)
        assertEquals(theirs, engine.pendingCreate(), "Another owner's different request is untouched")
        engine.logout()
        engine.login("A", declaration)
        assertEquals(mine, engine.pendingCreate(), "No binding authorized forgetting A's pending-only request")
        var generated = false
        assertEquals(mine, engine.reserveNormalAdultCreate("id", { generated = true; "lrn_new" }))
        assertFalse(generated, "Retry must not issue a fresh client id")
    }

    @Test fun deletingBoundProfileForgetsOnlyAuthorizedOwnersSameIdPendingRequest() = runTest {
        val dir = Files.createTempDirectory("umar-delete-same-id-pending")
        try {
            val file = dir.resolve("journal.json").toFile()
            val api = FakeBackend(proof)
            val engine = ready(api, FileJournal(file))
            val request = PendingCreate(learner.clientLearnerId, "ADULT", "id")
            FileJournal(file).update {
                it.copy(pendingCreates = mapOf("owner-A" to request, "owner-B" to request))
            }
            engine.deleteNativeProfile(learner.clientLearnerId)
            val after = FileJournal(file).read()
            assertTrue(after.owners["owner-A"].orEmpty().isEmpty(), "Existing global binding cleanup is preserved")
            assertNull(after.pendingCreates["owner-A"], "A's matching binding authorizes forgetting its request")
            assertEquals(request, after.pendingCreates["owner-B"], "B's pending-only recovery state is immutable")
            engine.login("B", declaration)
            assertEquals(request, engine.pendingCreate())
            var generated = false
            assertEquals(request, engine.reserveNormalAdultCreate("id", { generated = true; "lrn_duplicate" }))
            assertFalse(generated, "B must replay the retained id rather than duplicating with a fresh one")
        } finally { dir.toFile().deleteRecursively() }
    }

    private val oldSnapshot = """{"schemaVersion":1,"activeOwner":"owner-A","activeLearner":"remote-a","owners":{"owner-A":{"remote-a":{"learner":{"id":"remote-a","client_learner_id":"normal-local-a","kind":"ADULT","audience":"adults","lang":"id","created_by":""},"proof":{"track":"arab","contentVersion":"approved-1","rulesVersion":"rules-1","packSha256":"${"a".repeat(64)}","rulesSha256":"${"b".repeat(64)}","sourceCommit":"source-1"},"proofs":{},"enabled":true,"withdrawalPending":true,"consentRevision":3,"ignored":["old-answer"],"local":{"queued":{"payload":"{}","acknowledgedSequence":null},"sent":{"payload":"{}","acknowledgedSequence":7}},"remote":[],"cursor":7}}}}"""

    private fun journalFile(dir: java.nio.file.Path, text: String) = dir.resolve("journal.json").toFile().also { it.writeText(text) }

    @Test fun oldJournalWithoutPendingDecodesUnchangedAndStaysByteCompatible() {
        val dir = Files.createTempDirectory("umar-old-journal")
        try {
            val file = journalFile(dir, oldSnapshot)
            val journal = FileJournal(file)
            val old = journal.read()
            assertTrue(old.pendingCreates.isEmpty())
            val binding = old.owners.getValue("owner-A").getValue("remote-a")
            assertTrue(binding.enabled && binding.withdrawalPending)
            assertEquals(3, binding.consentRevision)
            assertEquals(setOf("old-answer"), binding.ignored)
            assertEquals(setOf("queued", "sent"), binding.local.keys)
            assertEquals(1, binding.local.values.count { it.acknowledgedSequence == null })
            journal.update { it }
            assertFalse(file.readText().contains("pendingCreates"), "An empty pending map is not written, so old readers still understand the file")
            assertEquals(old, journal.read())
            // Adding a request preserves everything already in the journal.
            val added = journal.update { it.copy(pendingCreates = mapOf("owner-A" to PendingCreate("lrn_new", "ADULT", "en"))) }
            assertEquals(old.owners, added.owners)
            assertEquals(old.activeOwner, added.activeOwner)
            assertEquals(old.activeLearner, added.activeLearner)
            assertEquals(added, FileJournal(file).read())
        } finally { dir.toFile().deleteRecursively() }
    }

    @Test fun malformedOrUnknownPendingDataFailsClosedAndNeverRewritesTheJournal() {
        val bad = listOf(
            """"pendingCreates":{"owner-A":{"clientLearnerId":"lrn_x","kind":"ANAK","lang":"id"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"lrn_x","kind":"ADULT","lang":"fr"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"syn_x","kind":"ADULT","lang":"id"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"bad id!","kind":"ADULT","lang":"id"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"","kind":"ADULT","lang":"id"}}""",
            """"pendingCreates":{"bad owner!":{"clientLearnerId":"lrn_x","kind":"ADULT","lang":"id"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"lrn_x","kind":"ADULT","lang":"id","label":"nickname"}}""",
            """"pendingCreates":{"owner-A":{"clientLearnerId":"lrn_x","kind":"ADULT"}}""",
            """"pendingCreates":["lrn_x"]""",
            """"pendingCreates":null""",
            """"pendingCreate":{"owner-A":{"clientLearnerId":"lrn_x","kind":"ADULT","lang":"id"}}""",
        )
        for (field in bad) {
            val dir = Files.createTempDirectory("umar-bad-pending")
            try {
                val text = oldSnapshot.dropLast(1) + "," + field + "}"
                val file = journalFile(dir, text)
                val journal = FileJournal(file)
                assertFailsWith<IllegalArgumentException>("read must fail closed for $field") { journal.read() }
                assertFailsWith<IllegalArgumentException>("update must not repair $field") { journal.update { it } }
                assertEquals(text, file.readText(), "The journal is never reset or rewritten: $field")
                assertFalse(File(dir.toFile(), "journal.json.pending").exists())
            } finally { dir.toFile().deleteRecursively() }
        }
        val dir = Files.createTempDirectory("umar-future-schema")
        try {
            val text = oldSnapshot.replace("\"schemaVersion\":1", "\"schemaVersion\":2")
            val journal = FileJournal(journalFile(dir, text))
            assertFailsWith<IllegalArgumentException> { journal.read() }
        } finally { dir.toFile().deleteRecursively() }
    }

    // ---- Resolving a pending request: the selected learner must match its immutable parameters ----

    /**
     * A FileJournal that is format-valid but inconsistent with the server learner: an owner with a bound, consented learner
     * that has a queued answer, plus a pending request for [pending]'s id. Returns the engine, journal file and server learner.
     */
    private class Conflict(val engine: SyncEngine, val file: File, val api: FakeBackend, val bound: Binding, val server: Learner)
    private suspend fun conflict(dir: java.nio.file.Path, pending: PendingCreate, server: Learner): Conflict {
        val file = dir.resolve("journal.json").toFile()
        val api = FakeBackend(proof)
        val engine = ready(api, FileJournal(file))
        engine.enable(emptyList())
        engine.capture(listOf(payload("queued")))
        api.learnersByOwner.getValue("A") += server
        FileJournal(file).update { it.copy(pendingCreates = mapOf("owner-A" to pending)) }
        return Conflict(engine, file, api, engine.binding()!!, server)
    }
    private suspend fun Conflict.assertSelectionRefusedAndNothingWritten(expectedPending: PendingCreate) {
        val before = file.readBytes()
        val generation = engine.sessionGeneration()
        assertFailsWith<IllegalStateException> { engine.select(server, proof) }
        assertContentEquals(before, file.readBytes(), "A refused selection must not write the journal")
        assertEquals(generation, engine.sessionGeneration(), "A refused selection must not advance the session")
        assertEquals(bound, engine.binding(), "Selection, consent and the outbox stay as they were")
        assertTrue(engine.binding()!!.enabled && engine.pendingCount() == 1)
        assertEquals(expectedPending, engine.pendingCreate(), "The immutable request is neither cleared nor changed")
        assertFalse(FileJournal(file).read().owners.getValue("owner-A").containsKey(server.id))
    }

    @Test fun selectRefusesToClearAPendingRequestWhoseLanguageDiffersFromTheServerLearner() = runTest {
        val dir = Files.createTempDirectory("umar-conflicting-pending-lang")
        try {
            val pending = PendingCreate("lrn_conflict", "ADULT", "en")
            conflict(dir, pending, Learner("remote-x", "lrn_conflict", "ADULT", "adults", "id")).assertSelectionRefusedAndNothingWritten(pending)
        } finally { dir.toFile().deleteRecursively() }
    }

    @Test fun selectRefusesToClearAPendingRequestWhenTheServerLearnerHasACreator() = runTest {
        val dir = Files.createTempDirectory("umar-conflicting-pending-creator")
        try {
            val pending = PendingCreate("lrn_conflict", "ADULT", "id")
            conflict(dir, pending, Learner("remote-x", "lrn_conflict", "ADULT", "adults", "id", createdBy = "3f2b6c1e-0000-4000-8000-000000000000"))
                .assertSelectionRefusedAndNothingWritten(pending)
        } finally { dir.toFile().deleteRecursively() }
    }

    @Test fun selectingTheMatchingServerLearnerStillResolvesThePendingRequestAndKeepsOtherState() = runTest {
        val dir = Files.createTempDirectory("umar-matching-pending")
        try {
            val c = conflict(dir, PendingCreate("lrn_match", "ADULT", "id"), Learner("remote-m", "lrn_match", "ADULT", "adults", "id"))
            c.engine.select(c.server, proof)
            assertNull(c.engine.pendingCreate())
            assertEquals(c.server, c.engine.binding()!!.learner)
            val journal = FileJournal(c.file).read()
            assertTrue(journal.pendingCreates.isEmpty())
            // The previously bound learner keeps its consent and queued answer.
            val previous = journal.owners.getValue("owner-A").getValue(c.bound.learner.id)
            assertEquals(c.bound, previous)
        } finally { dir.toFile().deleteRecursively() }
    }

    @Test fun selectingAnUnrelatedLearnerLeavesAnotherIdsPendingRequestUntouched() = runTest {
        val dir = Files.createTempDirectory("umar-unrelated-pending")
        try {
            val pending = PendingCreate("lrn_other", "ADULT", "en")
            val c = conflict(dir, pending, Learner("remote-u", "lrn_unrelated", "ADULT", "adults", "id"))
            c.engine.select(c.server, proof)
            assertEquals(pending, c.engine.pendingCreate())
        } finally { dir.toFile().deleteRecursively() }
    }
}
