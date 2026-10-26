package id.petalytix.ayailmu.feature.account

import android.content.Context
import androidx.room.withTransaction
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.OwnerBindingEntity
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.db.toEntity
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentCatalog
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ReviewStatus
import id.petalytix.ayailmu.core.sync.*
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal enum class NormalSyncNotice { SIGNED_OUT, READY, OFFLINE, LOGIN_REQUIRED, FRESH_AUTH_REQUIRED, SYNCED, DISABLED, CONSENT_UPDATE_REQUIRED, NO_APPROVED_CONTENT, FAILED }
internal data class NormalSyncState(
    val owner: String? = null,
    val authenticated: Boolean = false,
    val learners: List<Learner> = emptyList(),
    val learnerLabels: Map<String, String> = emptyMap(),
    val selected: Learner? = null,
    val enabled: Boolean = false,
    val pending: Int = 0,
    val restoredAnswers: Int = 0,
    val busy: Boolean = false,
    val notice: NormalSyncNotice = NormalSyncNotice.SIGNED_OUT,
)

/** Native normal learning bridge. Existing unbound Room profiles/history are never attached or backfilled. */
@Singleton
internal class NormalSyncRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: AyaDatabase,
    private val active: ActiveProfileStore,
    private val assets: AssetSource,
    private val content: ContentRepository,
    private val clock: Clock,
    private val api: Backend,
    private val config: NormalAccountConfig,
    private val visibility: NormalProfileVisibility,
) : NormalOwnerSync {
    private val engine = SyncEngine(api, FileJournal(File(context.noBackupFilesDir, "normal-owner-sync/${config.environmentHash}/journal.json")), SyncMode.NORMAL)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val localLock = Mutex()
    private val actionMutex = Mutex()
    private var observed: Job? = null
    private var remoteLearners: Pair<String, List<Learner>>? = null
    private var actionGeneration = 0L
    private val mutable = MutableStateFlow(NormalSyncState())
    val state = mutable.asStateFlow()

    init {
        scope.launch {
            ensureOwnerContext()
            engine.binding()?.let { activate(it.learner, true) }
            publish()
        }
    }

    private fun beginAction(): () -> Boolean {
        val mark = synchronized(this) { ++actionGeneration }
        mutable.value = mutable.value.copy(busy = true)
        return { synchronized(this) { actionGeneration == mark } }
    }
    fun cancelActions() {
        synchronized(this) { actionGeneration++ }
        mutable.value = mutable.value.copy(busy = false)
    }

    override suspend fun login(token: String, declaration: NormalOwnerDeclaration, accepted: () -> Boolean, onCommitted: ((Long) -> Unit)?) = withContext(Dispatchers.IO) {
        engine.login(token, declaration, accepted, onCommitted)
        finishLogin(requireNotNull(engine.owner()), accepted)
    }
    override suspend fun resume(token: String, accepted: () -> Boolean) = withContext(Dispatchers.IO) {
        engine.resume(token, accepted)
        finishLogin(requireNotNull(engine.owner()), accepted)
    }
    private suspend fun finishLogin(owner: String, accepted: () -> Boolean) {
        if (!accepted()) return
        engine.flushWithdrawals()
        if (!accepted() || engine.owner() != owner) return
        ensureOwnerContext()
        remoteLearners = try { owner to engine.availableLearners() } catch (e: Exception) {
            if (e is CancellationException) throw e
            publish(NormalSyncNotice.OFFLINE); return
        }
        engine.binding()?.let { if (accepted() && engine.owner() == owner) activate(it.learner, true) }
        publish(if (engine.authenticated()) NormalSyncNotice.READY else NormalSyncNotice.LOGIN_REQUIRED)
    }

    suspend fun createAdult(label: String, lang: String) {
        require(label.isNotBlank() && lang in setOf("id", "en"))
        val accepted = beginAction()
        actionMutex.withLock {
        if (!accepted()) return@withLock
        try {
            val clientId = "lrn_" + UUID.randomUUID()
            check(db.profiles().get(clientId) == null) { "Local profile already exists" }
            val learner = engine.createNormalAdultLearner(clientId, lang, accepted)
            selectInternal(learner, label, accepted)
        } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    suspend fun select(learner: Learner, newLabel: String? = null) {
        val accepted = beginAction()
        actionMutex.withLock {
            if (accepted()) try { selectInternal(learner, newLabel, accepted) } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    private suspend fun selectInternal(learner: Learner, newLabel: String?, accepted: () -> Boolean) {
        val previous = engine.binding()?.learner?.id
        val known = engine.knownLearners().any { it.id == learner.id }
        if (!known) {
            val existing = db.profiles().get(learner.clientLearnerId)
            val owned = db.ownerBindings().all().firstOrNull { it.profileId == learner.clientLearnerId }
            if (owned != null) {
                check(owned.ownerId == engine.owner() && owned.environmentId == config.environmentHash) { "Room learner belongs to another owner/environment" }
            } else check(existing == null) { "Unbound device profiles cannot be attached" }
        }
        try {
            engine.select(learner, proofs(), accepted)
            if (!accepted()) { engine.rollbackNormalSelection(learner.id, previous); publish(); return }
            if (!activate(learner, true, newLabel, accepted)) { engine.rollbackNormalSelection(learner.id, previous); publish(); return }
            if (!accepted()) return
            remoteLearners = requireNotNull(engine.owner()) to engine.availableLearners()
            if (accepted()) publish(NormalSyncNotice.READY)
        } catch (e: Exception) {
            throw e
        } finally {
            if (!accepted()) {
                engine.rollbackNormalSelection(learner.id, previous)
                publish()
            }
        }
    }
    suspend fun enable() {
        val accepted = beginAction()
        actionMutex.withLock {
        if (!accepted()) return@withLock
        try {
            val learner = requireNotNull(engine.binding()).learner
            engine.capture(db.answers().payloads(learner.clientLearnerId), learner.id)
            val ids = db.answers().payloads(learner.clientLearnerId).map { ContentJson.json.decodeFromString(AnswerEvent.serializer(), it).answerId }
            engine.enable(ids, accepted)
            if (accepted()) publish(NormalSyncNotice.READY)
        } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    suspend fun disable() {
        val accepted = beginAction()
        actionMutex.withLock {
        if (!accepted()) return@withLock
        try {
            val result = engine.disable(accepted)
            if (accepted()) publish(result.notice())
        } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    suspend fun sync(): SyncResult {
        val accepted = beginAction()
        return actionMutex.withLock {
        if (!accepted()) return@withLock SyncResult.SESSION_CHANGED
        try {
            engine.binding()?.let { engine.capture(db.answers().payloads(it.learner.clientLearnerId), it.learner.id) }
            val result = engine.sync(accepted)
            if (!accepted()) return@withLock result
            if (result == SyncResult.SYNCED) importRemote()
            publish(result.notice())
            result
        } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    fun failed(error: Exception) {
        if (error is ApiFailure && error.code == "fresh_authentication_required") {
            engine.expireSession()
            scope.launch { publish(NormalSyncNotice.FRESH_AUTH_REQUIRED) }
        } else {
            val notice = when {
                error is IOException -> NormalSyncNotice.OFFLINE
                error.message == "No approved native tracks configured" -> NormalSyncNotice.NO_APPROVED_CONTENT
                else -> NormalSyncNotice.FAILED
            }
            mutable.value = mutable.value.copy(busy = false, notice = notice)
        }
    }

    private suspend fun importRemote() {
        val binding = engine.binding() ?: return
        val registered = binding.remote.filter { it.registryStatus == "registered" }
        db.withTransaction {
            for (record in registered) {
                val event = ContentJson.json.decodeFromString(AnswerEvent.serializer(), record.payload)
                require(!event.synthetic && event.reviewStatus == ReviewStatus.APPROVED && event.learnerId == binding.learner.clientLearnerId)
                val proofs = binding.proofs.ifEmpty { mapOf(binding.proof.track to binding.proof) }
                val proof = requireNotNull(proofs[event.track])
                require(event.contentVersion == proof.contentVersion && event.rulesVersion == proof.rulesVersion)
                val old = db.answers().byId(event.answerId)
                if (old != null) require(old.payload == record.payload && old.profileId == event.learnerId) { "Immutable answer conflict" }
                else db.answers().insert(event.toEntity(event.learnerId))
            }
        }
    }
    private suspend fun activate(learner: Learner, observe: Boolean, newLabel: String? = null, accepted: () -> Boolean = { true }): Boolean = localLock.withLock {
        if (!accepted() || engine.binding()?.learner?.id != learner.id) return@withLock false
        ensureNative(learner, newLabel)
        active.setActive(learner.clientLearnerId)
        if (!accepted() || engine.binding()?.learner?.id != learner.id) return@withLock false
        if (observe) {
            observed?.cancel()
            observed = scope.launch {
                db.answers().observePayloads(learner.clientLearnerId).collect { payloads ->
                    if (engine.binding()?.learner?.id == learner.id) {
                        runCatching { engine.capture(payloads, learner.id) }
                        publish()
                    }
                }
            }
        }
        true
    }
    private suspend fun ensureNative(learner: Learner, newLabel: String?) {
        require(learner.kind == "ADULT" && !learner.clientLearnerId.startsWith("syn_"))
        db.withTransaction {
            val existing = db.profiles().get(learner.clientLearnerId)
            if (existing == null) {
                db.profiles().upsert(ProfileEntity(
                    learner.clientLearnerId, newLabel?.trim()?.takeIf { it.isNotEmpty() } ?: context.getString(R.string.normal_account_default_learner),
                    "ADULT", null, null, "ADULTS", learner.lang, clock.now().toEpochMilli(), null, 1f, "[]", null, null,
                ))
            } else require(existing.kind == "ADULT" && existing.createdBy == null)
            db.ownerBindings().upsert(OwnerBindingEntity(learner.clientLearnerId, requireNotNull(engine.owner()), config.environmentHash))
        }
    }
    suspend fun deleteProfile(profileId: String) = withContext(Dispatchers.IO) {
        cancelActions()
        observed?.cancel(); observed = null
        engine.deleteNativeProfile(profileId)
        publish()
    }
    suspend fun deleteDevice() = withContext(Dispatchers.IO) {
        cancelActions()
        observed?.cancel(); observed = null
        remoteLearners = null
        engine.clearLocal()
        publish()
    }
    override suspend fun logout(accepted: () -> Boolean) = withContext(Dispatchers.IO) {
        if (!accepted()) return@withContext
        observed?.cancel(); observed = null
        engine.logout(); remoteLearners = null
        val current = active.activeId.first()
        visibility.refresh()
        if (current != null && !visibility.allows(current)) selectBestLocalProfile()
        publish(NormalSyncNotice.SIGNED_OUT)
    }
    override suspend fun expireSession(accepted: () -> Boolean) = withContext(Dispatchers.IO) {
        if (accepted()) engine.expireSession()
        publish(NormalSyncNotice.LOGIN_REQUIRED)
    }
    override suspend fun revertLogin(mark: Long, accepted: () -> Boolean) = withContext(Dispatchers.IO) {
        if (!accepted() || engine.sessionGeneration() != mark) return@withContext
        observed?.cancel(); observed = null
        engine.logoutCommittedSession(mark); remoteLearners = null
        publish(NormalSyncNotice.SIGNED_OUT)
    }
    private suspend fun ensureOwnerContext() {
        visibility.refresh()
        val current = active.activeId.first()
        if (current != null && !visibility.allows(current)) selectBestLocalProfile()
        if (current == null) selectBestLocalProfile()
    }
    private suspend fun selectBestLocalProfile() {
        visibility.refresh()
        active.setActive(db.profiles().all().firstOrNull { visibility.allows(it.id) }?.id)
    }
    private suspend fun publish(notice: NormalSyncNotice? = null) {
        visibility.refresh()
        val b = engine.binding()
        val owner = engine.owner()
        val labels = db.profiles().all().associate { it.id to it.label }
        mutable.value = NormalSyncState(
            owner, engine.authenticated(), remoteLearners?.takeIf { it.first == owner }?.second ?: engine.knownLearners(), labels,
            b?.learner, b?.enabled == true, engine.pendingCount(), b?.remote?.count { it.registryStatus == "registered" } ?: 0,
            busy = false,
            notice = notice ?: if (owner == null) NormalSyncNotice.SIGNED_OUT else if (!engine.authenticated()) NormalSyncNotice.LOGIN_REQUIRED else mutable.value.notice,
        )
    }
    private suspend fun proofs(): Map<String, PackProof> {
        val catalog = ContentJson.json.decodeFromString(ContentCatalog.serializer(), assets.read(ContentRepository.CATALOG))
        return content.tracks().filter { loaded -> loaded.pack.items.any { it.reviewStatus == ReviewStatus.APPROVED } }.associate { loaded ->
            val entry = catalog.tracks.single { it.track == loaded.track }
            loaded.track to PackProof.fromBytes(assets.read(entry.pack).encodeToByteArray(), assets.read(entry.rules).encodeToByteArray(), config.registrySourceCommit)
        }.also { require(it.isNotEmpty()) { "No approved native tracks configured" } }
    }
    fun stop() { observed?.cancel(); scope.cancel(); engine.expireSession(); visibility.close() }
    private fun SyncResult.notice() = when (this) {
        SyncResult.SYNCED -> NormalSyncNotice.SYNCED
        SyncResult.OFFLINE -> NormalSyncNotice.OFFLINE
        SyncResult.CONSENT_OFF -> NormalSyncNotice.DISABLED
        SyncResult.CONSENT_UPDATE_REQUIRED -> NormalSyncNotice.CONSENT_UPDATE_REQUIRED
        SyncResult.FRESH_AUTH_REQUIRED -> NormalSyncNotice.FRESH_AUTH_REQUIRED
        SyncResult.LOGIN_REQUIRED -> NormalSyncNotice.LOGIN_REQUIRED
        SyncResult.BLOCKED, SyncResult.SESSION_CHANGED -> NormalSyncNotice.FAILED
    }
}
