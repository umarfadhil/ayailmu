package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.engine.EngineFixtures.arabic
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.attempt
import id.petalytix.ayailmu.core.engine.EngineFixtures.item
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Referent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ported from prototype-expo/src/engine/__tests__/freshness.test.ts. */
class FreshnessTest {
    private val items = arabic.items
    private val rules = arabicRules

    private fun ctx(
        today: String,
        history: List<AttemptLog> = emptyList(),
    ) = FreshContext(today, history, rules)

    @Test
    fun `serves PRACT items in order and never reuses a seen item as fresh`() {
        assertEquals("DEMO-M01", Freshness.pickFreshItem(items, ctx("2026-10-15"), setOf(Pool.PRACT))?.itemId)
        val history = listOf(attempt("DEMO-M01", "2026-10-15"))
        assertEquals("DEMO-F01", Freshness.pickFreshItem(items, ctx("2026-10-15", history), setOf(Pool.PRACT))?.itemId)
        assertFalse(Freshness.isEligibleFresh(item("DEMO-M01"), ctx("2026-10-15", history)))
    }

    @Test
    fun `never serves READY items before enough practice on the skill`() {
        assertFalse(Freshness.isEligibleFresh(item("DEMO-Y01"), ctx("2026-10-15")))
        val history = listOf("DEMO-P01", "DEMO-P02", "DEMO-P03").map { attempt(it, "2026-10-15") }
        assertTrue(Freshness.isEligibleFresh(item("DEMO-Y01"), ctx("2026-10-15", history)))
    }

    @Test
    fun `never serves D7 or D30 items before the check is due`() {
        val history = listOf(attempt("DEMO-P01", "2026-10-15"))
        assertFalse(Freshness.isEligibleFresh(item("DEMO-D701"), ctx("2026-10-15", history)))
        assertFalse(Freshness.isEligibleFresh(item("DEMO-D701"), ctx("2026-10-21", history)))
        assertTrue(Freshness.isEligibleFresh(item("DEMO-D701"), ctx("2026-10-22", history)))
        assertFalse(Freshness.isEligibleFresh(item("DEMO-D3001"), ctx("2026-10-22", history)))
        assertTrue(Freshness.isEligibleFresh(item("DEMO-D3001"), ctx("2026-11-14", history)))
        // No practice at all: no check is ever due
        assertFalse(Freshness.isEligibleFresh(item("DEMO-D701"), ctx("2027-01-01")))
    }

    @Test
    fun `a REMED item after a mistake is unseen and from the same skill`() {
        val history = listOf(attempt("DEMO-P01", "2026-10-15"), attempt("DEMO-R01", "2026-10-15"))
        val remed = Freshness.pickFreshItem(items, ctx("2026-10-15", history), setOf(Pool.REMED), skill = "NOM-01")
        assertEquals("DEMO-R02", remed?.itemId)
    }

    @Test
    fun `returns null when a skill is out of fresh questions`() {
        val history = listOf("DEMO-R01", "DEMO-R02").map { attempt(it, "2026-10-15") }
        assertNull(Freshness.pickFreshItem(items, ctx("2026-10-15", history), setOf(Pool.REMED), skill = "NOM-01"))
    }

    @Test
    fun `can exclude items already queued in this session`() {
        val r = Freshness.pickFreshItem(items, ctx("2026-10-15"), setOf(Pool.REMED), skill = "NOM-01", exclude = setOf("DEMO-R01"))
        assertEquals("DEMO-R02", r?.itemId)
    }

    @Test
    fun `later_day items need an earlier-day attempt on the skill`() {
        val later = item("DEMO-P02").copy(itemId = "T-LATER", pool = Pool.PRACT, laterDay = true)
        val sameDay = listOf(attempt("DEMO-P01", "2026-10-15"))
        assertFalse(Freshness.isEligibleFresh(later, ctx("2026-10-15", sameDay)))
        assertTrue(Freshness.isEligibleFresh(later, ctx("2026-10-16", sameDay)))
    }

    @Test
    fun `FOCUS questions are never served as fresh evidence`() {
        assertFalse(Freshness.isEligibleFresh(item("DEMO-FQ-POS"), ctx("2026-10-15")))
        assertEquals("DEMO-FQ-REF-F", Freshness.pickFocusItem(items, ErrorTag.WRONG_REFERENT, Referent.PEREMPUAN)?.itemId)
        assertEquals("DEMO-FQ-POS", Freshness.pickFocusItem(items, ErrorTag.POSSESSION)?.itemId)
    }

    @Test
    fun `never shows a reserved check form before its check, and releases it once the check was seen`() {
        val base = item("DEMO-P02")
        val reservedCheck = base.copy(itemId = "T-D7", pool = Pool.D7, targetText = "ضَحِكَ", forms = listOf("ضَحِكَ"), reserveForms = true)
        val leaky = base.copy(itemId = "T-LEAK", pool = Pool.PRACT, targetText = "ضَحِكَ", forms = listOf("ضَحِكَ"), order = 0)
        val pool = listOf(reservedCheck, leaky) + items

        assertFalse(Freshness.isEligibleFresh(leaky, ctx("2026-10-15"), pool))
        assertNotEquals("T-LEAK", Freshness.pickFreshItem(pool, ctx("2026-10-15"), setOf(Pool.PRACT))?.itemId)

        val history = listOf(attempt("DEMO-P01", "2026-10-15"), attempt("T-D7", "2026-10-22", pool = Pool.D7, skills = base.skills))
        assertTrue(Freshness.isEligibleFresh(leaky, ctx("2026-10-22", history), pool))
    }

    @Test
    fun `reports a TRANS item that reuses a form from another item`() {
        val base = item("DEMO-P02")
        val mt = base.copy(itemId = "T-MT", pool = Pool.MT, forms = listOf("ضَحِكَتْ", "شَكَرَ"))
        val vt = base.copy(itemId = "T-VT", pool = Pool.TRANS, forms = listOf("ضَحِكَتْ"))
        assertEquals(listOf(Freshness.FormClash("T-VT", "T-MT", "ضَحِكَتْ")), Freshness.findFormClashes(listOf(mt, vt)))
        assertEquals(emptyList(), Freshness.findFormClashes(items))
    }

    @Test
    fun `items for another audience are not served (new)`() {
        val kids = item("DEMO-P02").copy(itemId = "T-KIDS", audience = id.petalytix.ayailmu.core.model.Audience.KIDS)
        val adults = FreshContext("2026-10-15", emptyList(), rules, audience = id.petalytix.ayailmu.core.model.Audience.ADULTS)
        assertFalse(Freshness.isEligibleFresh(kids, adults))
        assertTrue(Freshness.isEligibleFresh(kids, ctx("2026-10-15")))
    }

    @Test
    fun `v2-only item types are not served until a renderer exists (new, CR-ENG-5)`() {
        val v2 = item("DEMO-P02").copy(itemId = "T-V2", type = id.petalytix.ayailmu.core.model.ItemType.TAP_HOTSPOT)
        assertFalse(Freshness.isEligibleFresh(v2, ctx("2026-10-15")))
    }
}
