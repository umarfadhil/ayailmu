package id.petalytix.ayailmu.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.repo.*
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ProfileVisibilityMutationTest {
    private class Visibility(private val hidden: Set<String>) : ProfileVisibility {
        override val changes: Flow<Unit> = flowOf(Unit)
        override fun allows(profileId: String) = profileId !in hidden
    }
    private fun profile(id: String, kind: String = "ADULT", parent: String? = null) = ProfileEntity(id, id, kind, parent, null, if (kind == "ADULT") "ADULTS" else "KIDS", "id", 1, null, 1f, "[]", null, null)

    @Test fun hiddenIdsCannotCreateMutateDeleteOrReadAnotherOwnersRecords() = runTest {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
        try {
            db.profiles().upsert(profile("hidden-parent"))
            db.profiles().upsert(profile("hidden-child", "ANAK", "hidden-parent"))
            db.profiles().upsert(profile("local-parent"))
            val active = InMemoryActiveProfileStore("hidden-parent")
            val visibility = Visibility(setOf("hidden-parent", "hidden-child"))
            val profiles = ProfileRepository(db, active, TestSupport.clock(), CountingIdGenerator(), visibility)
            val answers = AnswerRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility)
            val surveys = SurveyRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility)
            val challenges = ChallengeRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility)
            assertFailsWith<IllegalArgumentException> { profiles.create("bad", ProfileKind.ANAK, Lang.ID, createdBy = "hidden-parent") }
            assertFailsWith<IllegalArgumentException> { profiles.setActive("hidden-parent") }
            assertFailsWith<IllegalArgumentException> { profiles.setLanguage("hidden-parent", Lang.EN) }
            assertFailsWith<IllegalArgumentException> { profiles.setSessionMinutes("hidden-parent", 10) }
            assertFailsWith<IllegalArgumentException> { profiles.setArabicScale("hidden-parent", 1.2f) }
            assertFailsWith<IllegalArgumentException> { profiles.recordConsent("hidden-parent", "fixture") }
            assertFailsWith<IllegalArgumentException> { profiles.withdrawConsent("hidden-parent") }
            assertFailsWith<IllegalArgumentException> { profiles.delete("hidden-parent") }
            assertFailsWith<IllegalArgumentException> { answers.storeFor("hidden-parent") }
            assertFailsWith<IllegalArgumentException> { answers.clearSnapshot("hidden-parent", "arab") }
            assertFailsWith<IllegalArgumentException> { answers.addReport("hidden-parent", "A01", "v1", "typo", "bad") }
            assertFailsWith<IllegalArgumentException> { surveys.save("hidden-parent", "arab", "background", emptyMap(), "test") }
            assertFailsWith<IllegalArgumentException> { challenges.complete("hidden-parent", "mat", "01") }
            assertNull(profiles.activeProfile())
            assertTrue(answers.history("hidden-parent", "arab").isEmpty())
            assertTrue(surveys.forProfile("hidden-parent").isEmpty())
            assertTrue(challenges.forProfile("hidden-parent").isEmpty())
            assertNotNull(db.profiles().get("hidden-parent"), "Hidden data must not be deleted")
            val created = profiles.create("local child", ProfileKind.ANAK, Lang.ID, createdBy = "local-parent")
            assertEquals("local-parent", created.createdBy)
        } finally { db.close() }
    }
}
