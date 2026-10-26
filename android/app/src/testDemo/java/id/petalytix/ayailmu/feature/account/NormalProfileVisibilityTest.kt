package id.petalytix.ayailmu.feature.account

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.db.OwnerBindingEntity
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.engine.UuidIdGenerator
import id.petalytix.ayailmu.core.sync.*
import java.io.File
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NormalProfileVisibilityTest {
    private val visibilities = mutableListOf<NormalProfileVisibility>()
    @org.junit.After fun closeVisibilities() { visibilities.forEach { it.close() } }
    private val originA = NormalAccountConfig.forValues(true, "https://accounts-a.petalytix.id", "owner-policy-1")
    private val originB = NormalAccountConfig.forValues(true, "https://accounts-b.petalytix.id", "owner-policy-1")
    private fun writeBinding(dir: File, config: NormalAccountConfig) {
        val learner = Learner("remote-a", "cloud-a", "ADULT", "adults", "id")
        val proof = PackProof("arab", "fixture", "rules", "a".repeat(64), "b".repeat(64), "0".repeat(40))
        val binding = Binding(learner, proof)
        val journal = JournalSnapshot(activeOwner = "owner-A", activeLearner = learner.id, owners = mapOf("owner-A" to mapOf(learner.id to binding)))
        FileJournal(File(dir, "normal-owner-sync/${config.environmentHash}/journal.json")).update { journal }
    }
    private fun visibility(dir: File, config: NormalAccountConfig, db: AyaDatabase? = null): NormalProfileVisibility {
        val base = ApplicationProvider.getApplicationContext<Context>()
        return NormalProfileVisibility(object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }, config, db).also { visibilities += it }
    }
    private fun profiles(db: AyaDatabase, visibility: NormalProfileVisibility) = ProfileRepository(
        db, InMemoryActiveProfileStore(), FixedClock(Instant.EPOCH), UuidIdGenerator, visibility,
    )
    @Test fun rollbackAndOriginChangeKeepOldCloudProfilesHiddenWithoutDeletingOfflineProfiles() = runTest {
        val dir = File.createTempFile("visibility-rollback", "").apply { delete() }
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
        db.profiles().upsert(ProfileEntity("cloud-a", "A", "ADULT", null, null, "ADULTS", "id", 1, null, 1f, "[]", null, null))
        db.profiles().upsert(ProfileEntity("offline", "Local", "ADULT", null, null, "ADULTS", "id", 2, null, 1f, "[]", null, null))
        try {
            writeBinding(dir, originA)
            val a = visibility(dir, originA)
            assertFalse("Binding index must fail closed while loading", a.allows("cloud-a"))
            a.refresh()
            assertEquals(setOf("cloud-a", "offline"), profiles(db, a).all().map { it.id }.toSet())
            val disabled = visibility(dir, originA.copy(enabled = false), db); disabled.refresh()
            assertEquals(setOf("offline"), profiles(db, disabled).all().map { it.id }.toSet())
            assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { profiles(db, disabled).setActive("cloud-a") } }
            val b = visibility(dir, originB, db); b.refresh()
            assertEquals(setOf("offline"), profiles(db, b).all().map { it.id }.toSet())
            assertNotNull(db.profiles().get("cloud-a"))
            a.refresh()
            assertEquals(setOf("cloud-a", "offline"), profiles(db, a).all().map { it.id }.toSet())
        } finally { db.close(); dir.deleteRecursively() }
    }

    @Test fun hiddenCloudParentAlsoHidesLocalChildAcrossRollbackAndOriginChange() = runTest {
        val dir = File.createTempFile("visibility-family", "").apply { delete() }
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
        db.profiles().upsert(ProfileEntity("cloud-a", "A", "ADULT", null, null, "ADULTS", "id", 1, null, 1f, "[]", null, null))
        db.profiles().upsert(ProfileEntity("child-a", "Child", "ANAK", "cloud-a", null, "KIDS", "id", 2, null, 1f, "[]", null, null))
        db.profiles().upsert(ProfileEntity("offline-parent", "Local", "ADULT", null, null, "ADULTS", "id", 3, null, 1f, "[]", null, null))
        db.profiles().upsert(ProfileEntity("offline-child", "Local child", "ANAK", "offline-parent", null, "KIDS", "id", 4, null, 1f, "[]", null, null))
        try {
            writeBinding(dir, originA)
            val a = visibility(dir, originA, db); a.refresh()
            assertTrue(a.allows("child-a"))
            val disabled = visibility(dir, originA.copy(enabled = false), db); disabled.refresh()
            assertFalse(disabled.allows("child-a"))
            assertTrue(disabled.allows("offline-child"))
            val b = visibility(dir, originB, db); b.refresh()
            assertFalse(b.allows("child-a"))
            assertTrue(b.allows("offline-child"))
            assertNotNull(db.profiles().get("child-a"))
        } finally { db.close(); dir.deleteRecursively() }
    }


    @Test fun roomBackupWithoutVaultOrJournalKeepsOwnedFamilyHiddenUntilVerified() = runTest {
        val restoredDir = File.createTempFile("visibility-restore", "").apply { delete() }
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
        try {
            db.profiles().upsert(ProfileEntity("cloud-a", "A", "ADULT", null, null, "ADULTS", "id", 1, null, 1f, "[]", null, null))
            db.profiles().upsert(ProfileEntity("child-a", "Child", "ANAK", "cloud-a", null, "KIDS", "id", 2, null, 1f, "[]", null, null))
            db.profiles().upsert(ProfileEntity("offline", "Local", "ADULT", null, null, "ADULTS", "id", 3, null, 1f, "[]", null, null))
            db.ownerBindings().upsert(OwnerBindingEntity("cloud-a", "owner-A", originA.environmentHash))
            // No vault or journal exists in this restored fixture; Room and its nonsecret binding survive.
            val restored = visibility(restoredDir, originA, db); restored.refresh()
            assertFalse(restored.allows("cloud-a"))
            assertFalse(restored.allows("child-a"))
            assertTrue(restored.allows("offline"))
            assertEquals(setOf("offline"), profiles(db, restored).all().map { it.id }.toSet())
            assertEquals("owner-A", db.ownerBindings().all().single().ownerId)
        } finally { db.close(); restoredDir.deleteRecursively() }
    }


    @Test fun parentDeletionPropagatesOwnershipToSurvivingChildAndNewChildStartsClosed() = runTest {
        val dir = File.createTempFile("visibility-delete", "").apply { delete() }
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
        try {
            writeBinding(dir, originA)
            db.profiles().upsert(ProfileEntity("cloud-a", "A", "ADULT", null, null, "ADULTS", "id", 1, null, 1f, "[]", null, null))
            db.ownerBindings().upsert(OwnerBindingEntity("cloud-a", "owner-A", originA.environmentHash))
            val visible = visibility(dir, originA, db); visible.refresh()
            val repository = profiles(db, visible)
            val child = repository.create("Child", id.petalytix.ayailmu.core.data.ProfileKind.ANAK, id.petalytix.ayailmu.core.model.Lang.ID, createdBy = "cloud-a")
            assertFalse("New child fails closed until indexed", visible.allows(child.id))
            visible.refresh()
            assertTrue(visible.allows(child.id))
            repository.delete("cloud-a")
            File(dir, "normal-owner-sync").deleteRecursively()
            val restored = visibility(dir, originA, db); restored.refresh()
            assertFalse(restored.allows(child.id))
            assertEquals("owner-A", db.ownerBindings().all().single { it.profileId == child.id }.ownerId)
            assertNotNull(db.profiles().get(child.id))
        } finally { db.close(); dir.deleteRecursively() }
    }

    @Test fun cachedIndexAvoidsPerPredicateDiskAndCorruptionFailsClosedOnRefresh() = runTest {
        val dir = File.createTempFile("visibility-corrupt", "").apply { delete() }
        try {
            writeBinding(dir, originA)
            val a = visibility(dir, originA); a.refresh()
            val journal = File(dir, "normal-owner-sync/${originA.environmentHash}/journal.json")
            journal.writeText("not-json")
            assertTrue("Predicates use the immutable cache, not disk", a.allows("cloud-a"))
            a.refresh()
            assertFalse(a.allows("cloud-a"))
            assertFalse(a.allows("offline"))
        } finally { dir.deleteRecursively() }
    }
}
