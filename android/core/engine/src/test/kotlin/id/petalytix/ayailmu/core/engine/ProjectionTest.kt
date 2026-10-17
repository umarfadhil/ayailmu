package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.engine.EngineFixtures.arabic
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.event
import id.petalytix.ayailmu.core.engine.EngineFixtures.mathRules
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** New in the Kotlin engine: review scheduling and skill projection (Trial_App_Spec §7, framework §3). */
class ProjectionTest {
    // ---- ReviewScheduler ----------------------------------------------------------------------------

    @Test
    fun `an item is due after the first rung and climbs the ladder on correct reviews`() {
        val items = arabic.items
        val h1 = listOf(event("DEMO-M01", "2026-10-10", Outcome.CORRECT))
        assertEquals(listOf("DEMO-M01"), ReviewScheduler.due(items, h1, "2026-10-11", arabicRules).map { it.itemId })
        assertEquals(emptyList(), ReviewScheduler.due(items, h1, "2026-10-10", arabicRules))

        // Reviewed correctly on day 2 → rung 1 → next due after 3 days (day 5), not day 3.
        val h2 = h1 + event("DEMO-M01", "2026-10-11", Outcome.CORRECT, fresh = false, first = false)
        assertEquals(emptyList(), ReviewScheduler.due(items, h2, "2026-10-13", arabicRules))
        assertEquals(listOf("DEMO-M01"), ReviewScheduler.due(items, h2, "2026-10-14", arabicRules).map { it.itemId })

        // A mistake steps back one rung.
        val h3 = h2 + event("DEMO-M01", "2026-10-14", Outcome.WRONG, fresh = false, first = false)
        assertEquals(listOf("DEMO-M01"), ReviewScheduler.due(items, h3, "2026-10-15", arabicRules).map { it.itemId })
    }

    @Test
    fun `focus and gem items are never reviewed, and the cap follows review_share_max`() {
        val items = arabic.items
        val h = listOf(event("DEMO-FQ-POS", "2026-10-10", Outcome.CORRECT, pool = Pool.FOCUS, type = ItemType.CHOOSE))
        assertEquals(emptyList(), ReviewScheduler.due(items, h, "2026-10-20", arabicRules))
        assertEquals(7, ReviewScheduler.cap(15, arabicRules))
        assertEquals(4, ReviewScheduler.cap(12, mathRules))
    }

    // ---- SkillProjector (evidence mode) ----------------------------------------------------------------

    private fun fresh(
        id: String,
        day: String,
        outcome: Outcome = Outcome.CORRECT,
        pool: Pool = Pool.PRACT,
        type: ItemType = ItemType.TYPE_IN,
    ) = event(id, day, outcome, skills = listOf("NOM-01"), pool = pool, type = type)

    @Test
    fun `learned needs 4 of 5 fresh correct, 2 typed, 2 items, 1 READY and a later day`() {
        val base =
            listOf(
                fresh("P01", "2026-10-15"),
                fresh("P02", "2026-10-15"),
                fresh("P03", "2026-10-15", Outcome.WRONG),
                fresh("R01", "2026-10-15"),
            )
        // Only one day so far and no READY item: practicing.
        assertEquals(SkillProjector.Status.PRACTICING, SkillProjector.project(base, arabicRules).skills.getValue("NOM-01").status)

        val withReady = base + fresh("Y01", "2026-10-16", pool = Pool.READY)
        val st = SkillProjector.project(withReady, arabicRules).skills.getValue("NOM-01")
        assertEquals(SkillProjector.Status.LEARNED, st.status)
        assertEquals(4, st.correctInWindow)
        assertTrue(st.laterDay)
        assertEquals(1, st.readyCount)
    }

    @Test
    fun `an unresolved serious mistake blocks learned`() {
        val h =
            listOf(
                fresh("P01", "2026-10-15"),
                fresh("P02", "2026-10-15"),
                event("P03", "2026-10-15", Outcome.WRONG, serious = ErrorTag.WRONG_REFERENT),
                fresh("R01", "2026-10-15"),
                fresh("Y01", "2026-10-16", pool = Pool.READY),
                fresh("R02", "2026-10-16"),
            )
        val st = SkillProjector.project(h, arabicRules).skills.getValue("NOM-01")
        assertEquals(SkillProjector.Status.BLOCKED, st.status)
        assertEquals(ErrorTag.WRONG_REFERENT, st.blockedBy)
    }

    @Test
    fun `hinted and non-fresh attempts never count as evidence`() {
        val h =
            (1..5).map { fresh("P0$it", "2026-10-1$it") } +
                event("X", "2026-10-16", Outcome.CORRECT, skills = listOf("NOM-01"), fresh = false)
        val st = SkillProjector.project(h, arabicRules).skills.getValue("NOM-01")
        assertEquals(5, st.freshAttempts)
    }

    @Test
    fun `binary two-option items only count once the streak holds`() {
        val math = EngineFixtures.math
        fun tf(
            day: String,
            outcome: Outcome,
        ) = event("MAT-K-P-01-003", day, outcome, skills = listOf("NUM-COMPARE"), type = ItemType.TRUE_FALSE)
        val shortStreak = listOf(tf("2026-10-15", Outcome.CORRECT), tf("2026-10-16", Outcome.CORRECT))
        assertEquals(0, SkillProjector.project(shortStreak, mathRules, math).skills.getValue("NUM-COMPARE").freshAttempts)
        val streak = shortStreak + tf("2026-10-17", Outcome.CORRECT)
        val st = SkillProjector.project(streak, mathRules, math).skills.getValue("NUM-COMPARE")
        assertEquals(3, st.freshAttempts)
        assertEquals(SkillProjector.Status.LEARNED, st.status)
    }

    @Test
    fun `a word is learned after correct typed meanings on two different days`() {
        val h = listOf(event("DEMO-M01", "2026-10-15", Outcome.CORRECT, skills = listOf("LEX-A:W-A3")))
        assertEquals(false, SkillProjector.project(h, arabicRules, arabic).words.getValue("W-A3").learned)
        val h2 = h + event("DEMO-M01", "2026-10-17", Outcome.CORRECT, skills = listOf("LEX-A:W-A3"), fresh = false, first = false)
        assertEquals(true, SkillProjector.project(h2, arabicRules, arabic).words.getValue("W-A3").learned)
    }

    @Test
    fun `casual mode - 3 of the last 4 with a later day`() {
        fun e(
            id: String,
            day: String,
            outcome: Outcome = Outcome.CORRECT,
        ) = event(id, day, outcome, skills = listOf("NUM-COUNT-20"), type = ItemType.CHOOSE)
        val sameDay = listOf(e("a", "2026-10-15"), e("b", "2026-10-15"), e("c", "2026-10-15"))
        assertEquals(SkillProjector.Status.PRACTICING, SkillProjector.project(sameDay, mathRules).skills.getValue("NUM-COUNT-20").status)
        val later = sameDay + e("d", "2026-10-16", Outcome.WRONG)
        assertEquals(SkillProjector.Status.LEARNED, SkillProjector.project(later, mathRules).skills.getValue("NUM-COUNT-20").status)
    }
}
