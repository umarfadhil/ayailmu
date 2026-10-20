package id.petalytix.ayailmu.feature.synclab

import android.content.Context
import androidx.room.withTransaction
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.SkillProjector
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.sync.*
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class SyncLabState(
    val owner: String? = null,
    val authenticated: Boolean = false,
    val learners: List<Learner> = emptyList(),
    val selected: Learner? = null,
    val enabled: Boolean = false,
    val withdrawalPending: Boolean = false,
    val pending: Int = 0,
    val remoteAnswers: Int = 0,
    val learnedSkills: Int = 0,
    val notice: Int = R.string.sync_lab_signed_out,
    val busy: Boolean = false,
)

/** What the native learning entry-point decided; [NOT_READY] must never navigate into a session. */
internal enum class LearningReadiness { READY, CONSENT_NEEDED, NOT_READY }

/** A singleton owns the only writer of the lab journal; ordinary app profile databases are a different app ID. */
@Singleton
internal class SyncLabRepository @Inject constructor(
    @ApplicationContext context: Context,
    private val db: AyaDatabase,
    private val active: ActiveProfileStore,
    private val assets: AssetSource,
    private val content: ContentRepository,
    private val clock: Clock,
    api: Backend,
) {
    private val engine = SyncEngine(api, FileJournal(File(context.noBackupFilesDir, "synthetic-gotrue-sync/journal.json")))
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var observed: Job? = null
    private var remoteLearners: Pair<String, List<Learner>>? = null
    private val publishLock = Mutex()
    /** Test-only publication coordinator: invoked under [publishLock] before each applied state mutation. */
    internal var publishProbe: (suspend (Int?) -> Unit)? = null
    /** Local activation/cleanup ordering boundary: held only across Room/DataStore/file work, never across network. */
    private val localLock = Mutex()
    private val mutable = MutableStateFlow(SyncLabState())
    val state = mutable.asStateFlow()
    private val proof by lazy {
        PackProof.fromBytes(assets.read("packs/bahasa/arab/v1.json").encodeToByteArray(), assets.read("config/rules.arab.json").encodeToByteArray(), SOURCE_COMMIT)
    }
    init {
        scope.launch {
            try {
                engine.binding()?.let { activateLocally(it.learner, observe = true) }
                publish()
            }
            catch (e: Exception) { if (e is CancellationException) throw e; mutable.value = SyncLabState(notice = R.string.sync_lab_blocked) }
        }
    }
    suspend fun login(token: String, accepted: () -> Boolean = { true }) = withContext(Dispatchers.IO) {
        val owner = engine.login(token, accepted)
        finishLogin(owner, accepted)
    }
    fun savedOwner(): String? = engine.owner()
    /** An opaque marker of the engine's session attempt; login/refresh/logout supersede it. */
    fun sessionMark(): Long = engine.sessionMark()
    suspend fun resume(token: String, accepted: () -> Boolean = { true }) = withContext(Dispatchers.IO) {
        engine.resume(token, accepted)
        finishLogin(requireNotNull(engine.owner()), accepted)
    }
    private fun ownerCurrent(owner: String, accepted: () -> Boolean): Boolean =
        accepted() && engine.authenticated() && engine.owner() == owner
    /** Native activation and observers start only for the owner that is still current after each suspension. */
    private suspend fun finishLogin(owner: String, accepted: () -> Boolean) {
        remoteLearners = null
        publish(R.string.sync_lab_saved)
        val withdrawn = engine.flushWithdrawals()
        if (withdrawn != SyncResult.SYNCED) { publish(notice(withdrawn)); return }
        if (!ownerCurrent(owner, accepted)) return
        // The engine commit is established; a transient learner-load failure is recoverable and
        // must not discard the just-installed session (the queue/profile stay local).
        remoteLearners = try {
            owner to engine.availableLearners()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            // A newer account may have signed in while the load was parked; the failure notice is
            // bound to this owner and re-checked under publishLock at the actual state mutation
            // (see publish), so a stale failure can never be committed over a newer account.
            if (ownerCurrent(owner, accepted)) {
                publish(if (e is IOException) R.string.sync_lab_offline else R.string.sync_lab_failed, owner, accepted)
            }
            return
        }
        if (!ownerCurrent(owner, accepted)) return
        val binding = engine.binding() ?: run { publish(); return }
        if (!ownerCurrent(owner, accepted) || engine.binding()?.learner?.id != binding.learner.id) return
        activateLocally(binding.learner, observe = true)
        publish()
    }
    /**
     * Activates a learner locally (Room profile, active-profile store, payload observer) under the
     * local ordering boundary. Re-verifies the durable owner/binding after acquiring the boundary and
     * again after the suspending active-store write, so an owner change that completed during local
     * storage is undone before the boundary is released; an active-store failure fails closed (no
     * observation, no success reported). Never touches network under the boundary.
     */
    private suspend fun activateLocally(learner: Learner, observe: Boolean): Boolean = localLock.withLock {
        fun current() = engine.owner() != null && engine.binding()?.learner?.id == learner.id
        if (!current()) return@withLock false
        ensureNative(learner)
        if (!current()) return@withLock false
        try {
            active.setActive(learner.clientLearnerId)
        } catch (e: Exception) {
            return@withLock false
        }
        if (!current()) {
            runCatching { active.setActive(null) }
            return@withLock false
        }
        if (observe) this.observe(learner)
        true
    }
    suspend fun refresh() = withContext(Dispatchers.IO) {
        val owner = requireNotNull(engine.owner())
        remoteLearners = owner to engine.availableLearners()
        publish(R.string.sync_lab_saved)
    }
    suspend fun create() = withContext(Dispatchers.IO) {
        val learner = engine.createSyntheticLearner()
        select(learner)
        remoteLearners = requireNotNull(engine.owner()) to engine.availableLearners()
        publish(R.string.sync_lab_saved)
    }
    private fun selectionCurrent(owner: String?, learnerId: String, accepted: () -> Boolean): Boolean =
        accepted() && engine.owner() == owner && engine.binding()?.learner?.id == learnerId
    suspend fun select(learner: Learner, accepted: () -> Boolean = { true }) = withContext(Dispatchers.IO) {
        val owner = engine.owner()
        if (engine.authenticated()) engine.select(learner, proof) else engine.selectKnown(learner.id)
        if (!selectionCurrent(owner, learner.id, accepted)) { publish(); return@withContext }
        activateLocally(learner, observe = true)
        publish(R.string.sync_lab_saved)
    }
    suspend fun enable() = withContext(Dispatchers.IO) {
        val learner = requireNotNull(engine.binding()).learner
        val existing = db.answers().payloads(learner.clientLearnerId).map { ContentJson.json.decodeFromString(AnswerEvent.serializer(), it).answerId }
        engine.enable(existing)
        publish(R.string.sync_lab_enabled)
    }
    suspend fun disable() = withContext(Dispatchers.IO) {
        engine.disable()
        publish(if (engine.binding()?.withdrawalPending == true) R.string.sync_lab_withdraw_pending else R.string.sync_lab_disabled)
    }
    suspend fun sync() = withContext(Dispatchers.IO) {
        engine.binding()?.let { engine.capture(db.answers().payloads(it.learner.clientLearnerId), it.learner.id) }
        val withdrawal = engine.flushWithdrawals()
        val result = if (withdrawal == SyncResult.SYNCED) engine.sync() else withdrawal
        publish(notice(result))
    }
    /**
     * Local sign-out under the ordering boundary: cancels observation, drops the durable
     * owner/session and clears the active profile. Each cleanup step is independent — a failing
     * journal or active-profile store cannot block another component's cleanup. Runs only while
     * [accepted] holds, so a superseded logout never erases a newer account. Provider logout
     * stays outside (network).
     */
    suspend fun logout(accepted: () -> Boolean = { true }): Boolean = withContext(Dispatchers.IO) {
        var committed = false
        localLock.withLock {
            if (!accepted()) return@withLock
            committed = true
            observed?.cancel(); observed = null
            runCatching { engine.logout() }
            runCatching { active.setActive(null) }
            remoteLearners = null
        }
        if (committed) runCatching { publish(R.string.sync_lab_signed_out) }
        committed
    }
    /** Drops an in-memory session (e.g. after a failed credential installation) and republishes. */
    suspend fun expireSession(accepted: () -> Boolean = { true }) = withContext(Dispatchers.IO) {
        if (accepted()) engine.expireSession()
        publish()
    }
    /**
     * Reflects an ordinary-action failure in the owner-scoped UI state. The 401 expiry only runs
     * while [accepted] holds at the actual mutation, and a superseded failure never publishes over
     * a newer account — callers bind [accepted] to the originating operation/session.
     */
    suspend fun failed(error: Exception? = null, accepted: () -> Boolean = { true }) = withContext(Dispatchers.IO) {
        if (error is CancellationException) throw error
        if (!accepted()) return@withContext
        if (error is ApiFailure && (error.status == 401 || error.code == "fresh_authentication_required")) engine.expireSession()
        publish(if (!engine.authenticated() && engine.owner() != null) R.string.sync_lab_login_required else R.string.sync_lab_failed)
    }
    suspend fun prepareLearning(): LearningReadiness = withContext(Dispatchers.IO) {
        val learner = engine.binding()?.learner ?: return@withContext LearningReadiness.NOT_READY
        // A failed local activation must never report "consent already granted": the caller would
        // open native learning under whatever profile was previously active.
        if (!activateLocally(learner, observe = false)) return@withContext LearningReadiness.NOT_READY
        if (db.profiles().get(learner.clientLearnerId)?.consentVersion != id.petalytix.ayailmu.feature.consent.Consent.VERSION)
            LearningReadiness.CONSENT_NEEDED else LearningReadiness.READY
    }
    private suspend fun ensureNative(learner: Learner) {
        require(learner.kind == "ADULT" && learner.clientLearnerId.startsWith("syn_"))
        db.withTransaction {
            val existing = db.profiles().get(learner.clientLearnerId)
            if (existing == null) {
                db.profiles().upsert(ProfileEntity(
                    id = learner.clientLearnerId, label = SYNTHETIC_LABEL, kind = "ADULT", createdBy = null,
                    birthYear = 1980, audience = "ADULTS", instructionLang = "id", createdAt = clock.now().toEpochMilli(),
                    sessionMinutes = null, arabicScale = 1f, screensSeen = "[]", consentVersion = null, consentAt = null,
                ))
            } else require(existing.label == SYNTHETIC_LABEL && existing.kind == "ADULT" && existing.birthYear == 1980) { "Not a synthetic lab profile" }
        }
    }
    private fun observe(learner: Learner) {
        observed?.cancel()
        observed = scope.launch {
            db.answers().observePayloads(learner.clientLearnerId).collect { payloads ->
                try { engine.capture(payloads, learner.id); publish() }
                catch (e: Exception) { if (e is CancellationException) throw e; if (engine.binding()?.learner?.id == learner.id) publish(R.string.sync_lab_blocked) }
            }
        }
    }
    private suspend fun publish(
        message: Int? = null,
        origin: String? = null,
        accepted: (() -> Boolean)? = null,
    ) = publishLock.withLock {
        publishProbe?.invoke(message)
        val binding = engine.binding()
        val owner = engine.owner()
        val loaded = if (binding != null) content.track("arab") else null
        val projection = if (binding != null && loaded != null) SyncedProgress.project(binding, proof, loaded.rules, loaded.content) else null
        val learners = remoteLearners?.takeIf { it.first == owner }?.second ?: engine.knownLearners()
        // A notice bound to an originating owner is dropped unless that owner is still current at
        // the actual state mutation; every suspension above can outlive the pre-check that
        // authorised this publish, and a newer account may have taken over meanwhile.
        if (origin != null && !ownerCurrent(origin, accepted ?: { true })) return@withLock
        if (engine.owner() != owner || engine.binding()?.learner?.id != binding?.learner?.id) return@withLock
        mutable.value = SyncLabState(
            owner = owner, authenticated = engine.authenticated(), learners = learners, selected = binding?.learner,
            enabled = binding?.enabled == true, withdrawalPending = binding?.withdrawalPending == true,
            pending = engine.pendingCount(), remoteAnswers = engine.history().count { it.registryStatus == "registered" },
            learnedSkills = projection?.skills?.values?.count { it.status == SkillProjector.Status.LEARNED } ?: 0,
            notice = message ?: if (owner == null) R.string.sync_lab_signed_out else if (!engine.authenticated()) R.string.sync_lab_login_required else mutable.value.notice,
        )
    }
    private fun notice(result: SyncResult) = when (result) {
        SyncResult.SYNCED -> R.string.sync_lab_synced
        SyncResult.OFFLINE -> R.string.sync_lab_offline
        SyncResult.CONSENT_OFF -> R.string.sync_lab_disabled
        SyncResult.LOGIN_REQUIRED -> R.string.sync_lab_login_required
        SyncResult.BLOCKED -> R.string.sync_lab_blocked
        SyncResult.SESSION_CHANGED -> R.string.sync_lab_changed
    }
    fun stop() { observed?.cancel(); scope.cancel(); engine.expireSession() }
    companion object {
        const val SOURCE_COMMIT = "815e30f0da284b9818fadc0143f4da92544384d3"
        private const val SYNTHETIC_LABEL = "SYNTHETIC TEST LEARNER"
    }
}
