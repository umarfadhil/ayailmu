package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.repo.*
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class RetainedVisibilityHandlesTest {
    private class MutableVisibility : ProfileVisibility {
        private var visible = true
        private val revision = MutableStateFlow(0)
        override val changes = revision.map { Unit }
        override fun allows(profileId: String) = visible
        fun hide() { visible = false; revision.value++ }
    }
    @Test fun retainedFlowsAndSessionStoreLoseAccessAfterVisibilityChanges() = runTest {
        val db = TestSupport.inMemoryDb()
        try {
            val visibility = MutableVisibility()
            val active = InMemoryActiveProfileStore()
            val profiles = ProfileRepository(db, active, TestSupport.clock(), CountingIdGenerator(), visibility)
            val profile = profiles.create("Owner", ProfileKind.ADULT, Lang.ID)
            val surveys = SurveyRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility)
            val challenges = ChallengeRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility)
            surveys.save(profile.id, "arab", "background", emptyMap(), "test")
            challenges.complete(profile.id, "mat", "01")
            val surveyFlow = surveys.observe(profile.id)
            val challengeFlow = challenges.observe(profile.id)
            assertEquals(1, surveyFlow.first { it.isNotEmpty() }.size)
            assertEquals(1, challengeFlow.first { it.isNotEmpty() }.size)
            val retained = AnswerRepository(db, TestSupport.clock(), CountingIdGenerator(), visibility).storeFor(profile.id)
            visibility.hide()
            assertTrue(surveyFlow.first { it.isEmpty() }.isEmpty())
            assertTrue(challengeFlow.first { it.isEmpty() }.isEmpty())
            assertFailsWith<IllegalArgumentException> { retained.saveScreensSeen(listOf("A01")) }
            assertEquals("[]", db.profiles().get(profile.id)!!.screensSeen)
        } finally { db.close() }
    }
}
