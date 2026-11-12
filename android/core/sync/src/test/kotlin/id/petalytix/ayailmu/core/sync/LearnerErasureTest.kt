package id.petalytix.ayailmu.core.sync

import java.io.File
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Test

class LearnerErasureTest {
    private val learner = Learner("20000000-0000-0000-0000-000000000001", "local-adult", "ADULT", "adults", "id")
    private val proof = PackProof("arab", "v1", "rules1", "a".repeat(64), "b".repeat(64), "source")
    private class Api(val learner: Learner, val proof: PackProof) : Backend {
        val requests = mutableListOf<Pair<String, String>>()
        var lost = false
        var wrong = false
        var gate: CompletableDeferred<Unit>? = null
        val entered = CompletableDeferred<Unit>()
        override suspend fun account(token: String) = token
        override suspend fun currentAccount(token: String) = token
        override suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean) = token
        override suspend fun learners(token: String) = listOf(learner)
        override suspend fun createLearner(token: String, clientId: String) = error("not used")
        override suspend fun catalog(token: String) = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
        override suspend fun consent(token: String, learnerId: String, granted: Boolean) = Unit
        override suspend fun append(token: String, learnerId: String, payloads: List<String>) = error("not used")
        override suspend fun pull(token: String, learnerId: String, after: Long) = Page(emptyList(), after, false)
        override suspend fun deleteLearner(token: String, learnerId: String, requestId: String, confirmed: Boolean): LearnerDeletionReceipt {
            assertTrue(confirmed)
            requests += token to requestId
            entered.complete(Unit)
            gate?.await()
            if (lost) throw IOException("response lost after server erasure")
            return LearnerDeletionReceipt("30000000-0000-0000-0000-000000000001", "learner", if (wrong) "20000000-0000-0000-0000-000000000002" else learnerId, requestId, "2026-11-11T12:00:00Z")
        }
    }
    private suspend fun ready(api: Api, journal: JournalStore): SyncEngine = SyncEngine(api, journal, SyncMode.NORMAL).also {
        it.login("owner-a", NormalOwnerDeclaration("owner-v1", true)); it.select(learner, proof); it.enable(emptyList())
    }
    @Test fun confirmationIsRequiredBeforeAnyJournalOrNetworkChange() = runTest {
        val api = Api(learner, proof); val journal = MemoryJournal(); val engine = ready(api, journal)
        val before = journal.read()
        assertFailsWith<IllegalArgumentException> { engine.eraseServerCopy(learner.id, false) }
        assertEquals(before, journal.read()); assertTrue(api.requests.isEmpty())
    }
    @Test fun lostResponseRestartRetriesSameRequestAndPreservesLocalLearning() = runTest {
        val file = File.createTempFile("erasure-journal", ".json").also { it.delete() }
        try {
            val api = Api(learner, proof); val journal = FileJournal(file); val engine = ready(api, journal)
            journal.update { state ->
                val bound = state.owners.getValue("owner-a").getValue(learner.id)
                state.copy(owners = state.owners + ("owner-a" to mapOf(learner.id to bound.copy(local = mapOf("local-history" to Captured("original history"))))))
            }
            api.lost = true
            assertFailsWith<IOException> { engine.eraseServerCopy(learner.id, true) }
            assertFalse(engine.binding()!!.enabled)
            assertNotNull(engine.binding()!!.deletionRequestId)
            assertEquals(SyncResult.CONSENT_OFF, engine.sync())
            assertFailsWith<IllegalStateException> { engine.enable(emptyList()) }
            val restarted = SyncEngine(api, FileJournal(file), SyncMode.NORMAL)
            restarted.resume("owner-a"); api.lost = false
            val receipt = restarted.eraseServerCopy(learner.id, true)
            assertEquals(2, api.requests.size); assertEquals(api.requests[0], api.requests[1])
            assertEquals(receipt, restarted.binding()!!.deletionReceipt)
            assertEquals("original history", restarted.binding()!!.local.getValue("local-history").payload)
            assertEquals(receipt, restarted.eraseServerCopy(learner.id, true)); assertEquals(2, api.requests.size)
            assertEquals(SyncResult.CONSENT_OFF, restarted.disable())
            assertFalse(restarted.binding()!!.enabled)
        } finally { file.delete() }
    }
    @Test fun foreignOwnerCannotRetryAndLateReceiptOnlyUpdatesOriginalOwner() = runTest {
        val api = Api(learner, proof); val journal = MemoryJournal(); val engine = ready(api, journal)
        api.gate = CompletableDeferred()
        val deletion = async { engine.eraseServerCopy(learner.id, true) }
        api.entered.await(); engine.logout(); engine.login("owner-b", NormalOwnerDeclaration("owner-v1", true))
        assertFailsWith<IllegalArgumentException> { engine.eraseServerCopy(learner.id, true) }
        api.gate!!.complete(Unit); val receipt = deletion.await()
        assertEquals("owner-b", engine.owner()); assertNull(engine.binding())
        assertEquals(receipt, journal.read().owners.getValue("owner-a").getValue(learner.id).deletionReceipt)
        assertNull(journal.read().owners["owner-b"])
    }
    @Test fun malformedReceiptKeepsPendingAndDoesNotClaimCompletion() = runTest {
        val api = Api(learner, proof); val engine = ready(api, MemoryJournal()); api.wrong = true
        assertFailsWith<IllegalArgumentException> { engine.eraseServerCopy(learner.id, true) }
        assertNotNull(engine.binding()!!.deletionRequestId); assertNull(engine.binding()!!.deletionReceipt)
        assertFalse(engine.binding()!!.enabled)
    }
    @Test fun failedDurableReservationSendsNothing() = runTest {
        val memory = MemoryJournal(); var fail = false
        val journal = object : JournalStore {
            override fun read() = memory.read()
            override fun update(transform: (JournalSnapshot) -> JournalSnapshot): JournalSnapshot {
                if (fail) throw IOException("disk unavailable")
                return memory.update(transform)
            }
        }
        val api = Api(learner, proof); val engine = ready(api, journal); fail = true
        assertFailsWith<IOException> { engine.eraseServerCopy(learner.id, true) }
        assertTrue(api.requests.isEmpty())
    }
}
