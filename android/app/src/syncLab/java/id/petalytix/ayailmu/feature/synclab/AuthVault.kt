package id.petalytix.ayailmu.feature.synclab

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
internal data class SavedAuth(val session: AuthSession, val expiresAtMs: Long, val savedAtMs: Long) {
    override fun toString() = "SavedAuth(redacted)"
}
internal interface AuthVault {
    fun read(): SavedAuth?
    fun write(value: SavedAuth?)
}

/** Tink AEAD protects the persisted provider session inside no-backup storage.
 * The production key lives in Android Keystore (no plaintext keyset, no backup);
 * tests inject a software AEAD so the same file contract runs on the JVM. */
@Singleton
internal class KeystoreAuthVault private constructor(
    private val file: File,
    aeadSource: () -> Aead,
) : AuthVault {
    @Inject constructor(@ApplicationContext context: Context) : this(
        File(context.noBackupFilesDir, "gotrue-auth/session.enc"),
        { AndroidKeystoreKmsClient.getOrGenerateNewAeadKey(KEY_URI) },
    )
    internal constructor(context: Context, aead: Aead) : this(
        File(context.noBackupFilesDir, "gotrue-auth/session.enc"),
        { aead },
    )

    private val aead by lazy(aeadSource)
    private val associated = "umar-synclab-gotrue-session-v1".encodeToByteArray()
    private val json = Json

    @Synchronized override fun read(): SavedAuth? {
        if (!file.exists()) return null
        require(file.length() <= 65_536)
        return try {
            json.decodeFromString<SavedAuth>(aead.decrypt(file.readBytes(), associated).decodeToString())
        } catch (e: GeneralSecurityException) {
            check(!file.exists() || file.delete())
            null
        }
    }
    @Synchronized override fun write(value: SavedAuth?) {
        if (value == null) { check(!file.exists() || file.delete()); return }
        val encrypted = aead.encrypt(json.encodeToString(SavedAuth.serializer(), value).encodeToByteArray(), associated)
        val parent = requireNotNull(file.parentFile); check(parent.exists() || parent.mkdirs())
        val temp = File(parent, "session.pending")
        FileOutputStream(temp).use { it.write(encrypted); it.fd.sync() }
        temp.setReadable(false, false); temp.setReadable(true, true); temp.setWritable(false, false); temp.setWritable(true, true)
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
    companion object {
        private const val KEY_URI = "android-keystore://umar_synclab_gotrue_session_v1"
    }
}
