package id.petalytix.ayailmu.feature.account

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import androidx.room.withTransaction
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.repo.ProfileVisibility
import id.petalytix.ayailmu.core.data.repo.ProfileOwnership
import id.petalytix.ayailmu.core.sync.FileJournal
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Immutable cached owner/environment + Room ancestry index. No disk/DB work occurs in [allows]. */
@Singleton
internal class NormalProfileVisibility @Inject constructor(
    @ApplicationContext context: Context,
    private val config: NormalAccountConfig,
    private val db: AyaDatabase?,
) : ProfileVisibility {
    private data class Bound(val environment: String, val owner: String)
    private data class Snapshot(val ready: Boolean, val activeOwner: String?, val bindings: Map<String, Bound>, val parents: Map<String, String?>)
    private val root = File(context.noBackupFilesDir, "normal-owner-sync")
    private val revision = MutableStateFlow(0)
    private val refreshMutex = Mutex()
    @Volatile private var snapshot = Snapshot(false, null, emptyMap(), emptyMap())
    override val changes: Flow<Unit> get() = revision.map { Unit }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    init {
        scope.launch { refresh() }
        if (db != null) scope.launch {
            combine(db.ownerBindings().observeAll(), db.profiles().observeAll()) { bindings, profiles -> bindings.size to profiles.size }
                .collect { refresh() }
        }
    }

    override fun ownership(profileId: String): ProfileOwnership? {
        val current = snapshot
        if (!current.ready) return null
        return resolve(current, profileId)?.let { ProfileOwnership(it.environment, it.owner) }
    }
    override fun allows(profileId: String): Boolean {
        val current = snapshot
        if (!current.ready) return false
        val bound = resolve(current, profileId) ?: return db == null || current.parents.containsKey(profileId)
        return config.enabled && bound.environment == config.environmentHash && bound.owner == current.activeOwner
    }
    private fun resolve(current: Snapshot, profileId: String): Bound? {
        var id: String? = profileId
        val seen = mutableSetOf<String>()
        while (id != null && seen.add(id)) {
            current.bindings[id]?.let { return it }
            id = current.parents[id]
        }
        return null
    }

    suspend fun refresh() = withContext(Dispatchers.IO) {
        refreshMutex.withLock {
        val next = runCatching {
            val bindings = mutableMapOf<String, Bound>()
            var activeOwner: String? = null
            // Read profile + binding rows atomically so a concurrent insert cannot look temporarily unbound.
            val (roomBindings, parents) = db?.withTransaction {
                db.ownerBindings().all() to db.profiles().all().associate { it.id to it.createdBy }
            } ?: (emptyList<id.petalytix.ayailmu.core.data.db.OwnerBindingEntity>() to emptyMap())
            roomBindings.forEach { bindings[it.profileId] = Bound(it.environmentId, it.ownerId) }
            val journals = root.listFiles()?.filter { it.isDirectory }.orEmpty().sortedBy { it.name }
            for (directory in journals) {
                val file = File(directory, "journal.json")
                if (!file.isFile) continue
                val state = FileJournal(file).read()
                for ((owner, ownerBindings) in state.owners) {
                    for (binding in ownerBindings.values) {
                        val profileId = binding.learner.clientLearnerId
                        val value = Bound(directory.name, owner)
                        check(bindings.put(profileId, value).let { it == null || it == value }) { "Conflicting profile environment binding" }
                    }
                }
                if (directory.name == config.environmentHash && config.enabled) activeOwner = state.activeOwner
            }
            Snapshot(true, activeOwner, bindings.toMap(), parents)
        }.getOrElse { Snapshot(false, null, emptyMap(), emptyMap()) }
        snapshot = next
        revision.value++
        }
    }
    /** Drain the initial refresh and Room collectors before their database is closed. */
    suspend fun close() { scope.coroutineContext.job.cancelAndJoin() }
}
