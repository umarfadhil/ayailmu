package id.petalytix.ayailmu.core.sync

import java.io.File
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Test

class AccountErasureFenceTest {
    private val owner = "10000000-0000-4000-8000-000000000001"
    private val request = "20000000-0000-4000-8000-000000000001"
    private val learner = Learner("30000000-0000-4000-8000-000000000001", "local", "ADULT", "adults", "id")
    private val proof = PackProof("math", "v1", "v1", "a".repeat(64), "b".repeat(64), "source")
    private inner class Api : Backend {
        var writes = 0
        var consentEntered: CompletableDeferred<Unit>? = null
        var consentRelease: CompletableDeferred<Unit>? = null
        override suspend fun account(token: String) = token
        override suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean) = token
        override suspend fun currentAccount(token: String) = token
        override suspend fun learners(token: String) = listOf(learner)
        override suspend fun createLearner(token: String, clientId: String): Learner { writes++; return learner }
        override suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String): Learner { writes++; return learner }
        override suspend fun catalog(token: String) = Catalog("source", listOf(CatalogPack("math", "v1", "v1", proof.packSha256, proof.rulesSha256)))
        override suspend fun consent(token: String, learnerId: String, granted: Boolean) { writes++; consentEntered?.complete(Unit); consentRelease?.await() }
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> { writes++; return emptyList() }
        override suspend fun pull(token: String, learnerId: String, after: Long) = Page(emptyList(), after, false)
    }
    private suspend fun ready(api: Api, journal: JournalStore) = SyncEngine(api, journal, SyncMode.NORMAL).also {
        it.login(owner, NormalOwnerDeclaration("v1", true)); it.select(learner, proof); it.enable(emptyList())
    }
    @Test fun allOwnedBindingsFreezeDurablyAndCannotBeReenabledAcrossRestart() = runTest {
        val file = File.createTempFile("account-fence", ".json").also { it.delete() }
        try {
            val api = Api(); val journal = FileJournal(file); val engine = ready(api, journal)
            engine.freezeAccountErasure(owner, request)
            assertEquals(request, engine.accountErasure(owner))
            assertFalse(engine.binding()!!.enabled)
            assertEquals(owner, engine.owner())
            val restarted = SyncEngine(api, FileJournal(file), SyncMode.NORMAL)
            restarted.resume(owner)
            assertFails { restarted.enable(emptyList()) }
            assertFails { restarted.reserveNormalAdultCreate("id", { "new" }) }
            assertEquals(SyncResult.CONSENT_OFF, restarted.sync())
            assertEquals(SyncResult.CONSENT_OFF, restarted.flushWithdrawals())
            var sent = false
            restarted.withAccountErasureSession(owner, request) { assertEquals(owner, it); sent = true }
            assertTrue(sent)
            assertFails { restarted.freezeAccountErasure(owner, "40000000-0000-4000-8000-000000000001") }
            assertFalse(file.readText().contains("recovery"))
        } finally { file.delete() }
    }
    @Test fun earlierEnableCannotReopenUploadAndDeletionWaitsForInFlightWrite() = runTest {
        val api = Api(); val engine = ready(api, MemoryJournal())
        engine.disable()
        api.consentEntered = CompletableDeferred(); api.consentRelease = CompletableDeferred()
        val enable = async { runCatching { engine.enable(emptyList()) } }
        api.consentEntered!!.await()
        engine.freezeAccountErasure(owner, request)
        var deleted = false
        val deletion = async { engine.withAccountErasureSession(owner, request) { deleted = true } }
        assertFalse(deleted)
        api.consentRelease!!.complete(Unit)
        assertTrue(enable.await().isFailure)
        deletion.await()
        assertFalse(engine.binding()!!.enabled)
        assertTrue(deleted)
    }
    @Test fun switchingOwnerBeforeTransmissionSendsNothingAndKeepsOfflineOwner() = runTest {
        val api = Api(); val journal = MemoryJournal(); val engine = ready(api, journal)
        engine.freezeAccountErasure(owner, request)
        engine.logout(); engine.login("other", NormalOwnerDeclaration("v1", true))
        assertFails { engine.withAccountErasureSession(owner, request) { error("must not send") } }
        assertEquals("other", engine.owner())
        assertFalse(engine.expireAccountErasureSession(owner, request))
        assertTrue(engine.authenticated())
        assertEquals(request, journal.read().accountErasures[owner])
    }
}
