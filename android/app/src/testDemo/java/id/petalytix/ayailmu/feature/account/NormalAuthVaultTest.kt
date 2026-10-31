package id.petalytix.ayailmu.feature.account

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.aead.AeadConfig
import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.AuthUser
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NormalAuthVaultTest {
    @Test fun mailMetadataIsEncryptedOriginBoundAndCorruptionStaysClosed() {
        AeadConfig.register()
        val aead = KeysetHandle.generateNew(KeyTemplates.get("AES128_GCM")).getPrimitive(Aead::class.java)
        val dir = File.createTempFile("mail-vault-fixture", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val a = NormalAccountConfig.forValues(true, "https://accounts-a.example.invalid", "owner-policy-1")
        val b = NormalAccountConfig.forValues(true, "https://accounts-b.example.invalid", "owner-policy-1")
        try {
            val vault = KeystoreNormalAuthVault(context, aead, a)
            val saved = SavedMailOperation("00000000-0000-0000-0000-000000000001", NormalMailAction.RECOVER, "one@example.invalid", "anonymous", a.publicOrigin, 1, 86_400_001, MailPhase.UNKNOWN)
            vault.writeMail(saved)
            assertEquals(saved, vault.readMail())
            val file = dir.walkTopDown().single { it.isFile && it.name == "mail-operation.enc" }
            assertFalse(file.readBytes().decodeToString().contains("one@example.invalid"))
            assertNull(KeystoreNormalAuthVault(context, aead, b).readMail())
            val corrupt = file.readBytes(); corrupt[0] = (corrupt[0].toInt() xor 1).toByte(); file.writeBytes(corrupt)
            assertTrue(runCatching { vault.readMail() }.isFailure)
            assertTrue(file.exists())
            assertTrue(runCatching { vault.readMail() }.isFailure)
            vault.writeMail(null)
            assertNull(vault.readMail())
        } finally { dir.deleteRecursively() }
    }
    @Test fun ciphertextIsBoundToOriginAndAnotherEnvironmentCannotRestoreIt() {
        AeadConfig.register()
        val aead = KeysetHandle.generateNew(KeyTemplates.get("AES128_GCM")).getPrimitive(Aead::class.java)
        val dir = File.createTempFile("normal-vault", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val a = NormalAccountConfig.forValues(true, "https://accounts-a.petalytix.id", "owner-policy-1")
        val b = NormalAccountConfig.forValues(true, "https://accounts-b.petalytix.id", "owner-policy-1")
        try {
            val vault = KeystoreNormalAuthVault(context, aead, a)
            val saved = SavedNormalAuth(AuthSession("opaque-access", "opaque-refresh", 60, "bearer", AuthUser("owner", "owner@gmail.com", "now")), 1000, 1, a.publicOrigin)
            vault.write(saved)
            assertEquals(saved, vault.read())
            val files = dir.walkTopDown().filter { it.isFile && it.name == "session.enc" }.toList()
            assertEquals(1, files.size)
            assertFalse(files.single().readBytes().decodeToString().contains("opaque-"))
            assertNull(KeystoreNormalAuthVault(context, aead, b).read())
        } finally { dir.deleteRecursively() }
    }
}
