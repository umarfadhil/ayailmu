package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.sync.*
import java.security.SecureRandom
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

/** Only the encrypted, no-backup vault may persist this credential. Never export or render it. */
@Serializable
internal data class SavedAccountErasure(
    val environment: String,
    val owner: String,
    val subject: String,
    val request: String,
    val proof: String,
    val receipt: AccountDeletionReceipt? = null,
) {
    fun requireValid(origin: String) {
        require(environment == origin && accountErasureUUID(owner) && accountErasureUUID(subject) && accountErasureUUID(request) && accountErasureProof(proof))
        receipt?.requireValid(request)
    }
    override fun toString() = "SavedAccountErasure(redacted)"
}
internal interface NormalAccountErasureVault {
    fun readErasures(): List<SavedAccountErasure>
    fun updateErasures(transform: (List<SavedAccountErasure>) -> List<SavedAccountErasure>): List<SavedAccountErasure>
}
internal data class ErasureOwner(val owner: String, val subject: String)
internal interface NormalErasureOwner {
    fun current(): ErasureOwner?
    fun freeze(record: SavedAccountErasure)
    suspend fun begin(record: SavedAccountErasure, api: AccountErasureApi, accepted: () -> Boolean): AccountDeletionReceipt
    suspend fun completed(record: SavedAccountErasure)
}
internal enum class AccountErasurePhase { UNCONFIRMED, IDENTITY_PENDING, COMPLETED }
internal enum class AccountErasureNotice { CHECK_FAILED, SIGN_IN_REQUIRED, FRESH_AUTH_REQUIRED, STORAGE_FAILED }
internal data class AccountErasureSummary(val owner: String, val request: String, val phase: AccountErasurePhase)
internal data class NormalAccountErasureState(
    val restored: Boolean = false,
    val blocked: Boolean = false,
    val busy: Boolean = false,
    val records: List<AccountErasureSummary> = emptyList(),
    val notice: AccountErasureNotice? = null,
)

/** A confirmed intent never becomes a new request after a lost reply, restart or ordinary sign-out. */
@Singleton
internal class NormalAccountErasure @Inject constructor(
    private val vault: NormalAccountErasureVault,
    private val owner: NormalErasureOwner,
    private val api: AccountErasureApi,
    private val config: NormalAccountConfig,
) {
    private val mutex = Mutex()
    private val lock = Any()
    @Volatile private var generation = 0L
    private var resetInProgress = false
    private val mutable = MutableStateFlow(NormalAccountErasureState())
    val state = mutable.asStateFlow()
    private fun mark() = generation
    private fun current(mark: Long) = generation == mark
    private fun read() = vault.readErasures().also { records ->
        require(records.size <= 16 && records.map { it.owner }.toSet().size == records.size && records.map { it.request }.toSet().size == records.size)
        records.forEach { it.requireValid(config.publicOrigin) }
    }
    private fun publish(mark: Long, busy: Boolean = false, notice: AccountErasureNotice? = null) = synchronized(lock) {
        if (!current(mark)) return
        val records = read()
        // A rename can succeed before its directory flush fails. Establish the upload fence before claiming it.
        records.forEach(owner::freeze)
        mutable.value = NormalAccountErasureState(restored = true, busy = busy, notice = notice, records = records.map {
            AccountErasureSummary(it.owner, it.request, when { it.receipt?.completed == true -> AccountErasurePhase.COMPLETED; it.receipt != null -> AccountErasurePhase.IDENTITY_PENDING; else -> AccountErasurePhase.UNCONFIRMED })
        })
    }
    private fun storageFailure(mark: Long) = synchronized(lock) {
        if (current(mark)) mutable.value = mutable.value.copy(restored = true, blocked = true, busy = false, notice = AccountErasureNotice.STORAGE_FAILED)
    }
    /** Must finish before the ordinary account restore can refresh or resume uploads. */
    suspend fun restore(): Boolean = withContext(Dispatchers.IO) { mutex.withLock {
        val mark = mark()
        if (synchronized(lock) { resetInProgress }) return@withLock false
        try {
            synchronized(lock) { check(current(mark)); read().forEach(owner::freeze) }
            for (record in read()) if (record.receipt?.completed == true && current(mark)) owner.completed(record)
            publish(mark)
            current(mark)
        } catch (e: CancellationException) { throw e } catch (_: Exception) { storageFailure(mark); false }
    } }
    suspend fun confirm(expectedOwner: String) = operate { mark ->
        val identity = owner.current()
        if (identity == null || identity.owner != expectedOwner) { publish(mark, notice = AccountErasureNotice.SIGN_IN_REQUIRED); return@operate }
        val record = synchronized(lock) {
            check(current(mark))
            val existing = read().singleOrNull { it.owner == expectedOwner }
            if (existing != null) {
                check(existing.subject == identity.subject)
                existing
            } else {
                val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
                val record = SavedAccountErasure(config.publicOrigin, identity.owner, identity.subject, UUID.randomUUID().toString(), bytes.joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') })
                record.requireValid(config.publicOrigin)
                vault.updateErasures { previous -> check(previous.size < 16 && previous.none { it.owner == expectedOwner }); previous + record }
                record
            }.also(owner::freeze)
        }
        recover(record, mark, allowBegin = true)
    }
    /** Check never initiates a deletion: recovery can run after Auth deletion without a session. */
    suspend fun check(request: String) = operate { mark ->
        val record = read().singleOrNull { it.request == request } ?: return@operate
        synchronized(lock) { check(current(mark)); owner.freeze(record) }
        recover(record, mark, allowBegin = false)
    }
    /** Explicit retry is scoped to the already confirmed identity, never a replacement request. */
    suspend fun retry(request: String) = operate { mark ->
        val record = read().singleOrNull { it.request == request } ?: return@operate
        synchronized(lock) { check(current(mark)); owner.freeze(record) }
        recover(record, mark, allowBegin = true)
    }
    private suspend fun recover(record: SavedAccountErasure, mark: Long, allowBegin: Boolean) {
        synchronized(lock) { check(current(mark)); vault.updateErasures { it } } // Re-establish durability even after a prior failed directory flush.
        publish(mark, busy = true)
        val receipt = if (record.receipt?.completed == true) record.receipt else {
            val status = api.status(record.request, record.proof)
            if (!current(mark)) return
            if (status != null) status else {
                // Once server erasure was confirmed, a later 404 is not permission to recreate it.
                if (record.receipt != null || !allowBegin) { publish(mark, notice = AccountErasureNotice.CHECK_FAILED); return }
                if (owner.current() != ErasureOwner(record.owner, record.subject)) { publish(mark, notice = AccountErasureNotice.SIGN_IN_REQUIRED); return }
                owner.begin(record, api) { current(mark) }
            }
        }
        receipt.requireValid(record.request)
        synchronized(lock) {
            if (!current(mark)) return
            vault.updateErasures { previous ->
                previous.map { existing ->
                    if (existing.request != record.request) existing else {
                        check(existing.owner == record.owner && existing.subject == record.subject && existing.proof == record.proof)
                        // Pending or inconsistent replies never overwrite confirmed evidence.
                        existing.receipt?.let { old ->
                            check(old.deletionId == receipt.deletionId && old.appDataErasedAt == receipt.appDataErasedAt)
                            check(!old.completed || receipt == old)
                        }
                        existing.copy(receipt = receipt)
                    }
                }
            }
        }
        if (receipt.completed && current(mark)) owner.completed(record.copy(receipt = receipt))
        publish(mark)
    }
    private suspend fun operate(block: suspend (Long) -> Unit) = withContext(Dispatchers.IO) { mutex.withLock {
        val mark = mark()
        if (!config.enabled || !state.value.restored || state.value.blocked) return@withLock
        try { block(mark) } catch (e: CancellationException) { if (current(mark)) runCatching { publish(mark, notice = AccountErasureNotice.CHECK_FAILED) }; throw e }
        catch (e: Exception) {
            val notice = if (e is ApiFailure && e.code in setOf("unauthorized", "fresh_authentication_required", "fresh_auth_required")) AccountErasureNotice.FRESH_AUTH_REQUIRED else AccountErasureNotice.CHECK_FAILED
            try { publish(mark, notice = notice) } catch (_: Exception) { storageFailure(mark) }
        }
    } }
    /** Called only for explicit device-wide data deletion, before clearing the vault namespace. */
    fun cancelForDeviceReset() = synchronized(lock) {
        resetInProgress = true
        generation++
        mutable.value = NormalAccountErasureState(restored = false, blocked = true)
    }
    fun finishDeviceReset() = synchronized(lock) {
        check(resetInProgress)
        resetInProgress = false
        mutable.value = NormalAccountErasureState(restored = true)
    }
}

/** Session access stays internal. Auth subject and application account UUID are checked separately. */
@Singleton
internal class NativeNormalErasureOwner @Inject constructor(private val account: NormalAccount, private val sync: NormalSyncRepository) : NormalErasureOwner {
    override fun current(): ErasureOwner? {
        val credential = account.erasureCredential() ?: return null
        val owner = sync.erasureOwner() ?: return null
        return if (credential.accepted()) ErasureOwner(owner, credential.subject) else null
    }
    override fun freeze(record: SavedAccountErasure) = sync.freezeAccountErasure(record)
    override suspend fun begin(record: SavedAccountErasure, api: AccountErasureApi, accepted: () -> Boolean): AccountDeletionReceipt {
        val credential = account.erasureCredential() ?: throw ApiFailure(401, "unauthorized")
        check(credential.subject == record.subject)
        return sync.beginAccountErasure(record, credential, api, accepted)
    }
    override suspend fun completed(record: SavedAccountErasure) {
        sync.expireErasedOwner(record) { account.finishAccountErasure(record.subject) }
        sync.publishAccountErasure()
    }
}
