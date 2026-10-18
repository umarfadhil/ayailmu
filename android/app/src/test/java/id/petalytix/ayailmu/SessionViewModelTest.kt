package id.petalytix.ayailmu

import androidx.lifecycle.SavedStateHandle
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.engine.SeededRngFactory
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ItemType
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        val reports = mutableListOf<List<String>>()
        var failReport = false

        override suspend fun setup(track: String): SessionSetup? = setup()

        override suspend fun finish(
            profileId: String,
            track: String,
        ) {
            finished++
        }

        override suspend fun report(
            profileId: String,
            itemId: String,
            contentVersion: String,
            reason: String,
            text: String,
        ) {
            if (failReport) error("disk full")
            reports += listOf(itemId, contentVersion, reason, text)
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
    fun `a reported question is stored with its content version and its answer carries report_flag`() {
        val store = MemoryStore()
        // An adult-kind profile on the kids' fixture: free text is allowed.
        val (vm, data) = vm(store, profile = TestPacks.profile().copy(kind = ProfileKind.ADULT))
        vm.onEvent(SessionEvent.Continue) // leave the lesson screen
        val q = (vm.state.value as SessionUiState.Running).step as StepUi.Question
        vm.onEvent(SessionEvent.Report("spam")) // unknown reason: ignored
        assertFalse((vm.state.value as SessionUiState.Running).reported)
        vm.onEvent(SessionEvent.Report("typo", "  angka 17 tertulis 71  "))
        assertTrue((vm.state.value as SessionUiState.Running).reported)
        assertEquals(listOf(listOf(q.itemId, TestPacks.math.content.item(q.itemId).contentVersion, "typo", "angka 17 tertulis 71")), data.reports)
        vm.onEvent(SessionEvent.DontKnow)
        assertTrue(store.events.last().reportFlag)
        vm.onEvent(SessionEvent.Continue)
        val next = vm.state.value as SessionUiState.Running
        val nextQ = next.step as? StepUi.Question
        if (nextQ != null && nextQ.itemId != q.itemId && nextQ.kind != RenderKind.GEM && nextQ.kind != RenderKind.INFO) {
            assertFalse(next.reported)
            vm.onEvent(SessionEvent.DontKnow)
            assertFalse(store.events.last().reportFlag)
        }
    }

    @Test
    fun `a failed report flags nothing and can be sent again, and a report after answering flags nothing`() {
        val store = MemoryStore()
        val (vm, data) = vm(store, profile = TestPacks.profile().copy(kind = ProfileKind.ADULT))
        vm.onEvent(SessionEvent.Continue)
        data.failReport = true
        vm.onEvent(SessionEvent.Report("typo"))
        var run = vm.state.value as SessionUiState.Running
        assertTrue(run.reportFailed)
        assertFalse(run.reported)
        assertFalse(run.reporting)
        data.failReport = false
        vm.onEvent(SessionEvent.Report("typo"))
        run = vm.state.value as SessionUiState.Running
        assertTrue(run.reported)
        assertFalse(run.reportFailed)
        assertEquals(1, data.reports.size)
        vm.onEvent(SessionEvent.DontKnow)
        assertTrue(store.events.last().reportFlag)
        // The next question: answered first, reported during its feedback; its saved answer stays unflagged.
        vm.onEvent(SessionEvent.Continue)
        val next = vm.state.value as? SessionUiState.Running
        val nq = next?.step as? StepUi.Question
        if (nq != null && nq.itemId != (run.step as StepUi.Question).itemId && nq.kind != RenderKind.GEM && nq.kind != RenderKind.INFO) {
            vm.onEvent(SessionEvent.DontKnow)
            vm.onEvent(SessionEvent.Report("confusing"))
            assertTrue((vm.state.value as SessionUiState.Running).reported)
            assertEquals(2, data.reports.size)
            assertFalse(store.events.any { it.itemId == nq.itemId && it.reportFlag })
        }
    }

    @Test
    fun `a child profile reports a reason only`() {
        val (vm, data) = vm(MemoryStore())
        vm.onEvent(SessionEvent.Continue)
        assertTrue((vm.state.value as SessionUiState.Running).childProfile)
        vm.onEvent(SessionEvent.Report("other", "nama asli saya"))
        assertEquals("", data.reports.single()[3])
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
    fun `a language track's target language reaches the running state for fonts and voice`() {
        val math = TestPacks.math
        val store = MemoryStore()
        val data = FakeData { SessionSetup(TestPacks.profile(), math.content, math.rules, targetLang = "ko", emptyList(), null, store) }
        val (vm, _) = vm(store, data = data)
        val running = vm.state.value as SessionUiState.Running
        assertEquals("ko", running.targetLang)
        assertFalse(running.targetRtl)
        val (plain, _) = vm(MemoryStore())
        assertEquals(null, (plain.state.value as SessionUiState.Running).targetLang)
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

    @Test
    fun `a data or engine error shows a failure, not a crash`() {
        val (vm, _) = vm(MemoryStore(), data = FakeData { throw IllegalStateException("db") })
        assertEquals(SessionUiState.Failed, vm.state.value)
    }

    // ---- follow-up 12 stories ----

    private fun storyVm(
        store: MemoryStore,
        profile: Profile = TestPacks.profile(),
        history: List<AnswerEvent> = emptyList(),
        saved: SessionState? = null,
    ): SessionViewModel {
        val d = FakeData { SessionSetup(profile, StoryPacks.playable, TestPacks.math.rules, null, history, saved, store) }
        val build = AppBuildInfo(true, "0.1.0-test")
        return SessionViewModel(SavedStateHandle(mapOf("track" to "sej-k")), d, clock, SeededRngFactory, CountingIdGenerator(), build)
    }

    @Test
    fun `a story is watched to its last panel, saved as seen and not counted, and its questions offer it again`() {
        val store = MemoryStore()
        val vm = storyVm(store)
        var stories = 0
        var aboutStory = 0
        var turns = 0
        while (vm.state.value !is SessionUiState.Done && turns++ < 100) {
            val s = vm.state.value as SessionUiState.Running
            val step = s.step as StepUi.Question
            when {
                s.phase == SessionState.Phase.FEEDBACK -> vm.onEvent(SessionEvent.Continue)
                step.kind == RenderKind.STORY -> {
                    stories++
                    assertFalse(s.storySeenBefore)
                    val draft = AnswerDraft()
                    assertNull(draft.toResponse(step))
                    repeat(requireNotNull(step.story).panels.size - 1) { draft.story = draft.storyTimeline(step).next() }
                    vm.onEvent(SessionEvent.Answer(requireNotNull(draft.toResponse(step))))
                    assertEquals(Outcome.NOT_ASSESSED, (vm.state.value as SessionUiState.Running).feedback?.outcome)
                }
                else -> {
                    if (step.story != null) aboutStory++
                    vm.onEvent(SessionEvent.DontKnow)
                }
            }
        }
        val done = vm.state.value as SessionUiState.Done
        assertEquals(2, stories)
        assertEquals(2, aboutStory)
        val seen = store.events.filter { it.itemType == ItemType.STORY }
        assertEquals(2, seen.size)
        assertTrue(seen.all { it.outcome == Outcome.NOT_ASSESSED && !it.freshEvidence })
        // The summary counts answers only; watching a story is not one.
        assertEquals(store.events.size - 2, done.summary.answered)
    }

    @Test
    fun `a story met before offers the skip to children too`() {
        val profile = TestPacks.profile(id = "lrn-1")
        val saved = TestPacks.stateAt("SEJ-K-P-01-001", "sej-k")
        val again = storyVm(MemoryStore(), profile, history = listOf(StoryPacks.event("SEJ-K-P-01-001")), saved = saved)
        val running = again.state.value as SessionUiState.Running
        assertEquals(RenderKind.STORY, (running.step as StepUi.Question).kind)
        assertTrue(running.storySeenBefore)
        assertTrue(running.childProfile)
        val first = storyVm(MemoryStore(), profile, saved = saved).state.value as SessionUiState.Running
        assertFalse(first.storySeenBefore)
    }

    @Test
    fun `a class that failed to initialise shows a failure, not a crash (CR-KT-9)`() {
        val (vm, _) = vm(MemoryStore(), data = FakeData { throw ExceptionInInitializerError("regex") })
        assertEquals(SessionUiState.Failed, vm.state.value)
    }
}
