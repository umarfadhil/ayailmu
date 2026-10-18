package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.engine.EngineFixtures.T0
import id.petalytix.ayailmu.core.engine.EngineFixtures.ZONE
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.event
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.PartScore
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Response
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Follow-up 11: `trace` items are practice only (CR-ENG-9, INTERACTIONS_AUDIO.md section 4), like `memory_flip`. */
class TraceTest {
    private val content = EngineFixtures.lang
    private val rules = EngineFixtures.mathRules // casual mode
    private val traceId = "JPN-T-P-01-001"
    private val listenId = "JPN-T-P-01-002"
    private val orderId = "JPN-T-P-01-006"
    private val remedTraceId = "JPN-T-P-01-R01"
    private val trace = content.item(traceId)

    /** What the app sends after the learner finishes every stroke of あ. */
    private val strokesDone = Response.sequence(listOf("1", "2", "3"))

    private fun startAt(itemId: String): SessionState {
        val s =
            Session.start(
                StartArgs(
                    content = content,
                    rules = rules,
                    history = emptyList(),
                    learnerId = "kid-1",
                    lang = Lang.ID,
                    audience = Audience.KIDS,
                    nowEpochMs = T0,
                    zone = ZONE,
                    budgetMinutes = 10,
                    screensSeen = emptyList(),
                    appVersion = "0.1.0",
                    random = Random(1),
                    ids = CountingIdGenerator(),
                ),
            )
        val at = s.queue.indexOfFirst { it.id == itemId }
        assertTrue(at >= 0, "$itemId is not planned")
        return s.copy(index = at)
    }

    private fun env(history: List<AnswerEvent> = emptyList()) =
        Env(content, rules, history, nowEpochMs = T0, timeOnItemMs = 1, ids = CountingIdGenerator())

    // ---- scoring ------------------------------------------------------------------------------------

    @Test
    fun `a finished trace is correct with the correct feedback of the item`() {
        val s = Scoring.scoreItem(trace, strokesDone, rules, Lang.ID)
        assertEquals(Outcome.CORRECT, s.outcome)
        assertEquals(mapOf("answer" to PartScore.CORRECT), s.parts)
        assertEquals(listOf("FB-OK"), s.feedbackIds)
        assertTrue(s.errorTags.isEmpty())
        assertNull(s.serious)
    }

    @Test
    fun `a trace is never wrong - dont know stays dont know and no strokes is not assessed`() {
        val dk = Scoring.scoreItem(trace, Response.dontKnow(), rules, Lang.ID)
        assertEquals(Outcome.DONT_KNOW, dk.outcome)
        assertEquals(listOf("FB-DONTKNOW"), dk.feedbackIds)
        assertEquals(Outcome.NOT_ASSESSED, Scoring.scoreItem(trace, Response.sequence(emptyList()), rules, Lang.ID).outcome)
        assertFailsWith<IllegalArgumentException> { Scoring.scoreItem(trace, Response.choice("1"), rules, Lang.ID) }
    }

    // ---- session ------------------------------------------------------------------------------------

    @Test
    fun `the planner queues a trace like other practice and its answer is saved but never evidence`() {
        val s = startAt(traceId)
        val practice = s.queue.filter { it.role == Step.Role.PRACTICE }.map { it.id }
        assertEquals(listOf(traceId, listenId, "JPN-T-P-01-003", "JPN-T-P-01-004", "JPN-T-P-01-005", orderId), practice)

        val r = Session.submit(s, strokesDone, env())
        val e = assertNotNull(r.event)
        assertEquals(Outcome.CORRECT, e.outcome)
        assertEquals(ItemType.TRACE, e.itemType)
        assertTrue(e.firstAttempt)
        assertFalse(e.hintUsed)
        assertFalse(e.freshEvidence)
        assertTrue("\"sequence\"" in e.rawResponse)
        assertEquals(s.queue, r.state.queue) // no follow-up
        assertEquals(listOf("Betul!"), r.state.feedback?.messages)

        val summary = Session.summarize(r.state, rules)
        assertEquals(1, summary.answered)
        assertEquals(1, summary.correct)
        assertEquals(0, summary.followUps)
    }

    @Test
    fun `dont know on a trace adds no follow-up and raises no flag`() {
        val s = startAt(traceId)
        val r = Session.submit(s, Response.dontKnow(), env())
        assertEquals(Outcome.DONT_KNOW, r.event?.outcome)
        assertEquals(false, r.event?.freshEvidence)
        assertEquals(s.queue, r.state.queue)
        assertTrue(r.state.flags.isEmpty())
    }

    @Test
    fun `a REMED trace can follow a wrong answer on its skill and is still not evidence`() {
        val s = startAt(orderId)
        val wrong = Session.submit(s, Response.sequence(listOf("nu", "i")), env())
        assertEquals(Outcome.WRONG, wrong.event?.outcome)
        val next = Session.advance(wrong.state, T0)
        assertEquals(Step.item(remedTraceId, Step.Role.REMED), next.currentStep)

        val done = Session.submit(next, Response.sequence(listOf("1", "2")), env(listOfNotNull(wrong.event)))
        val e = assertNotNull(done.event)
        assertEquals(Outcome.CORRECT, e.outcome)
        assertEquals(Pool.REMED, e.pool)
        assertFalse(e.freshEvidence)
    }

    // ---- projection and review ----------------------------------------------------------------------

    private fun onKana(
        id: String,
        day: String,
        type: ItemType,
        fresh: Boolean = true,
    ) = event(id, day, Outcome.CORRECT, skills = listOf("KANA-A"), type = type, fresh = fresh)

    @Test
    fun `trace answers never count toward learned, in casual or evidence mode`() {
        val days = listOf("2026-10-15", "2026-10-15", "2026-10-16", "2026-10-17")
        val traced = days.mapIndexed { i, d -> onKana("T$i", d, ItemType.TRACE) }
        val casual = SkillProjector.project(traced, rules, content).skills.getValue("KANA-A")
        assertEquals(0, casual.freshAttempts)
        assertEquals(SkillProjector.Status.PRACTICING, casual.status)

        // Control: the same answers on an evidence-capable type are learned.
        val ordered = days.mapIndexed { i, d -> onKana("O$i", d, ItemType.ORDER) }
        assertEquals(SkillProjector.Status.LEARNED, SkillProjector.project(ordered, rules, content).skills.getValue("KANA-A").status)

        // Evidence mode reads fresh_evidence, which Session never sets for a trace.
        val evidence = days.mapIndexed { i, d -> onKana("T$i", d, ItemType.TRACE, fresh = false) }
        assertEquals(0, SkillProjector.project(evidence, arabicRules).skills.getValue("KANA-A").freshAttempts)
    }

    @Test
    fun `trace items are never scheduled for review`() {
        val h =
            listOf(
                onKana(traceId, "2026-10-10", ItemType.TRACE),
                event(listenId, "2026-10-10", Outcome.CORRECT, skills = listOf("VOCAB-FOOD"), type = ItemType.AUDIO_MATCH),
            )
        assertEquals(listOf(listenId), ReviewScheduler.due(content.items, h, "2026-10-20", rules).map { it.itemId })
        assertFalse(ReviewScheduler.isReviewable(trace))
        assertTrue(ReviewScheduler.isReviewable(content.item(listenId)))
    }
}
