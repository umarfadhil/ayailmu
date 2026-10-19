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
    private val engine = SyncEngine(api, FileJournal(File(context.noBackupFilesDir, "synthetic-sync/journal.json")))
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var observed: Job? = null
    private var remoteLearners: Pair<String, List<Learner>>? = null
    private val publishLock = Mutex()
    private val mutable = MutableStateFlow(SyncLabState())
    val state = mutable.asStateFlow()
    private val proof by lazy {
        PackProof.fromBytes(assets.read("packs/bahasa/arab/v1.json").encodeToByteArray(), assets.read("config/rules.arab.json").encodeToByteArray(), SOURCE_COMMIT)
    }
    init {
        scope.launch {
            try { engine.binding()?.let { ensureNative(it.learner); observe(it.learner) }; publish() }
            catch (e: Exception) { if (e is CancellationException) throw e; mutable.value = SyncLabState(notice = R.string.sync_lab_blocked) }
        }
    }
    suspend fun login(token: String) = withContext(Dispatchers.IO) {
        val owner = engine.login(token)
        remoteLearners = null
        publish(R.string.sync_lab_saved)
        val withdrawn = engine.flushWithdrawals()
        if (withdrawn != SyncResult.SYNCED) { publish(notice(withdrawn)); return@withContext }
        remoteLearners = owner to engine.availableLearners()
        engine.binding()?.let { ensureNative(it.learner); observe(it.learner) }
        publish()
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
    suspend fun select(learner: Learner) = withContext(Dispatchers.IO) {
        if (engine.authenticated()) engine.select(learner, proof) else engine.selectKnown(learner.id)
        ensureNative(learner)
        observe(learner)
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
    suspend fun logout() = withContext(Dispatchers.IO) {
        observed?.cancel(); observed = null
        engine.logout(); remoteLearners = null; active.setActive(null)
        publish(R.string.sync_lab_signed_out)
    }
    suspend fun failed(error: Exception? = null) = withContext(Dispatchers.IO) {
        if (error is CancellationException) throw error
        if (error is ApiFailure && (error.status == 401 || error.code == "fresh_authentication_required")) engine.expireSession()
        publish(if (!engine.authenticated() && engine.owner() != null) R.string.sync_lab_login_required else R.string.sync_lab_failed)
    }
    suspend fun prepareLearning(): Boolean = withContext(Dispatchers.IO) {
        val learner = requireNotNull(engine.binding()).learner
        ensureNative(learner)
        db.profiles().get(learner.clientLearnerId)?.consentVersion != id.petalytix.ayailmu.feature.consent.Consent.VERSION
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
        active.setActive(learner.clientLearnerId)
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
    private suspend fun publish(message: Int? = null) = publishLock.withLock {
        val binding = engine.binding()
        val owner = engine.owner()
        val loaded = if (binding != null) content.track("arab") else null
        val projection = if (binding != null && loaded != null) SyncedProgress.project(binding, proof, loaded.rules, loaded.content) else null
        val learners = remoteLearners?.takeIf { it.first == owner }?.second ?: engine.knownLearners()
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
