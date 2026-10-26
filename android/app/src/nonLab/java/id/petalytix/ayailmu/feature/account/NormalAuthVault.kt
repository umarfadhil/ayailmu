package id.petalytix.ayailmu.feature.account

import android.content.Context
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
internal class KeystoreNormalAuthVault private constructor(private val file: File, private val environmentId: String, aeadSource: () -> Aead) : NormalAuthVault {
    @Inject constructor(@ApplicationContext context: Context, config: NormalAccountConfig) : this(
        File(context.noBackupFilesDir, "normal-owner-auth/${config.environmentHash}/session.enc"),
        config.publicOrigin,
        { AndroidKeystoreKmsClient.getOrGenerateNewAeadKey("android-keystore://ayailmu_normal_${config.environmentHash}") },
    )
    internal constructor(context: Context, aead: Aead, config: NormalAccountConfig) : this(File(context.noBackupFilesDir, "normal-owner-auth/${config.environmentHash}/session.enc"), config.publicOrigin, { aead })
    private val aead by lazy(aeadSource)
    private val associated = ("ayailmu-normal-gotrue-session-v1:" + environmentId).encodeToByteArray()
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
