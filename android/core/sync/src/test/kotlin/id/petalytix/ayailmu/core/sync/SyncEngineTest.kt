package id.petalytix.ayailmu.core.sync

import java.io.IOException
import java.nio.file.Files
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.json.*
import org.junit.Test

class SyncEngineTest {
    private val proof = PackProof("arab", "demo-synthetic-0.1", "pilot-0.1", "a".repeat(64), "b".repeat(64), "815e30f0da284b9818fadc0143f4da92544384d3")
    private fun learner(id: String = "learner-1") = Learner(id, "syn_$id", "ADULT", "adults", "id")
    private fun payload(id: String, learner: Learner = learner()): String = """{"answer_id":"$id","learner_id":"${learner.clientLearnerId}","item_id":"DEMO-1","track":"arab","content_version":"demo-synthetic-0.1","rules_version":"pilot-0.1","app_version":"0.1.0-synclab","timestamp":"2026-10-19T01:00:00Z","local_date":"2026-10-19","session_id":"syn-session","lang":"id","pool":"PRACT","unit":"A","skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"synthetic":true,"review_status":"draft","item_type":"choose"}"""
    private class FakeBackend(val proof: PackProof) : Backend {
        var offline = false
        var expired = false
        var remoteRevoked = false
        var loseReceiptOnce = false
        var malformedReceipt = false
        var malformedPage = false
        var duplicateReceiptSequence = false
        var grantBlock: CompletableDeferred<Unit>? = null
        val grantEntered = CompletableDeferred<Unit>()
        var withdrawBlock: CompletableDeferred<Unit>? = null
        val withdrawEntered = CompletableDeferred<Unit>()
        var block: CompletableDeferred<Unit>? = null
        val entered = CompletableDeferred<Unit>()
        val posted = mutableListOf<Pair<String, List<String>>>()
        val events = mutableMapOf<String, LinkedHashMap<String, String>>()
        val profiles = mutableMapOf<String, MutableList<Learner>>()
        override suspend fun account(token: String): String { checkNetwork(); return "owner-$token" }
        override suspend fun learners(token: String): List<Learner> { checkNetwork(); return profiles[token].orEmpty() }
        override suspend fun createLearner(token: String, clientId: String): Learner { checkNetwork(); val l=Learner("remote-$clientId",clientId,"ADULT","adults","id");profiles.getOrPut(token){ mutableListOf() }.add(l);return l }
        override suspend fun catalog(token: String): Catalog { checkNetwork();return Catalog(proof.sourceCommit,listOf(CatalogPack(proof.track,proof.contentVersion,proof.rulesVersion,proof.packSha256,proof.rulesSha256))) }
        override suspend fun consent(token: String, learnerId: String, granted: Boolean) { checkNetwork(); if (granted) { grantEntered.complete(Unit); grantBlock?.await() } else { withdrawEntered.complete(Unit); withdrawBlock?.await() }; remoteRevoked=!granted }
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> {
            checkNetwork();if(remoteRevoked)throw ApiFailure(403,"sync_consent_required")
            posted.add(learnerId to payloads);entered.complete(Unit);block?.await()
            val stored=events.getOrPut(learnerId){linkedMapOf()}
            val receipts=payloads.map { raw -> val id=Json.parseToJsonElement(raw).jsonObject.getValue("answer_id").jsonPrimitive.content;val old=stored[id];if(old!=null&&old!=raw)throw ApiFailure(409,"idempotency_conflict");stored[id]=raw;Receipt(id,(stored.keys.indexOf(id)+1).toLong(),old!=null,"registered") }
            if(loseReceiptOnce){loseReceiptOnce=false;throw IOException("synthetic lost receipt")}
            return if(malformedReceipt) emptyList() else if(duplicateReceiptSequence) receipts.map { it.copy(sequence=1) } else receipts
        }
        override suspend fun pull(token: String, learnerId: String, after: Long): Page {
            checkNetwork();if(remoteRevoked)throw ApiFailure(403,"sync_consent_required")
            if(malformedPage)return Page(emptyList(),after+1,false)
            val records=events[learnerId].orEmpty().values.mapIndexed{n,p->RemoteRecord(n+1L,p,"registered")}.filter{it.sequence>after}
            return Page(records,records.lastOrNull()?.sequence?:after,false)
        }
        private fun checkNetwork(){if(offline)throw IOException("synthetic offline");if(expired)throw ApiFailure(401,"unauthorized")}
    }
    private suspend fun ready(api: FakeBackend, store: JournalStore = MemoryJournal()): SyncEngine {
        api.profiles["A"]= mutableListOf(learner(),learner("learner-2"))
        return SyncEngine(api,store).also{it.login("A");it.select(learner(),proof)}
    }
    @Test fun consentDefaultsOffAndDoesNotBackfill() = runTest {
        val api=FakeBackend(proof);val e=ready(api)
        e.capture(listOf(payload("before")))
        assertEquals(0,e.pendingCount());assertEquals(SyncResult.CONSENT_OFF,e.sync());assertTrue(api.posted.isEmpty())
        e.enable(listOf("before"));e.capture(listOf(payload("before"),payload("after")))
        assertEquals(1,e.pendingCount());assertEquals(SyncResult.SYNCED,e.sync());assertEquals(1,api.events[learner().id]?.size)
    }
    @Test fun offlineQueueSurvivesRestartAndUncertainRetry() = runTest {
        val dir=Files.createTempDirectory("umar-journal-test");val path=dir.resolve("journal.json")
        try {
            val api=FakeBackend(proof);val e=ready(api,FileJournal(path.toFile()));e.enable(emptyList());api.offline=true
            val raw=payload("answer-1");e.capture(listOf(raw));assertEquals(SyncResult.OFFLINE,e.sync());assertEquals(1,e.pendingCount())
            api.offline=false;val restored=SyncEngine(api,FileJournal(path.toFile()));restored.login("A");restored.select(learner(),proof)
            api.loseReceiptOnce=true;assertEquals(SyncResult.OFFLINE,restored.sync());assertEquals(1,restored.pendingCount())
            assertEquals(SyncResult.SYNCED,restored.sync());assertEquals(0,restored.pendingCount());assertEquals(raw,restored.history().single().payload)
            assertEquals(1,api.events[learner().id]?.size);assertFalse(Files.readString(path).contains("\"token\""))
        } finally {dir.toFile().deleteRecursively()}
    }
    @Test fun duplicateCaptureAndMutationFailClosed() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());val raw=payload("answer-1")
        e.capture(listOf(raw,raw));assertEquals(1,e.pendingCount())
        assertFailsWith<IllegalArgumentException>{e.capture(listOf(raw.replace("\"outcome\":\"correct\"","\"outcome\":\"wrong\"")))}
        assertEquals(1,e.pendingCount())
    }
    @Test fun logoutAndLearnerSelectionKeepNamespacesSeparate() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1")))
        e.select(learner("learner-2"),proof);assertEquals(0,e.pendingCount());assertTrue(e.history().isEmpty())
        e.logout();api.profiles["B"]=mutableListOf(learner("b-only"));e.login("B");e.select(learner("b-only"),proof)
        assertEquals(0,e.pendingCount());assertTrue(e.history().isEmpty());assertFailsWith<IllegalArgumentException>{e.select(learner(),proof)}
        e.logout();e.login("A");e.select(learner(),proof);assertEquals(1,e.pendingCount())
    }
    @Test fun revokedConsentAndOfflineWithdrawalBlockUploads() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1")))
        api.offline=true;assertEquals(SyncResult.OFFLINE,e.disable());assertEquals(SyncResult.CONSENT_OFF,e.sync())
        assertEquals(1,e.pendingCount());api.offline=false;assertEquals(SyncResult.SYNCED,e.flushWithdrawals());assertTrue(api.remoteRevoked);assertTrue(api.posted.isEmpty())
        e.enable(emptyList());api.remoteRevoked=true;assertEquals(SyncResult.CONSENT_OFF,e.sync());assertEquals(1,e.pendingCount());assertTrue(e.history().isEmpty())
    }
    @Test fun expiredSessionRetainsQueueUntilSameOwnerLogin() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1")));api.expired=true
        assertEquals(SyncResult.LOGIN_REQUIRED,e.sync());assertEquals(1,e.pendingCount());api.expired=false;e.login("A");e.select(learner(),proof)
        assertEquals(SyncResult.SYNCED,e.sync());assertEquals(0,e.pendingCount())
    }
    @Test fun malformedReceiptsAndPagesNeverAdvanceLocalState() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1")));api.malformedReceipt=true
        assertEquals(SyncResult.BLOCKED,e.sync());assertEquals(1,e.pendingCount());api.malformedReceipt=false;api.malformedPage=true
        assertEquals(SyncResult.BLOCKED,e.sync());assertTrue(e.history().isEmpty());api.malformedPage=false;assertEquals(SyncResult.SYNCED,e.sync());assertEquals(1,e.history().size)
    }
    @Test fun lateOwnerResponseCannotAcknowledgeANewSession() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1")));api.block=CompletableDeferred()
        val pending=async{e.sync()};api.entered.await();e.logout();api.profiles["B"]=mutableListOf(learner("b-only"));e.login("B");e.select(learner("b-only"),proof)
        api.block!!.complete(Unit);assertEquals(SyncResult.SESSION_CHANGED,pending.await());assertTrue(e.history().isEmpty());assertEquals(0,e.pendingCount())
        e.logout();e.login("A");e.select(learner(),proof);assertEquals(1,e.pendingCount())
    }
    @Test fun proofMismatchBlocksEnrollment() = runTest {
        val api=FakeBackend(proof);api.profiles["A"]=mutableListOf(learner());val e=SyncEngine(api,MemoryJournal());e.login("A")
        assertFailsWith<IllegalArgumentException>{e.select(learner(),proof.copy(packSha256="c".repeat(64)))}
    }
    @Test fun nativeProfileIdsCannotBeReboundToAnotherOwner() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.logout()
        val collision=Learner("different-server-id",learner().clientLearnerId,"ADULT","adults","id")
        api.profiles["B"]=mutableListOf(collision);e.login("B")
        assertFailsWith<IllegalArgumentException>{e.select(collision,proof)}
        assertEquals(0,e.pendingCount());assertTrue(e.history().isEmpty())
    }
    @Test fun withdrawalDuringGrantWinsLocallyAndAtServer() = runTest {
        val api=FakeBackend(proof);val e=ready(api);api.grantBlock=CompletableDeferred()
        val enabling=async { runCatching { e.enable(emptyList()) } };api.grantEntered.await()
        val disabling=async { e.disable() };runCurrent()
        assertFalse(e.binding()!!.enabled, "Local withdrawal is immediate")
        api.grantBlock!!.complete(Unit);enabling.await();disabling.await()
        assertFalse(e.binding()!!.enabled);assertFalse(e.binding()!!.withdrawalPending)
        assertTrue(api.remoteRevoked, "Withdrawal must follow an already in-flight grant")
    }
    @Test fun duplicateReceiptSequencesDoNotAcknowledgeAnswers() = runTest {
        val api=FakeBackend(proof);val e=ready(api);e.enable(emptyList());e.capture(listOf(payload("a1"),payload("a2")))
        api.duplicateReceiptSequence=true
        assertEquals(SyncResult.BLOCKED,e.sync());assertEquals(2,e.pendingCount())
    }
    @Test fun pendingWithdrawalCompletionCannotAbsorbALaterDisable() = runTest {
        val api=FakeBackend(proof);val e=ready(api);api.offline=true;e.disable();api.offline=false
        api.withdrawBlock=CompletableDeferred()
        val enabling=async { runCatching { e.enable(emptyList()) } };api.withdrawEntered.await()
        val disabling=async { e.disable() };runCurrent();assertFalse(e.binding()!!.enabled)
        api.withdrawBlock!!.complete(Unit);enabling.await();disabling.await()
        assertFalse(e.binding()!!.enabled);assertFalse(e.binding()!!.withdrawalPending);assertTrue(api.remoteRevoked)
    }

}
