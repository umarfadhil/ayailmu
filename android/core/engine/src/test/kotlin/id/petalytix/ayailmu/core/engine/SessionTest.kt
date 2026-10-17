package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.engine.EngineFixtures.T0
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabic
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.env
import id.petalytix.ayailmu.core.engine.EngineFixtures.startArabic
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.core.model.ReviewStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Ported from prototype-expo/src/engine/__tests__/session.test.ts. */
class SessionTest {
    private val rules = arabicRules

    private fun skipScreens(s: SessionState): SessionState {
        var st = s
        while (st.currentStep?.kind == Step.Kind.SCREEN) st = Session.advance(st, T0)
        return st
    }

    private fun itemIds(s: SessionState) = s.queue.filter { it.kind == Step.Kind.ITEM }.map { it.id }

    @Test
    fun `starts with the guided lesson screens, then practice items in order`() {
        val s = startArabic()
        assertEquals(listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"), s.queue.take(3).map { it.id })
        assertEquals(listOf("DEMO-M01", "DEMO-F01", "DEMO-P01", "DEMO-M02", "DEMO-F02", "DEMO-P02", "DEMO-P03"), itemIds(s))
        // Reserved and check pools are never queued in a first session
        assertFalse(itemIds(s).any { Regex("Y01|D7|D30|R0|F03").containsMatchIn(it) })
    }

    @Test
    fun `skips lesson screens already seen`() {
        val s = startArabic(screensSeen = listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"))
        assertEquals(Step.Kind.ITEM, s.currentStep?.kind)
    }

    @Test
    fun `records a correct answer with spec 10 fields and shows specific feedback`() {
        val s = skipScreens(startArabic())
        val r = Session.submit(s, Response.typed("orang yang jujur"), env(now = T0 + 5000, timeOnItemMs = 5000))
        val e = assertNotNull(r.event)
        assertEquals("DEMO-M01", e.itemId)
        assertEquals("lrn-1", e.learnerId)
        assertEquals("demo-synthetic-0.1", e.contentVersion)
        assertEquals(rules.rulesVersion, e.rulesVersion)
        assertEquals(Outcome.CORRECT, e.outcome)
        assertTrue(e.firstAttempt && e.freshEvidence && !e.hintUsed)
        assertEquals(5000L, e.timeOnItemMs)
        assertEquals(ReviewStatus.DRAFT, e.reviewStatus)
        assertTrue(e.synthetic)
        assertEquals("""{"kind":"typed","text":"orang yang jujur"}""", e.rawResponse)
        assertEquals(Lang.ID, e.lang)
        assertEquals(SessionState.Phase.FEEDBACK, r.state.phase)
        assertTrue(r.state.feedback!!.messages.first().contains("jujur"))
    }

    @Test
    fun `a second submit on the same item yields no second answer event`() {
        val s = skipScreens(startArabic())
        val first = Session.submit(s, Response.typed("jujur"), env())
        assertNotNull(first.event)
        val again = Session.submit(first.state, Response.typed("jujur"), env())
        assertNull(again.event)
        assertSame(first.state, again.state)
        // and a screen cannot be "answered"
        assertNull(Session.submit(startArabic(), Response.dontKnow(), env()).event)
    }

    @Test
    fun `after a wrong form choice - FA-FORM, then a fresh REMED item for the same skill`() {
        var s = skipScreens(startArabic())
        s = Session.advance(Session.submit(s, Response.typed("jujur"), env()).state, T0)
        val r = Session.submit(s, Response.choice("a"), env())
        assertEquals(listOf(arabic.feedback.getValue("FA-FORM").id), r.state.feedback?.messages)
        s = Session.advance(r.state, T0)
        assertEquals(Step.item("DEMO-F03", Step.Role.REMED), s.currentStep)
    }

    @Test
    fun `after a serious he-she mistake - FA-REF, a focused question (not evidence), then a fresh REMED sentence`() {
        var s = skipScreens(startArabic())
        val history = mutableListOf<AnswerEvent>()
        fun answerWith(resp: Response): SubmitResult {
            val r = Session.submit(s, resp, env())
            history += r.event!!
            s = Session.advance(r.state, T0)
            return r
        }
        answerWith(Response.typed("jujur"))
        answerWith(Response.choice("b"))
        val wrong = answerWith(Response.typed("dia beriman", Referent.LAKI_LAKI))
        assertEquals(ErrorTag.WRONG_REFERENT, wrong.event!!.seriousTag)
        assertTrue(wrong.state.feedback!!.messages.joinToString(" ").contains("هِيَ menunjuk perempuan"))
        assertEquals(listOf(Session.OpenSerious("NOM-01", ErrorTag.WRONG_REFERENT)), Session.unresolvedSerious(history))

        assertEquals(Step.item("DEMO-FQ-REF-F", Step.Role.FOCUS), s.currentStep)
        val focus = answerWith(Response.choice("f"))
        assertFalse(focus.event!!.freshEvidence)
        assertEquals(Pool.FOCUS, focus.event!!.pool)
        assertEquals(1, Session.unresolvedSerious(history).size) // still needs the fresh REMED sentence

        assertEquals(Step.item("DEMO-R01", Step.Role.REMED), s.currentStep)
        val remed = answerWith(Response.typed("dia orang yang beribadah", Referent.PEREMPUAN))
        assertEquals(Outcome.CORRECT, remed.event!!.outcome)
        assertTrue(remed.event!!.freshEvidence)
        assertEquals(emptyList(), Session.unresolvedSerious(history))
    }

    @Test
    fun `flags a skill that runs out of fresh REMED items and lets the learner continue`() {
        // Both REMED sentences already seen today (same day, so they are not due for review yet — the
        // prototype used an earlier date because it had no review scheduler; see PARITY.md).
        val seen =
            listOf("DEMO-R01", "DEMO-R02").map { id ->
                EngineFixtures.event(id, "2026-10-15", Outcome.CORRECT, skills = listOf("NOM-01"), pool = Pool.REMED)
            }
        var s = skipScreens(startArabic(history = seen))
        s = Session.advance(Session.submit(s, Response.typed("jujur"), env(seen)).state, T0)
        s = Session.advance(Session.submit(s, Response.choice("b"), env(seen)).state, T0)
        val r = Session.submit(s, Response.typed("keimanannya", Referent.PEREMPUAN), env(seen))
        assertTrue("out-of-fresh:NOM-01" in r.state.flags)
        s = Session.advance(r.state, T0)
        assertEquals(Step.item("DEMO-FQ-POS", Step.Role.FOCUS), s.currentStep)
        s = Session.advance(Session.submit(s, Response.choice("desc"), env(seen)).state, T0)
        assertEquals(Step.item("DEMO-M02", Step.Role.PRACTICE), s.currentStep)
    }

    @Test
    fun `stops at the time budget, at the end of the current item`() {
        var s = skipScreens(startArabic(minutes = 10))
        val late = T0 + 11 * 60_000L
        s = Session.submit(s, Response.typed("jujur"), env(now = late)).state
        s = Session.advance(s, late)
        assertEquals(SessionState.Phase.DONE, s.phase)
    }

    @Test
    fun `state is plain JSON, so it survives a save-restore round trip`() {
        var s = skipScreens(startArabic())
        s = Session.submit(s, Response.typed("jujur"), env()).state
        val restored = Session.restore(Session.encode(s), arabic)
        assertEquals(s, restored)
        assertEquals(Step.item("DEMO-F01", Step.Role.PRACTICE), Session.advance(restored!!, T0).currentStep)
    }

    @Test
    fun `a second session never repeats items as fresh (reviews are explicit and capped)`() {
        var s = skipScreens(startArabic())
        val history = mutableListOf<AnswerEvent>()
        while (s.phase != SessionState.Phase.DONE) {
            val step = s.currentStep ?: break
            if (step.kind != Step.Kind.ITEM) break
            val r = Session.submit(s, Response.dontKnow(), env())
            history += r.event!!
            s = Session.advance(r.state, T0)
        }
        // Same day: nothing is due for review, nothing seen may be served as fresh.
        val next = startArabic(history = history, screensSeen = listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"))
        val seen = history.map { it.itemId }.toSet()
        assertEquals(emptyList(), next.queue.filter { it.kind == Step.Kind.ITEM && it.id in seen })

        // Next day: seen items may come back only as REVIEW steps, within the review share.
        val tomorrow = T0 + 24 * 60 * 60_000L
        val later =
            Session.start(
                StartArgs(arabic, rules, history, "lrn-1", Lang.ID, null, tomorrow, EngineFixtures.ZONE, 15, listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"), "0.1.0", kotlin.random.Random(1)),
            )
        val reviews = later.queue.filter { it.role == Step.Role.REVIEW }
        assertTrue(reviews.isNotEmpty())
        assertTrue(reviews.size <= ReviewScheduler.cap(15, rules))
        assertEquals(emptyList(), later.queue.filter { it.kind == Step.Kind.ITEM && it.role != Step.Role.REVIEW && it.id in seen })
    }

    @Test
    fun `summary reports counts and next due day, with no mastery claim`() {
        var s = skipScreens(startArabic())
        s = Session.advance(Session.submit(s, Response.typed("jujur"), env()).state, T0)
        s = Session.advance(Session.submit(s, Response.choice("a"), env()).state, T0)
        // the wrong form choice inserted the fresh REMED item DEMO-F03
        s = Session.advance(Session.submit(s, Response.choice("a"), env()).state, T0)
        s = Session.advance(Session.submit(s, Response.typed("hmm", Referent.PEREMPUAN), env()).state, T0)
        val sum = Session.summarize(s, rules)
        assertEquals(4, sum.answered)
        assertEquals(2, sum.correct)
        assertEquals(1, sum.wrong)
        assertEquals(1, sum.pending)
        assertEquals(0, sum.dontKnow)
        assertEquals(1, sum.followUps)
        assertEquals("2026-10-16", sum.nextReviewDate)
        val text = sum.toString().lowercase()
        assertFalse(Regex("learned|dipelajari|menguasai|%").containsMatchIn(text))
    }

    @Test
    fun `a gem is queued once per session at an unpredictable position and never repeated (new)`() {
        val math = EngineFixtures.math
        fun start(history: List<AnswerEvent>, seed: Int) =
            Session.start(
                StartArgs(math, EngineFixtures.mathRules, history, "kid-1", Lang.ID, id.petalytix.ayailmu.core.model.Audience.KIDS, T0, EngineFixtures.ZONE, 10, listOf("MAT-K-P-01-S1"), "0.1.0", kotlin.random.Random(seed)),
            )
        val a = start(emptyList(), 1)
        val gems = a.queue.filter { it.role == Step.Role.GEM }
        assertEquals(1, gems.size)
        assertEquals("MAT-K-P-01-006", gems.single().id)
        val positions = (1..20).map { seed -> start(emptyList(), seed).queue.indexOfFirst { it.role == Step.Role.GEM } }.toSet()
        assertTrue(positions.size > 1, "gem position should vary with the seed")
        val collected = listOf(EngineFixtures.event("MAT-K-P-01-006", "2026-10-14", Outcome.NOT_ASSESSED, skills = emptyList(), pool = Pool.GEM, type = id.petalytix.ayailmu.core.model.ItemType.INFO_CARD, fresh = false))
        assertTrue(start(collected, 1).queue.none { it.role == Step.Role.GEM })
    }

    @Test
    fun `ignores snapshots from another content version or with unknown items`() {
        val state = startArabic()
        assertNull(Session.restore(Session.encode(state.copy(contentVersion = "other")), arabic))
        assertNull(Session.restore(Session.encode(state.copy(queue = listOf(Step.item("GONE", Step.Role.PRACTICE)))), arabic))
        assertNull(Session.restore("""{"nonsense":true}""", arabic))
        assertNull(Session.restore(null, arabic))
    }
}
