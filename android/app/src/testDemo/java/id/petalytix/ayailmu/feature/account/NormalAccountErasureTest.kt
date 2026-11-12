package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.sync.*
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*

internal class MemoryErasureVault : NormalAccountErasureVault {
    var records = emptyList<SavedAccountErasure>()
    var fail = false
    override fun readErasures(): List<SavedAccountErasure> { if (fail) throw IOException("unreadable"); return records }
    override fun updateErasures(transform: (List<SavedAccountErasure>) -> List<SavedAccountErasure>): List<SavedAccountErasure> {
        if (fail) throw IOException("unwritable")
        return transform(records).also { records = it }
    }
}
internal fun fixtureErasure(account: NormalAccount, sync: NormalSyncRepository, config: NormalAccountConfig) = NormalAccountErasure(
    MemoryErasureVault(), NativeNormalErasureOwner(account, sync), object : AccountErasureApi {
        override suspend fun status(requestId: String, recoveryProof: String): AccountDeletionReceipt? = error("Unexpected deletion fixture network")
        override suspend fun begin(token: String, accountId: String, requestId: String, recoveryProof: String): AccountDeletionReceipt = error("Unexpected deletion fixture network")
    }, config,
)
class NormalAccountErasureTest {
    private val a = "10000000-0000-4000-8000-000000000001"
    private val subject = "20000000-0000-4000-8000-000000000001"
    private val other = "10000000-0000-4000-8000-000000000002"
    private val config = NormalAccountConfig.forValues(true, "https://example.invalid", "normal-v1")
    private class Owner(var identity: ErasureOwner?) : NormalErasureOwner {
        val frozen = mutableMapOf<String, String>()
        val completed = mutableListOf<String>()
        override fun current() = identity
        override fun freeze(record: SavedAccountErasure) { check(frozen[record.owner] in setOf(null, record.request)); frozen[record.owner] = record.request }
        override suspend fun begin(record: SavedAccountErasure, api: AccountErasureApi, accepted: () -> Boolean): AccountDeletionReceipt {
            check(accepted() && identity == ErasureOwner(record.owner, record.subject))
            return api.begin("fixture-token", record.owner, record.request, record.proof)
        }
        override suspend fun completed(record: SavedAccountErasure) { if (identity == ErasureOwner(record.owner, record.subject)) { completed += record.owner; identity = null } }
    }
    private inner class Api(val vault: MemoryErasureVault, val owner: Owner) : AccountErasureApi {
        var begins = 0
        var checks = 0
        var lost = false
        var statusError = false
        var server: AccountDeletionReceipt? = null
        var release: CompletableDeferred<Unit>? = null
        val entered = CompletableDeferred<Unit>()
        override suspend fun status(requestId: String, recoveryProof: String): AccountDeletionReceipt? {
            checks++
            assertEquals(recoveryProof, vault.records.single { it.request == requestId }.proof)
            if (statusError) throw IOException("offline")
            return server
        }
        override suspend fun begin(token: String, accountId: String, requestId: String, recoveryProof: String): AccountDeletionReceipt {
            begins++
            assertEquals(recoveryProof, vault.records.single { it.request == requestId }.proof)
            assertEquals(requestId, owner.frozen[accountId])
            server = AccountDeletionReceipt("30000000-0000-4000-8000-000000000001", "account", requestId, "identity_deletion_pending", "2026-11-11T12:00:00Z")
            entered.complete(Unit); release?.await()
            if (lost) throw IOException("lost after acceptance")
            return server!!
        }
    }
    @Test fun secureIntentAndFreezePrecedeIOAndLostReplyRecoversWithoutAuth() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config)
        assertTrue(flow.restore()); api.lost = true; flow.confirm(a)
        val saved = vault.records.single()
        assertTrue(accountErasureProof(saved.proof)); assertTrue(accountErasureUUID(saved.request))
        assertFalse(saved.toString().contains(saved.proof))
        assertEquals(AccountErasurePhase.UNCONFIRMED, flow.state.value.records.single().phase)
        owner.identity = null
        val restarted = NormalAccountErasure(vault, owner, api, config)
        assertTrue(restarted.restore()); restarted.check(saved.request)
        assertEquals(AccountErasurePhase.IDENTITY_PENDING, restarted.state.value.records.single().phase)
        api.server = api.server!!.copy(status = "completed", identityDeletedAt = "2026-11-11T12:01:00Z")
        restarted.check(saved.request)
        assertEquals(AccountErasurePhase.COMPLETED, restarted.state.value.records.single().phase)
        assertEquals(1, api.begins)
        assertEquals(saved.proof, vault.records.single().proof)
    }
    @Test fun failedStatusNeverStartsDeletionAndRetryReusesExactProof() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config); flow.restore()
        api.statusError = true; flow.confirm(a)
        assertEquals(0, api.begins)
        val saved = vault.records.single()
        api.statusError = false; flow.check(saved.request)
        assertEquals(0, api.begins)
        flow.retry(saved.request)
        assertEquals(1, api.begins)
        assertEquals(saved.request, vault.records.single().request)
        assertEquals(saved.proof, vault.records.single().proof)
    }
    @Test fun corruptStorageBlocksAccountActionsAndSendsNothing() = runTest {
        val vault = MemoryErasureVault().apply { fail = true }; val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config)
        assertFalse(flow.restore()); flow.confirm(a)
        assertTrue(flow.state.value.blocked)
        assertEquals(0, api.checks); assertEquals(0, api.begins)
    }
    @Test fun aDifferentOwnerCannotSendRetryAndLateReceiptDoesNotClearIt() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config); flow.restore()
        api.release = CompletableDeferred()
        val work = async { flow.confirm(a) }
        api.entered.await()
        owner.identity = ErasureOwner(other, subject)
        api.server = api.server!!.copy(status = "completed", identityDeletedAt = "2026-11-11T12:01:00Z")
        api.release!!.complete(Unit); work.await()
        assertEquals(other, owner.identity!!.owner); assertTrue(owner.completed.isEmpty())
        assertEquals(AccountErasurePhase.COMPLETED, flow.state.value.records.single().phase)
        assertEquals(1, api.begins)
    }
    @Test fun explicitDeviceResetFencesLateResponseAndCannotRecreateProof() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config); flow.restore()
        api.release = CompletableDeferred()
        val work = async { flow.confirm(a) }; api.entered.await()
        flow.cancelForDeviceReset(); vault.records = emptyList()
        api.release!!.complete(Unit); work.await()
        assertTrue(vault.records.isEmpty()); assertTrue(flow.state.value.records.isEmpty())
    }
    @Test fun newViewModelRestoreCannotReopenActionsDuringDeviceReset() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config); flow.restore()
        flow.cancelForDeviceReset()
        assertFalse(flow.restore())
        flow.confirm(a)
        assertTrue(flow.state.value.blocked); assertEquals(0, api.checks); assertTrue(vault.records.isEmpty())
        flow.finishDeviceReset()
        assertTrue(flow.restore())
        flow.confirm(a)
        assertEquals(1, api.begins)
    }
    @Test fun malformedOrRegressingReceiptsNeverReplaceKnownEvidence() = runTest {
        val vault = MemoryErasureVault(); val owner = Owner(ErasureOwner(a, subject)); val api = Api(vault, owner)
        val flow = NormalAccountErasure(vault, owner, api, config); flow.restore(); flow.confirm(a)
        val saved = vault.records.single()
        api.server = api.server!!.copy(requestId = other)
        flow.check(saved.request)
        assertEquals(saved, vault.records.single())
        assertEquals(AccountErasurePhase.IDENTITY_PENDING, flow.state.value.records.single().phase)
        api.server = saved.receipt!!.copy(deletionId = other)
        flow.check(saved.request)
        assertEquals(saved, vault.records.single())
    }
}
