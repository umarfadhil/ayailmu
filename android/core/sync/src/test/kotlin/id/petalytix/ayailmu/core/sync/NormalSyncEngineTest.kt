package id.petalytix.ayailmu.core.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
        override suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String): Learner {
            checkNetwork(token)
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
}
