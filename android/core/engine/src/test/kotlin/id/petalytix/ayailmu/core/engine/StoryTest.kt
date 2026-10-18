package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.PackLoader
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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Follow-up 12: a `story` item is watched and "seen", never scored and never evidence - handled exactly like an
 * `info_card` by scoring, planning, follow-ups, review and projection (MODULES_LEVELS_STORIES.md section 2).
 */
class StoryTest {
    private val content: GatedContent by lazy {
        val stream = requireNotNull(javaClass.classLoader.getResourceAsStream("fixtures/story-sample-v1.json"))
        Gating.gate(PackLoader.parse(stream.use { it.readBytes().toString(Charsets.UTF_8) }), developerDemo = true)
    }
    private val rules = EngineFixtures.mathRules // casual mode
    private val storyId = "SEJ-T-M-01-001"
    private val pickId = "SEJ-T-M-01-002"
    private val orderId = "SEJ-T-M-01-003"
    private val gemId = "SEJ-T-M-01-G01"

    /** What the app sends when the learner taps on after the story (the same as an info card). */
    private val seen = Response.choice("seen")

    private fun start(history: List<AnswerEvent> = emptyList()): SessionState =
        Session.start(
            StartArgs(
                content = content,
                rules = rules,
                history = history,
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

    private fun startAt(itemId: String): SessionState {
        val s = start()
        val at = s.queue.indexOfFirst { it.id == itemId }
        assertTrue(at >= 0, "$itemId is not planned")
        return s.copy(index = at)
    }

    private fun env(history: List<AnswerEvent> = emptyList()) =
        Env(content, rules, history, nowEpochMs = T0, timeOnItemMs = 1, ids = CountingIdGenerator())

    // ---- scoring ------------------------------------------------------------------------------------

    @Test
    fun `a story scores exactly like an info card - seen, not assessed, with its correct feedback`() {
        val story = content.item(storyId)
        val s = Scoring.scoreItem(story, seen, rules, Lang.ID)
        assertEquals(Outcome.NOT_ASSESSED, s.outcome)
        assertEquals(mapOf("seen" to PartScore.NOT_ASSESSED), s.parts)
        assertEquals(listOf("FB-SEEN"), s.feedbackIds)
        assertTrue(s.errorTags.isEmpty())

        val card = content.item(gemId)
        assertEquals(ItemType.INFO_CARD, card.type)
        val c = Scoring.scoreItem(card, seen, rules, Lang.ID)
        assertEquals(c.outcome, s.outcome)
        assertEquals(c.parts, s.parts)
        // Any response shape is accepted: the story only needs to be continued.
        assertEquals(Outcome.NOT_ASSESSED, Scoring.scoreItem(story, Response.sequence(listOf("1")), rules, Lang.ID).outcome)
    }

    // ---- session ------------------------------------------------------------------------------------

    @Test
    fun `the planner queues the story first, then its questions, and the story is saved but never evidence`() {
        val s = startAt(storyId)
        val practice = s.queue.filter { it.role == Step.Role.PRACTICE }.map { it.id }
        assertEquals(listOf(storyId, pickId, orderId, "SEJ-T-M-01-004"), practice)

        val r = Session.submit(s, seen, env())
        val e = assertNotNull(r.event)
        assertEquals(Outcome.NOT_ASSESSED, e.outcome)
        assertEquals(ItemType.STORY, e.itemType)
        assertTrue(e.firstAttempt)
        assertFalse(e.freshEvidence)
        assertEquals(s.queue, r.state.queue) // no follow-up
        assertEquals(listOf("Ayo lanjut!"), r.state.feedback?.messages)

        // Tapping on moves to the next planned step, like after an info card.
        assertEquals(s.queue[s.index + 1], Session.advance(r.state, T0).currentStep)

        val summary = Session.summarize(r.state, rules)
        assertEquals(0, summary.answered)
        assertEquals(0, summary.followUps)
        assertTrue(summary.items.isEmpty())
    }

    @Test
    fun `a question about the story is an ordinary scored item with fresh evidence and follow-ups`() {
        val q = startAt(pickId)
        val right = Session.submit(q, Response.choice("letters"), env())
        assertEquals(Outcome.CORRECT, right.event?.outcome)
        assertEquals(true, right.event?.freshEvidence)

        val wrong = Session.submit(q, Response.choice("plane"), env())
        assertEquals(Outcome.WRONG, wrong.event?.outcome)
        val next = Session.advance(wrong.state, T0)
        assertEquals(Step.item("SEJ-T-M-01-R01", Step.Role.REMED), next.currentStep)
    }

    @Test
    fun `a seen story is never planned as fresh again`() {
        val first = Session.submit(startAt(storyId), seen, env())
        val history = listOfNotNull(first.event)
        val again = start(history)
        assertFalse(again.queue.any { it.id == storyId })
        assertTrue(again.queue.any { it.id == pickId })
    }

    // ---- projection and review ----------------------------------------------------------------------

    @Test
    fun `story events never count toward learned and stories are never reviewed`() {
        val days = listOf("2026-10-15", "2026-10-15", "2026-10-16", "2026-10-17")
        val watched =
            days.mapIndexed { i, d ->
                event("S$i", d, Outcome.NOT_ASSESSED, skills = listOf("SEJ-KARTINI"), type = ItemType.STORY)
            }
        assertEquals(0, SkillProjector.project(watched, rules, content).skills.getValue("SEJ-KARTINI").freshAttempts)
        // Even an event wrongly marked correct does not count: the type is not evidence-capable.
        val forged = watched.map { it.copy(outcome = Outcome.CORRECT) }
        assertEquals(0, SkillProjector.project(forged, rules, content).skills.getValue("SEJ-KARTINI").freshAttempts)
        val evidence = SkillProjector.project(forged.map { it.copy(freshEvidence = false) }, arabicRules)
        assertEquals(0, evidence.skills.getValue("SEJ-KARTINI").freshAttempts)

        assertFalse(ReviewScheduler.isReviewable(content.item(storyId)))
        assertTrue(ReviewScheduler.isReviewable(content.item(pickId)))
        val h =
            listOf(
                event(storyId, "2026-10-10", Outcome.NOT_ASSESSED, skills = listOf("SEJ-KARTINI"), type = ItemType.STORY),
                event(pickId, "2026-10-10", Outcome.CORRECT, skills = listOf("SEJ-KARTINI"), type = ItemType.PICK_IMAGE),
            )
        assertEquals(listOf(pickId), ReviewScheduler.due(content.items, h, "2026-10-20", rules).map { it.itemId })
    }

    @Test
    fun `the gated content carries the story for its story item and for Watch again`() {
        val story = assertNotNull(content.story("ST-KARTINI"))
        assertEquals(story, content.story(content.item(storyId).storyId))
        assertEquals(story, content.story(content.item(orderId).storyId))
        assertEquals(3, story.panels.size)
        assertEquals(Pool.PRACT, content.item(storyId).pool)
    }
}
