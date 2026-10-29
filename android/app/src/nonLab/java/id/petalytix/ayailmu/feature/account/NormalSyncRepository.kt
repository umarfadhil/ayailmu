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
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal enum class NormalSyncNotice { SIGNED_OUT, READY, OFFLINE, LOGIN_REQUIRED, FRESH_AUTH_REQUIRED, SYNCED, DISABLED, CONSENT_UPDATE_REQUIRED, NO_APPROVED_CONTENT, CONTENT_MISMATCH, CREATE_PENDING_LANGUAGE, FAILED }
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
    /** An earlier profile creation may have reached the server; creating again retries that same request. */
    val pendingCreate: Boolean = false,
)

/** A create is refused before any remote mutation; raised so [NormalSyncRepository.failed] can report it truthfully. */
internal class NormalContentException(val notice: NormalSyncNotice, message: String) : IllegalStateException(message)

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
        refreshCurrentPendingCreate()
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
        val fetched = try { fetchLearnersFor(owner, accepted) } catch (e: Exception) {
            if (e is CancellationException) throw e
            publish(NormalSyncNotice.OFFLINE); return
        }
        // Stale (another owner/session took over while suspended): that attempt publishes its own state.
        if (fetched == null) return
        remoteLearners = owner to fetched
        engine.binding()?.let { if (accepted() && engine.owner() == owner) activate(it.learner, true) }
        publish(if (engine.authenticated()) NormalSyncNotice.READY else NormalSyncNotice.LOGIN_REQUIRED)
    }

    suspend fun createAdult(label: String, lang: String) {
        require(label.isNotBlank() && lang in setOf("id", "en"))
        val accepted = beginAction()
        actionMutex.withLock {
        if (!accepted()) return@withLock
        // Capture the publication context before the first suspension; selection's own commit advances the session.
        val owner = engine.owner()
        val mark = engine.sessionGeneration()
        try {
            // Anchor the create path to the creating owner and session before the first suspension.
            // A successful engine.select later advances the session generation, so this marker only
            // covers preflight, create and retention.
            if (owner == null || mark == null) throw ApiFailure(401, "unauthorized")
            val creating = { accepted() && engine.owner() == owner && engine.sessionGeneration() == mark }
            // A request left by an unfinished create is immutable: reject a different language before any I/O.
            engine.pendingCreate()?.let { if (it.lang != lang) throw pendingLanguageConflict(it) }
            // Read-only checks first: a remote learner must never be created for content that cannot be bound.
            val prepared = proofs()
            check(creating()) { "Sign-in session changed" }
            try { engine.preflightProofs(prepared) } catch (e: IllegalArgumentException) {
                throw NormalContentException(NormalSyncNotice.CONTENT_MISMATCH, e.message.orEmpty())
            }
            // Durable before the POST: a lost reply, crash or sign-out after transmission replays this same request.
            // If the write fails this throws and nothing has been sent. It is cleared only by engine.select's binding commit.
            val request = try { engine.reserveNormalAdultCreate(lang, { "lrn_" + UUID.randomUUID() }, creating) } catch (e: PendingCreateConflict) {
                throw pendingLanguageConflict(e.pending)
            }
            val clientId = request.clientLearnerId
            check(db.profiles().get(clientId) == null) { "Local profile already exists" }
            val learner = engine.createNormalAdultLearner(clientId, request.lang, creating)
            // The reply is known-successful, so cache this learner for the creating owner without network
            // I/O; if binding fails (even offline) a retry selects it instead of creating another.
            check(retainCreated(learner, owner, creating)) { "Sign-in session changed" }
            try { selectInternal(learner, label, accepted, owner, mark, prepared) } catch (e: Exception) {
                if (e !is CancellationException) refreshLearners(owner, accepted)
                throw e
            }
        } finally {
            if (accepted()) mutable.value = mutable.value.copy(busy = false)
            if (owner != null && mark != null) refreshPendingCreate(owner, mark, accepted)
        }
        }
    }
    /** Cancellation starts a new action context, so publish the still-current owner's durable flag in that context. */
    private fun refreshCurrentPendingCreate() {
        val owner = engine.owner() ?: return
        val mark = engine.sessionGeneration() ?: return
        refreshPendingCreate(owner, mark) { true }
    }
    /** Never let a suspended owner's result overwrite a newer owner/session/action's visible state. */
    private fun refreshPendingCreate(owner: String, mark: Long, accepted: () -> Boolean) {
        val pending = runCatching { engine.pendingCreate(owner) != null }.getOrNull() ?: return
        mutable.update { state ->
            if (state.owner == owner && accepted() && engine.owner() == owner && engine.sessionGeneration() == mark) {
                state.copy(pendingCreate = pending)
            } else state
        }
    }
    private fun pendingLanguageConflict(pending: PendingCreate) =
        NormalContentException(NormalSyncNotice.CREATE_PENDING_LANGUAGE, "A profile creation (${pending.lang}) is awaiting retry")
    suspend fun select(learner: Learner, newLabel: String? = null) {
        val accepted = beginAction()
        actionMutex.withLock {
            if (accepted()) try {
                // Anchor the selection to the owner and session current before the first suspension.
                val owner = engine.owner()
                val mark = engine.sessionGeneration()
                if (owner == null || mark == null) throw ApiFailure(401, "unauthorized")
                selectInternal(learner, newLabel, accepted, owner, mark)
            } finally { if (accepted()) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    /** [owner] and [mark] are the owner and engine session generation captured by the caller before its first suspension. */
    private suspend fun selectInternal(learner: Learner, newLabel: String?, accepted: () -> Boolean, owner: String, mark: Long, prepared: Map<String, PackProof>? = null) {
        val previous = engine.binding()?.learner?.id
        val known = engine.knownLearners().any { it.id == learner.id }
        if (!known) {
            val existing = db.profiles().get(learner.clientLearnerId)
            val owned = db.ownerBindings().all().firstOrNull { it.profileId == learner.clientLearnerId }
            if (owned != null) {
                check(owned.ownerId == owner && owned.environmentId == config.environmentHash) { "Room learner belongs to another owner/environment" }
            } else check(existing == null) { "Unbound device profiles cannot be attached" }
        }
        try {
            // The engine checks this just before it commits the selection, i.e. before it advances the generation.
            val selecting = { accepted() && engine.owner() == owner && engine.sessionGeneration() == mark }
            engine.select(learner, prepared ?: proofs(), selecting)
            if (!accepted()) { engine.rollbackNormalSelection(learner.id, previous); publish(); return }
            if (!activate(learner, true, newLabel, accepted)) { engine.rollbackNormalSelection(learner.id, previous); publish(); return }
            if (!accepted()) return
            val learners = fetchLearnersFor(owner, accepted)
            if (learners != null) remoteLearners = owner to learners
            else if (accepted()) throw IllegalStateException("Sign-in session changed")
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
                error is NormalContentException -> error.notice
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
        // Capture one owner/session/action snapshot before Room can suspend. The global mark covers attempt
        // changes; committedSession also covers a login/resume committing within an unchanged global attempt.
        val actionMark = synchronized(this) { actionGeneration }
        val sessionMark = engine.sessionMark()
        val committedSession = engine.sessionGeneration()
        val owner = engine.owner()
        val authenticated = engine.authenticated()
        val b = engine.binding()
        val pendingCreate = owner?.let { engine.pendingCreate(it) != null } == true
        val learners = remoteLearners?.takeIf { it.first == owner }?.second ?: engine.knownLearners()
        val pending = b?.local?.values?.count { it.acknowledgedSequence == null } ?: 0
        val restored = b?.remote?.count { it.registryStatus == "registered" } ?: 0
        visibility.refresh()
        val labels = db.profiles().all().associate { it.id to it.label }
        mutable.update { current ->
            val unchanged = synchronized(this) { actionGeneration == actionMark } &&
                engine.owner() == owner && engine.sessionMark() == sessionMark &&
                engine.sessionGeneration() == committedSession
            if (!unchanged) return@update current
            NormalSyncState(
                owner, authenticated, learners, labels,
                b?.learner, b?.enabled == true, pending, restored,
                busy = false,
                notice = notice ?: if (owner == null) NormalSyncNotice.SIGNED_OUT else if (!authenticated) NormalSyncNotice.LOGIN_REQUIRED else current.notice,
                pendingCreate = pendingCreate,
            )
        }
    }
    private suspend fun proofs(): Map<String, PackProof> {
        val catalog = ContentJson.json.decodeFromString(ContentCatalog.serializer(), assets.read(ContentRepository.CATALOG))
        return content.tracks().filter { loaded -> loaded.pack.items.any { it.reviewStatus == ReviewStatus.APPROVED } }.associate { loaded ->
            val entry = catalog.tracks.single { it.track == loaded.track }
            loaded.track to PackProof.fromBytes(assets.read(entry.pack).encodeToByteArray(), assets.read(entry.rules).encodeToByteArray(), config.registrySourceCommit)
        }.also { if (it.isEmpty()) throw NormalContentException(NormalSyncNotice.NO_APPROVED_CONTENT, "No approved native tracks configured") }
    }
    /**
     * Caches a learner from a known-successful create reply, keyed by the [owner] that created it (never a
     * freshly read owner), so a concurrent sign-in cannot attribute it to someone else. No network, and no
     * publish: the action stays busy until binding finishes and its own success/failure path publishes.
     * Returns false when the creating owner/session/action is no longer current.
     */
    private fun retainCreated(learner: Learner, owner: String, creating: () -> Boolean): Boolean {
        if (!creating()) return false
        val visible = remoteLearners?.takeIf { it.first == owner }?.second.orEmpty()
        remoteLearners = owner to (visible.filterNot { it.id == learner.id } + learner)
        return true
    }
    /**
     * Fetches the learner list for the fixed [owner] and returns it only if that owner's session was current for
     * the whole request, so a response is never attached to an owner merely read before or after an await.
     * Generations only increase, so the same generation before and after the fetch proves no sign-in, sign-out or
     * refresh intervened; the owner check then proves that session was [owner]'s. Returns null when stale (including
     * a failure raised after the context changed); throws cancellation, and what the fetch throws while the context is
     * still current (and a 401 if there is no session) so callers keep their error semantics.
     * Callers must store the result keyed by [owner] and nothing else.
     */
    private suspend fun fetchLearnersFor(owner: String, accepted: () -> Boolean): List<Learner>? {
        val mark = engine.sessionGeneration() ?: throw ApiFailure(401, "unauthorized")
        if (!accepted() || engine.owner() != owner) return null
        val current = { accepted() && engine.owner() == owner && engine.sessionGeneration() == mark }
        val learners = try { engine.availableLearners() } catch (e: Exception) {
            if (e is CancellationException) throw e
            // A failure raised because the session moved on belongs to the superseded attempt and is discarded.
            if (!current()) return null
            throw e
        }
        return learners.takeIf { current() }
    }
    /**
     * Failure path of [createAdult]: best-effort replacement of the cache with the server's list, then publish
     * so the retained learner is visible. Everything is keyed by the creating [owner].
     */
    private suspend fun refreshLearners(owner: String, accepted: () -> Boolean) {
        if (!accepted()) return
        try {
            fetchLearnersFor(owner, accepted)?.let { remoteLearners = owner to it }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
        }
        if (accepted() && engine.owner() == owner) publish()
    }
    /** Await owned background work before the caller releases Room or journal storage. */
    suspend fun stop() {
        cancelActions()
        scope.coroutineContext.job.cancelAndJoin()
        observed = null
        engine.expireSession()
        visibility.close()
    }
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
