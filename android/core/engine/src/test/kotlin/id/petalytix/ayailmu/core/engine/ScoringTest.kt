package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.AcceptedAnswers
import id.petalytix.ayailmu.core.engine.EngineFixtures.arabicRules
import id.petalytix.ayailmu.core.engine.EngineFixtures.item
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.PartScore
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ported from prototype-expo/src/engine/__tests__/scoring.test.ts. */
class ScoringTest {
    private val rules = arabicRules
    private val id = Lang.ID

    private fun typed(
        raw: String,
        itemId: String,
    ) = Scoring.scoreTyped(raw, item(itemId).accepted.getValue("id"), rules, id)

    @Test
    fun `normalize lowercases, trims, strips punctuation and collapses spaces`() {
        assertEquals("dia jujur", Text.normalize("  Dia   JUJUR!!  "))
        assertEquals("mumin", Text.normalize("Mu'min."))
        assertEquals("orang yang sabar", Text.normalize("orang-yang, sabar"))
    }

    @Test
    fun `levenshtein counts single edits`() {
        assertEquals(1, Text.levenshtein("beriman", "berimen"))
        assertEquals(0, Text.levenshtein("sabar", "sabar"))
        assertEquals(2, Text.levenshtein("jujur", "jojor"))
    }

    @Test
    fun `accepts listed answers inside natural phrasings`() {
        assertEquals(Outcome.CORRECT, typed("jujur", "DEMO-M01").status)
        assertEquals(Outcome.CORRECT, typed("Orang yang jujur.", "DEMO-M01").status)
        assertEquals(Outcome.CORRECT, typed("berilmu", "DEMO-M02").status)
        assertEquals(Outcome.CORRECT, typed("orang yang mengetahui", "DEMO-M02").status)
    }

    @Test
    fun `allows one typo only in words of 5+ letters`() {
        assertEquals(Outcome.CORRECT, typed("berilmo", "DEMO-M02").status)
        assertEquals(Outcome.PENDING, typed("tahi", "DEMO-M02").status) // "tahu" is 4 letters: no tolerance
    }

    @Test
    fun `holds alim for human check with FA-ALIM`() {
        val s = typed("alim", "DEMO-M02")
        assertEquals(Outcome.PENDING, s.status)
        assertEquals("FA-ALIM", s.feedbackId)
    }

    @Test
    fun `does not accept a negated meaning`() {
        assertNotEquals(Outcome.CORRECT, typed("tidak tahu", "DEMO-M02").status)
    }

    @Test
    fun `holds unclear answers as pending, never wrong`() {
        assertEquals(Outcome.PENDING, typed("benar", "DEMO-M01").status)
        assertEquals(Outcome.PENDING, typed("xyz", "DEMO-M01").status)
        assertEquals(Outcome.PENDING, typed("", "DEMO-M01").status)
    }

    private val p01 = item("DEMO-P01") // هِيَ مُؤْمِنَةٌ, perempuan

    @Test
    fun `paraphrase is correct when who, description and describes are all right`() {
        val s = Scoring.scoreItem(p01, Response.typed("Dia orang yang beriman", Referent.PEREMPUAN), rules, id)
        assertEquals(Outcome.CORRECT, s.outcome)
        assertEquals(mapOf("who" to PartScore.CORRECT, "description" to PartScore.CORRECT, "describes" to PartScore.CORRECT), s.parts)
        assertNull(s.serious)
    }

    @Test
    fun `accepts natural non-possession phrasing orangnya`() {
        val s = Scoring.scoreItem(item("DEMO-P02"), Response.typed("orangnya saleh", Referent.LAKI_LAKI), rules, id)
        assertEquals(Outcome.CORRECT, s.outcome)
        assertEquals(emptyList(), s.errorTags)
    }

    @Test
    fun `flags a he-she swap as a serious mistake`() {
        val s = Scoring.scoreItem(p01, Response.typed("dia beriman", Referent.LAKI_LAKI), rules, id)
        assertEquals(Outcome.WRONG, s.outcome)
        assertEquals(PartScore.WRONG, s.parts["who"])
        assertEquals(PartScore.CORRECT, s.parts["description"])
        assertEquals(ErrorTag.WRONG_REFERENT, s.serious)
        assertTrue("FA-REF-HIYA" in s.feedbackIds)
    }

    @Test
    fun `marks a known possession reading wrong and serious`() {
        val s = Scoring.scoreItem(p01, Response.typed("keimanannya", Referent.PEREMPUAN), rules, id)
        assertEquals(Outcome.WRONG, s.outcome)
        assertEquals(PartScore.WRONG, s.parts["describes"])
        assertEquals(ErrorTag.POSSESSION, s.serious)
        assertTrue("FA-POS" in s.feedbackIds)
    }

    @Test
    fun `marks a known invented action wrong and serious`() {
        val s = Scoring.scoreItem(p01, Response.typed("dia berkata beriman", Referent.PEREMPUAN), rules, id)
        assertEquals(Outcome.WRONG, s.outcome)
        assertEquals(ErrorTag.INVENTED_ACTION, s.serious)
        assertTrue("FA-ACT" in s.feedbackIds)
    }

    @Test
    fun `holds a generic possession or action flag for human check instead of marking it wrong`() {
        val poss = Scoring.scoreItem(p01, Response.typed("milik dia beriman", Referent.PEREMPUAN), rules, id)
        assertEquals(Outcome.PENDING, poss.outcome)
        assertEquals(PartScore.PENDING, poss.parts["describes"])
        assertTrue(ErrorTag.POSSESSION in poss.errorTags)
        assertNull(poss.serious)

        val act = Scoring.scoreItem(p01, Response.typed("dia bilang beriman", Referent.PEREMPUAN), rules, id)
        assertEquals(Outcome.PENDING, act.outcome)
        assertTrue(ErrorTag.INVENTED_ACTION in act.errorTags)
    }

    @Test
    fun `never marks a negated paraphrase correct`() {
        for (text in listOf("dia tidak beriman", "dia tidak terlalu beriman", "dia belum menjadi orang yang beriman")) {
            assertEquals(Outcome.PENDING, Scoring.scoreTyped(text, p01.accepted.getValue("id"), rules, id).status, text)
            val s = Scoring.scoreItem(p01, Response.typed(text, Referent.PEREMPUAN), rules, id)
            assertEquals(Outcome.PENDING, s.outcome, text)
            assertEquals(PartScore.PENDING, s.parts["description"], text)
            assertEquals(PartScore.PENDING, s.parts["describes"], text)
        }
    }

    @Test
    fun `affirmative control for the negation regression is still correct`() {
        assertEquals(Outcome.CORRECT, Scoring.scoreTyped("dia beriman", p01.accepted.getValue("id"), rules, id).status)
    }

    @Test
    fun `accepts a negation that is part of an accepted term itself`() {
        val acc = AcceptedAnswers(terms = listOf("tidak tahu"))
        assertEquals(Outcome.CORRECT, Scoring.scoreTyped("orang yang tidak tahu", acc, rules, id).status)
        assertEquals(Outcome.PENDING, Scoring.scoreTyped("bukan orang yang tidak tahu", acc, rules, id).status)
    }

    @Test
    fun `treats Saya belum tahu as dont_know, not wrong`() {
        val s = Scoring.scoreItem(p01, Response.dontKnow(), rules, id)
        assertEquals(Outcome.DONT_KNOW, s.outcome)
        assertNull(s.serious)
    }

    @Test
    fun `form choice scores the -atun form for perempuan`() {
        val f01 = item("DEMO-F01")
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(f01, Response.choice("b"), rules, id).outcome)
        val wrong = Scoring.scoreItem(f01, Response.choice("a"), rules, id)
        assertEquals(Outcome.WRONG, wrong.outcome)
        assertEquals(listOf(ErrorTag.WRONG_FORM), wrong.errorTags)
        assertEquals(listOf("FA-FORM"), wrong.feedbackIds)
        assertNull(wrong.serious)
    }

    @Test
    fun `changing typo tolerance in config changes scoring without code changes`() {
        val strict = rules.copy(typoTolerance = RuleConfig.TypoTolerance(minWordLength = 5, maxEdits = 0))
        assertEquals(Outcome.PENDING, Scoring.scoreTyped("berilmo", item("DEMO-M02").accepted.getValue("id"), strict, id).status)
    }

    // ---- casual-mode types (new in the Kotlin engine) ---------------------------------------------------

    private val math = EngineFixtures.math
    private val mathRules = EngineFixtures.mathRules

    @Test
    fun `number input is correct within tolerance and wrong otherwise`() {
        val it = math.item("MAT-K-P-01-004") // 58
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(it, Response.number(58.0), mathRules, Lang.EN).outcome)
        val wrong = Scoring.scoreItem(it, Response.number(85.0), mathRules, Lang.EN)
        assertEquals(Outcome.WRONG, wrong.outcome)
        assertEquals(listOf(ErrorTag.CALCULATION), wrong.errorTags)
        assertEquals(listOf("FB-NO-TENS"), wrong.feedbackIds)
    }

    @Test
    fun `order items compare the whole sequence`() {
        val it = math.item("MAT-K-P-01-005")
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(it, Response.sequence(listOf("n19", "n23", "n32", "n41")), mathRules, id).outcome)
        assertEquals(Outcome.WRONG, Scoring.scoreItem(it, Response.sequence(listOf("n19", "n32", "n23", "n41")), mathRules, id).outcome)
    }

    @Test
    fun `pair items score each pair and the outcome is wrong if any pair is wrong`() {
        val it = math.item("MAT-K-P-01-007")
        val ok = Response.pairs(listOf(Response.Pairing("n25", "w25"), Response.Pairing("n52", "w52"), Response.Pairing("n15", "w15")))
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(it, ok, mathRules, id).outcome)
        val partly = Response.pairs(listOf(Response.Pairing("n25", "w52"), Response.Pairing("n52", "w25"), Response.Pairing("n15", "w15")))
        val s = Scoring.scoreItem(it, partly, mathRules, id)
        assertEquals(Outcome.WRONG, s.outcome)
        assertEquals(PartScore.CORRECT, s.parts["n15"])
        assertEquals(PartScore.WRONG, s.parts["n25"])
    }

    @Test
    fun `true_false is a two-option choice`() {
        val it = math.item("MAT-K-P-01-003")
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(it, Response.choice("f"), mathRules, Lang.EN).outcome)
        assertEquals(Outcome.WRONG, Scoring.scoreItem(it, Response.choice("t"), mathRules, Lang.EN).outcome)
    }

    @Test
    fun `info cards and gems are not assessed`() {
        val gem = math.item("MAT-K-P-01-006")
        val s = Scoring.scoreItem(gem, Response.choice("seen"), mathRules, id)
        assertEquals(Outcome.NOT_ASSESSED, s.outcome)
        assertEquals(listOf("FB-GEM"), s.feedbackIds)
    }
}
