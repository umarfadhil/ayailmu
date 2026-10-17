package id.petalytix.ayailmu

import androidx.lifecycle.SavedStateHandle
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.engine.SeededRngFactory
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionDataSource
import id.petalytix.ayailmu.feature.session.SessionEvent
import id.petalytix.ayailmu.feature.session.SessionSetup
import id.petalytix.ayailmu.feature.session.SessionUiState
import id.petalytix.ayailmu.feature.session.SessionViewModel
import id.petalytix.ayailmu.feature.session.StepUi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** The whole playable loop on the real engine and the real math pack, with an in-memory store. */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionViewModelTest {
    private val zone = ZoneId.of("Asia/Jakarta")
    private val clock = FixedClock(Instant.parse("2026-10-17T02:00:00Z"), zone)

    private class FakeData(
        private val setup: () -> SessionSetup?,
    ) : SessionDataSource {
        var finished = 0

        override suspend fun setup(track: String): SessionSetup? = setup()

        override suspend fun finish(
            profileId: String,
            track: String,
        ) {
            finished++
        }
    }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm(
        store: MemoryStore,
        profile: Profile = TestPacks.profile(),
        history: List<AnswerEvent> = emptyList(),
        saved: SessionState? = null,
        data: FakeData? = null,
    ): Pair<SessionViewModel, FakeData> {
        val math = TestPacks.math
        val d = data ?: FakeData { SessionSetup(profile, math.content, math.rules, math.pack.meta.targetLang, history, saved, store) }
        val vm = SessionViewModel(SavedStateHandle(mapOf("track" to "mat")), d, clock, SeededRngFactory, CountingIdGenerator(), AppBuildInfo(true, "0.1.0-test"))
        return vm to d
    }

    /** Plays to the end answering "I don't know yet" to every question; returns the number of loop turns. */
    private fun playToEnd(vm: SessionViewModel): Int {
        repeat(200) { turn ->
            when (val s = vm.state.value) {
                is SessionUiState.Done -> return turn
                is SessionUiState.Running -> {
                    val step = s.step
                    when {
                        s.phase == SessionState.Phase.FEEDBACK -> vm.onEvent(SessionEvent.Continue)
                        step is StepUi.Screen -> vm.onEvent(SessionEvent.Continue)
                        step is StepUi.Question && (step.kind == RenderKind.GEM || step.kind == RenderKind.INFO) ->
                            vm.onEvent(SessionEvent.Answer(Response.choice(AnswerDraft.SEEN)))
                        else -> vm.onEvent(SessionEvent.DontKnow)
                    }
                }
                else -> fail("unexpected state $s")
            }
        }
        fail("session did not finish")
        return -1
    }

    @Test
    fun `a first math session starts with the lesson screen and plays to a counts-only summary`() {
        val store = MemoryStore()
        val (vm, data) = vm(store)
        val first = vm.state.value as SessionUiState.Running
        assertTrue(first.step is StepUi.Screen)
        assertEquals(1, first.position)
        assertTrue(first.draft)
        assertTrue(store.snapshot != null) // saved before the first step is shown

        playToEnd(vm)
        val done = vm.state.value as SessionUiState.Done
        val questions = store.events.count { !it.gem }
        assertEquals(questions, done.summary.answered)
        assertEquals(questions, done.summary.dontKnow)
        assertEquals(1, done.summary.gems)
        assertEquals(1, store.events.count { it.gem && it.outcome == Outcome.NOT_ASSESSED })
        assertEquals(listOf("MAT-K-P-01-S1"), store.screens)
        assertEquals(1, data.finished)
    }

    @Test
    fun `after finishing, the same day has nothing new and says so without an error`() {
        val store = MemoryStore()
        playToEnd(vm(store).first)
        val (again, _) = vm(MemoryStore(), profile = TestPacks.profile(screensSeen = store.screens), history = store.events.toList())
        assertEquals(SessionUiState.NothingToday, again.state.value)
    }

    @Test
    fun `an unfinished session from today resumes at the same step`() {
        val store = MemoryStore()
        val (vm, _) = vm(store)
        vm.onEvent(SessionEvent.Continue) // leave the lesson screen
        vm.onEvent(SessionEvent.DontKnow) // answer the first question
        vm.onEvent(SessionEvent.Continue)
        val position = (vm.state.value as SessionUiState.Running).position

        val (resumed, _) = vm(MemoryStore(), profile = TestPacks.profile(screensSeen = store.screens), history = store.events.toList(), saved = store.snapshot)
        assertEquals(position, (resumed.state.value as SessionUiState.Running).position)
    }

    @Test
    fun `a failed save keeps the learner on the same question and a retry succeeds`() {
        val store = MemoryStore()
        val (vm, _) = vm(store)
        vm.onEvent(SessionEvent.Continue)
        store.failNextAnswer = true
        vm.onEvent(SessionEvent.DontKnow)
        val failed = vm.state.value as SessionUiState.Running
        assertTrue(failed.saveError)
        assertEquals(SessionState.Phase.STEP, failed.phase)
        assertEquals(0, store.events.size)

        vm.onEvent(SessionEvent.DontKnow)
        val ok = vm.state.value as SessionUiState.Running
        assertEquals(SessionState.Phase.FEEDBACK, ok.phase)
        assertEquals(1, store.events.size)
    }

    @Test
    fun `an evidence track without consent asks for it and records nothing`() {
        val store = MemoryStore()
        val math = TestPacks.math
        val data = FakeData { SessionSetup(TestPacks.profile(), math.content, math.rules, null, emptyList(), null, store, needsConsent = true) }
        val (vm, _) = vm(store, data = data)
        assertEquals(SessionUiState.NeedsConsent, vm.state.value)
        assertEquals(null, store.snapshot)
        assertTrue(store.events.isEmpty())
    }

    @Test
    fun `the running state counts answers for the leave-early message`() {
        val store = MemoryStore()
        val (vm, _) = vm(store)
        vm.onEvent(SessionEvent.Continue)
        vm.onEvent(SessionEvent.DontKnow)
        assertEquals(1, (vm.state.value as SessionUiState.Running).answered)
    }

    @Test
    fun `no active profile or unknown track shows a failure, not a crash`() {
        val (vm, _) = vm(MemoryStore(), data = FakeData { null })
        assertEquals(SessionUiState.Failed, vm.state.value)
    }
}
