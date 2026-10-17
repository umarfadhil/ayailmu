package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.engine.EngineFixtures.T0
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabic
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.startArabic
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Response
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Ported from prototype-expo/src/engine/__tests__/controller.test.ts. */
class SessionControllerTest {
    /** In-memory store whose next write(s) can be made to fail. */
    private class FlakyStore : SessionStore {
        val answers = mutableListOf<AnswerEvent>()
        var snapshot: SessionState? = null
        var screens: List<String> = emptyList()
        var failures = 0

        private fun maybeFail() {
            if (failures > 0) {
                failures--
                throw IllegalStateException("simulated write failure")
            }
        }

        override suspend fun recordAnswer(
            event: AnswerEvent,
            snapshot: SessionState,
        ) {
            maybeFail()
            if (answers.none { it.answerId == event.answerId }) answers += event
            this.snapshot = snapshot
        }

        override suspend fun saveSnapshot(snapshot: SessionState) {
            maybeFail()
            this.snapshot = snapshot
        }

        override suspend fun saveScreensSeen(screenIds: List<String>) {
            maybeFail()
            screens = screenIds
        }
    }

    private val allScreens = listOf("DEMO-S1", "DEMO-S2", "DEMO-S3")

    private fun setup(screensSeen: List<String> = allScreens): Pair<SessionController, FlakyStore> {
        val store = FlakyStore()
        val state = startArabic(screensSeen = screensSeen)
        val c =
            SessionController(
                store = store,
                content = arabic,
                rules = arabicRules,
                initialState = state,
                history = emptyList(),
                screensSeen = screensSeen,
                clock = FixedClock(Instant.ofEpochMilli(T0), EngineFixtures.ZONE),
                ids = CountingIdGenerator(),
            )
        return c to store
    }

    @Test
    fun `a rapid double submit produces exactly one answer event`() =
        runTest {
            val (c, store) = setup()
            val results =
                listOf(
                    async { c.submit(Response.typed("jujur"), 1000) },
                    async { c.submit(Response.typed("jujur"), 1000) },
                ).awaitAll()
            assertEquals(listOf(SaveResult.IGNORED, SaveResult.SAVED), results.sortedBy { it.name })
            assertEquals(1, store.answers.size)
            // A third tap while feedback is shown is also ignored
            assertEquals(SaveResult.IGNORED, c.submit(Response.typed("jujur"), 1000))
            assertEquals(1, store.answers.size)
        }

    @Test
    fun `does not advance the UI state when saving the answer fails, and the retry saves it once`() =
        runTest {
            val (c, store) = setup()
            val before = c.state
            store.failures = 1
            assertEquals(SaveResult.FAILED, c.submit(Response.typed("jujur"), 1000))
            assertSame(before, c.state)
            assertTrue(c.error!!.contains("simulated"))
            assertEquals(0, c.history.size)
            assertEquals(0, store.answers.size)

            assertEquals(SaveResult.SAVED, c.submit(Response.typed("jujur"), 1000))
            assertNull(c.error)
            assertEquals(SessionState.Phase.FEEDBACK, c.state.phase)
            assertEquals(1, store.answers.size)
            assertEquals(c.state, store.snapshot)
        }

    @Test
    fun `does not move to the next step when saving the snapshot fails`() =
        runTest {
            val (c, store) = setup()
            c.submit(Response.typed("jujur"), 1000)
            val atFeedback = c.state
            store.failures = 1
            assertEquals(SaveResult.FAILED, c.next())
            assertSame(atFeedback, c.state)
            assertEquals(atFeedback, store.snapshot)
            assertEquals(SaveResult.SAVED, c.next())
            assertEquals(Step.item("DEMO-F01", Step.Role.PRACTICE), c.state.currentStep)
        }

    @Test
    fun `resumes from the saved snapshot after a restart`() =
        runTest {
            val (c, store) = setup()
            c.submit(Response.typed("jujur"), 1000)
            c.next()
            val restored = Session.restore(Session.encode(store.snapshot!!), arabic)
            assertEquals(c.state, restored)
            assertEquals(Step.item("DEMO-F01", Step.Role.PRACTICE), restored!!.currentStep)
        }

    @Test
    fun `records seen lesson screens so they are not repeated`() =
        runTest {
            val (c, store) = setup(screensSeen = emptyList())
            assertEquals(SaveResult.SAVED, c.next())
            assertEquals(listOf("DEMO-S1"), store.screens)
            assertEquals(listOf("DEMO-S1"), c.screensSeen)
        }
}
