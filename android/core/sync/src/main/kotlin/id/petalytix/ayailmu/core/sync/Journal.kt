package id.petalytix.ayailmu.core.sync

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class Captured(val payload: String, val acknowledgedSequence: Long? = null)
@Serializable
data class Binding(
    val learner: Learner,
    val proof: PackProof,
    /** All approved native tracks enrolled for this binding; [proof] remains the lab-compatible primary proof. */
    val proofs: Map<String, PackProof> = emptyMap(),
    val enabled: Boolean = false,
    val withdrawalPending: Boolean = false,
    val consentRevision: Long = 0,
    val ignored: Set<String> = emptySet(),
    val local: Map<String, Captured> = emptyMap(),
    val remote: List<RemoteRecord> = emptyList(),
    val cursor: Long = 0,
)
/**
 * An owner's profile-create request that may already have reached the server. It is recorded durably before the
 * POST and never changes, so every retry (even after a restart or sign-out) replays the same request, which the
 * backend answers idempotently per owner and client learner id. It holds no token, password or label.
 */
@Serializable
data class PendingCreate(val clientLearnerId: String, val kind: String, val lang: String)
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class JournalSnapshot(
    val schemaVersion: Int = 1,
    val activeOwner: String? = null,
    val activeLearner: String? = null,
    val owners: Map<String, Map<String, Binding>> = emptyMap(),
    /** At most one unresolved create per owner. Omitted from the file while empty, so old snapshots stay byte-compatible. */
    @EncodeDefault(EncodeDefault.Mode.NEVER) val pendingCreates: Map<String, PendingCreate> = emptyMap(),
) {
    /** Unknown or malformed pending data is never repaired or discarded; reading fails closed instead. */
    internal fun requireValid() {
        require(schemaVersion == 1) { "Unknown journal schema" }
        for ((owner, pending) in pendingCreates) {
            require(OWNER_ID.matches(owner)) { "Malformed pending create owner" }
            require(
                CLIENT_LEARNER_ID.matches(pending.clientLearnerId) && !pending.clientLearnerId.startsWith("syn_") &&
                    pending.kind == "ADULT" && pending.lang in setOf("id", "en"),
            ) { "Malformed pending create" }
        }
    }
}
interface JournalStore {
    fun read(): JournalSnapshot
    fun update(transform: (JournalSnapshot) -> JournalSnapshot): JournalSnapshot
}
class MemoryJournal : JournalStore {
    private var value = JournalSnapshot()
    @Synchronized override fun read() = value
    @Synchronized override fun update(transform: (JournalSnapshot) -> JournalSnapshot): JournalSnapshot = transform(value).also { value = it }
}

/** One app-scoped instance per file. Corruption fails closed; it never resets a pending outbox. */
class FileJournal(private val file: File) : JournalStore {
    private val json = Json { encodeDefaults = true }
    @Synchronized override fun read(): JournalSnapshot {
        if (!file.exists()) return JournalSnapshot()
        return json.decodeFromString<JournalSnapshot>(file.readText()).also { it.requireValid() }
    }
    @Synchronized override fun update(transform: (JournalSnapshot) -> JournalSnapshot): JournalSnapshot {
        val next = transform(read())
        val parent = requireNotNull(file.absoluteFile.parentFile)
        check(parent.exists() || parent.mkdirs()) { "Cannot create journal directory" }
        val temp = File(parent, file.name + ".pending")
        FileOutputStream(temp).use { out -> out.write(json.encodeToString(JournalSnapshot.serializer(), next).encodeToByteArray()); out.fd.sync() }
        temp.setReadable(false, false); temp.setReadable(true, true); temp.setWritable(false, false); temp.setWritable(true, true)
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        return next
    }
}
