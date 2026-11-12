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
    @Test fun accountProofSurvivesSessionClearAndRejectsOriginOrAADSubstitution() {
        AeadConfig.register()
        val aead = KeysetHandle.generateNew(KeyTemplates.get("AES128_GCM")).getPrimitive(Aead::class.java)
        val dir = File.createTempFile("erasure-vault-fixture", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val a = NormalAccountConfig.forValues(true, "https://accounts-a.example.invalid", "owner-policy-1")
        val b = NormalAccountConfig.forValues(true, "https://accounts-b.example.invalid", "owner-policy-1")
        try {
            val vault = KeystoreNormalAuthVault(context, aead, a) { directory -> java.nio.channels.FileChannel.open(directory.toPath(), java.nio.file.StandardOpenOption.READ).use { it.force(true) } }
            val record = SavedAccountErasure(a.publicOrigin, "10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000001", "ab".repeat(32))
            vault.updateErasures { listOf(record) }
            vault.write(null); vault.writeMail(null)
            assertEquals(listOf(record), vault.readErasures())
            val file = dir.walkTopDown().single { it.isFile && it.name == "account-erasure.enc" }
            val ciphertext = file.readBytes()
            assertFalse(ciphertext.decodeToString().contains(record.proof))
            assertFalse(ciphertext.decodeToString().contains(record.subject))
            val other = KeystoreNormalAuthVault(context, aead, b)
            assertTrue(other.readErasures().isEmpty())
            val target = File(dir, "normal-owner-auth/${b.environmentHash}/account-erasure.enc")
            target.parentFile!!.mkdirs(); target.writeBytes(ciphertext)
            assertTrue(runCatching { other.readErasures() }.isFailure); assertTrue(target.exists())
            val corrupt = ciphertext.copyOf(); corrupt[0] = (corrupt[0].toInt() xor 1).toByte(); file.writeBytes(corrupt)
            assertTrue(runCatching { vault.readErasures() }.isFailure); assertTrue(file.exists())
            assertTrue(runCatching { vault.updateErasures { emptyList() } }.isFailure)
            assertArrayEquals(corrupt, file.readBytes())
        } finally { dir.deleteRecursively() }
    }
    @Test fun failedDirectoryFlushNeverSendsAndRetryKeepsOriginalProof() = kotlinx.coroutines.runBlocking {
        AeadConfig.register()
        val aead = KeysetHandle.generateNew(KeyTemplates.get("AES128_GCM")).getPrimitive(Aead::class.java)
        val dir = File.createTempFile("erasure-fsync-fixture", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val config = NormalAccountConfig.forValues(true, "https://accounts-a.example.invalid", "owner-policy-1")
        var failFlush = true
        val vault = KeystoreNormalAuthVault(context, aead, config) { directory ->
            if (failFlush) throw java.io.IOException("fixture directory flush failed")
            java.nio.channels.FileChannel.open(directory.toPath(), java.nio.file.StandardOpenOption.READ).use { it.force(true) }
        }
        val identity = ErasureOwner("10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001")
        var frozen = false
        val owner = object : NormalErasureOwner {
            override fun current() = identity
            override fun freeze(record: SavedAccountErasure) { frozen = true }
            override suspend fun begin(record: SavedAccountErasure, api: id.petalytix.ayailmu.core.sync.AccountErasureApi, accepted: () -> Boolean): id.petalytix.ayailmu.core.sync.AccountDeletionReceipt = error("Unexpected begin")
            override suspend fun completed(record: SavedAccountErasure) = Unit
        }
        var calls = 0
        val api = object : id.petalytix.ayailmu.core.sync.AccountErasureApi {
            override suspend fun begin(token: String, accountId: String, requestId: String, recoveryProof: String): id.petalytix.ayailmu.core.sync.AccountDeletionReceipt = error("Unexpected begin")
            override suspend fun status(requestId: String, recoveryProof: String): id.petalytix.ayailmu.core.sync.AccountDeletionReceipt? { calls++; throw java.io.IOException("fixture unavailable") }
        }
        try {
            val flow = NormalAccountErasure(vault, owner, api, config)
            assertTrue(flow.restore()); flow.confirm(identity.owner)
            assertEquals(0, calls); assertTrue("A readable intent must be frozen before the UI says uploads stopped", frozen)
            val before = vault.readErasures().single()
            flow.retry(before.request); assertEquals(0, calls)
            assertEquals(before, vault.readErasures().single())
            failFlush = false; flow.retry(before.request)
            assertEquals(1, calls); assertEquals(before, vault.readErasures().single())
        } finally { dir.deleteRecursively() }
    }
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
