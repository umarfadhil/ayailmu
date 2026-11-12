package id.petalytix.ayailmu.feature.account

import android.content.Context
import android.system.Os
import android.system.OsConstants
import com.google.crypto.tink.Aead
import com.google.crypto.tink.integration.android.AndroidKeystoreKmsClient
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.core.sync.AuthSession
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
internal data class SavedNormalAuth(val session: AuthSession, val expiresAtMs: Long, val savedAtMs: Long, val environmentId: String) {
    override fun toString() = "SavedNormalAuth(redacted)"
}
internal interface NormalAuthVault {
    fun read(): SavedNormalAuth?
    fun write(value: SavedNormalAuth?)
}

/** Normal-account-only Tink AEAD vault; Android Keystore holds the key and no-backup storage holds ciphertext. */
@Singleton
internal class KeystoreNormalAuthVault private constructor(private val file: File, private val environmentId: String, aeadSource: () -> Aead, private val syncDirectory: (File) -> Unit = ::syncNativeDirectory) : NormalAuthVault, NormalMailStore, NormalAccountErasureVault {
    @Inject constructor(@ApplicationContext context: Context, config: NormalAccountConfig) : this(
        File(context.noBackupFilesDir, "normal-owner-auth/${config.environmentHash}/session.enc"),
        config.publicOrigin,
        { AndroidKeystoreKmsClient.getOrGenerateNewAeadKey("android-keystore://ayailmu_normal_${config.environmentHash}") },
    )
    internal constructor(context: Context, aead: Aead, config: NormalAccountConfig, syncDirectory: (File) -> Unit = ::syncNativeDirectory) : this(File(context.noBackupFilesDir, "normal-owner-auth/${config.environmentHash}/session.enc"), config.publicOrigin, { aead }, syncDirectory)
    private val aead by lazy(aeadSource)
    private val associated = ("ayailmu-normal-gotrue-session-v1:" + environmentId).encodeToByteArray()
    private val mailFile get() = File(file.parentFile, "mail-operation.enc")
    private val mailAssociated = ("ayailmu-normal-mail-operation-v1:" + environmentId).encodeToByteArray()
    private val erasureFile get() = File(file.parentFile, "account-erasure.enc")
    private val erasureAssociated = ("ayailmu-normal-account-erasure-v1:" + environmentId).encodeToByteArray()
    @Synchronized override fun readErasures(): List<SavedAccountErasure> {
        if (!erasureFile.exists()) return emptyList()
        check(erasureFile.length() <= 65_536)
        // Unlike session cleanup, a corrupt proof is never discarded or silently replaced.
        return Json.decodeFromString<List<SavedAccountErasure>>(aead.decrypt(erasureFile.readBytes(), erasureAssociated).decodeToString()).also(::validateErasures)
    }
    private fun validateErasures(records: List<SavedAccountErasure>) {
        check(records.size <= 16 && records.map { it.owner }.toSet().size == records.size && records.map { it.request }.toSet().size == records.size)
        records.forEach { it.requireValid(environmentId) }
    }
    @Synchronized override fun updateErasures(transform: (List<SavedAccountErasure>) -> List<SavedAccountErasure>): List<SavedAccountErasure> {
        val next = transform(readErasures()).also(::validateErasures)
        val plaintext = Json.encodeToString(kotlinx.serialization.builtins.ListSerializer(SavedAccountErasure.serializer()), next).encodeToByteArray()
        check(plaintext.size <= 60_000)
        val encrypted = aead.encrypt(plaintext, erasureAssociated)
        val parent = requireNotNull(erasureFile.parentFile); check(parent.exists() || parent.mkdirs())
        val temp = File(parent, "account-erasure.pending")
        FileOutputStream(temp).use { it.write(encrypted); it.fd.sync() }
        temp.setReadable(false, false); temp.setReadable(true, true); temp.setWritable(false, false); temp.setWritable(true, true)
        Files.move(temp.toPath(), erasureFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        // Persist the rename and any newly created origin/namespace directory entries before destructive I/O.
        for (directory in listOf(parent, requireNotNull(parent.parentFile), requireNotNull(parent.parentFile?.parentFile))) {
            syncDirectory(directory)
        }
        return next
    }
    @Synchronized override fun readMail(): SavedMailOperation? {
        if (!mailFile.exists()) return null
        check(mailFile.length() <= 16_384)
        // Corruption stays closed; never delete an uncertain operation to enable a resend.
        return Json.decodeFromString<SavedMailOperation>(aead.decrypt(mailFile.readBytes(), mailAssociated).decodeToString()).also { check(it.environment == environmentId) }
    }
    @Synchronized override fun writeMail(value: SavedMailOperation?) {
        if (value == null) { check(!mailFile.exists() || mailFile.delete()); return }
        val encrypted = aead.encrypt(Json.encodeToString(SavedMailOperation.serializer(), value).encodeToByteArray(), mailAssociated)
        val parent = requireNotNull(mailFile.parentFile); check(parent.exists() || parent.mkdirs())
        val temp = File(parent, "mail-operation.pending")
        FileOutputStream(temp).use { it.write(encrypted); it.fd.sync() }
        temp.setReadable(false, false); temp.setReadable(true, true); temp.setWritable(false, false); temp.setWritable(true, true)
        Files.move(temp.toPath(), mailFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
    @Synchronized override fun read(): SavedNormalAuth? {
        if (!file.exists()) return null
        require(file.length() <= 65_536)
        return try {
            Json.decodeFromString<SavedNormalAuth>(aead.decrypt(file.readBytes(), associated).decodeToString()).also { check(it.environmentId == environmentId) }
        } catch (e: GeneralSecurityException) {
            check(!file.exists() || file.delete()); null
        }
    }
    @Synchronized override fun write(value: SavedNormalAuth?) {
        if (value == null) { check(!file.exists() || file.delete()); return }
        val encrypted = aead.encrypt(Json.encodeToString(SavedNormalAuth.serializer(), value).encodeToByteArray(), associated)
        val parent = requireNotNull(file.parentFile); check(parent.exists() || parent.mkdirs())
        val temp = File(parent, "session.pending")
        FileOutputStream(temp).use { it.write(encrypted); it.fd.sync() }
        temp.setReadable(false, false); temp.setReadable(true, true); temp.setWritable(false, false); temp.setWritable(true, true)
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}

/** Android's public POSIX API opens directories read-only; every error fails the destructive request closed. */
private fun syncNativeDirectory(directory: File) {
    val descriptor = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0)
    try { check(OsConstants.S_ISDIR(Os.fstat(descriptor).st_mode)); Os.fsync(descriptor) } finally { Os.close(descriptor) }
}
