package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random

/** Every v1 type in the bundled packs maps to a renderer, in both instruction languages. */
class StepMapperTest {
    private val math = TestPacks.math
    private val arabic = TestPacks.arabic

    private fun mathQuestion(
        id: String,
        lang: Lang = Lang.ID,
    ) = StepMapper.map(TestPacks.stateAt(id, "mat", lang), math.content, lang, targetLang = null) as StepUi.Question

    private fun arabicQuestion(id: String) = StepMapper.map(TestPacks.stateAt(id, "arab"), arabic.content, Lang.ID, targetLang = "ar") as StepUi.Question

    @Test
    fun `no item in the bundled packs falls through to the unsupported renderer`() {
        (math.content.items + arabic.content.items).forEach { item ->
            assertTrue("${item.itemId} has no renderer", StepMapper.kindOf(item) != RenderKind.UNSUPPORTED)
        }
    }

    @Test
    fun `math item types map to their renderers`() {
        assertEquals(RenderKind.CHOICE, mathQuestion("MAT-K-P-01-001").kind)
        assertEquals(RenderKind.CHOICE, mathQuestion("MAT-K-P-01-002").kind)
        assertEquals(RenderKind.CHOICE, mathQuestion("MAT-K-P-01-003").kind)
        assertEquals(RenderKind.NUMBER, mathQuestion("MAT-K-P-01-004").kind)
        assertEquals(RenderKind.GEM, mathQuestion("MAT-K-P-01-006").kind)
        assertEquals(RenderKind.PAIRS, mathQuestion("MAT-K-P-01-007").kind)
        assertEquals(RenderKind.BUCKETS, mathQuestion("MAT-K-P-01-008").kind)
        assertEquals(RenderKind.SEQUENCE, mathQuestion("MAT-K-P-01-009").kind)
    }

    @Test
    fun `sequence, pairs and buckets carry what their renderers need`() {
        val order = mathQuestion("MAT-K-P-01-005")
        assertEquals(RenderKind.SEQUENCE, order.kind)
        assertEquals(4, order.slots)
        assertEquals(4, order.options.size)

        val pairs = mathQuestion("MAT-K-P-01-007")
        assertEquals(listOf("n25", "n52", "n15"), pairs.left.map { it.id })
        assertEquals(setOf("w25", "w52", "w15"), pairs.right.map { it.id }.toSet())

        val buckets = mathQuestion("MAT-K-P-01-008")
        assertEquals(listOf("n14", "n27", "n30", "n9"), buckets.left.map { it.id })
        assertEquals(listOf("b_even", "b_odd"), buckets.right.map { it.id })
    }

    @Test
    fun `instruction language picks the prompt and the gem text`() {
        assertEquals("Ada berapa?", mathQuestion("MAT-K-P-01-001", Lang.ID).prompt)
        assertEquals("How many?", mathQuestion("MAT-K-P-01-001", Lang.EN).prompt)
        assertTrue(mathQuestion("MAT-K-P-01-006", Lang.EN).cardText!!.startsWith("An hour has 60 minutes"))
    }

    @Test
    fun `help lines show the target word only on language tracks`() {
        val math4 = mathQuestion("MAT-K-P-01-004")
        assertNull(math4.help.single().word)
        assertEquals("5 puluhan dan 8 satuan = ?", math4.help.single().meaning)

        val form = arabicQuestion("DEMO-F01")
        assertEquals(RenderKind.CHOICE, form.kind)
        assertEquals("نَادِمٌ", form.help.single().word)
        assertTrue(form.options.all { it.target != null })
    }

    @Test
    fun `arabic typed items split into meaning and paraphrase renderers`() {
        assertEquals(RenderKind.TYPED, arabicQuestion("DEMO-M01").kind)
        val para = arabicQuestion("DEMO-P01")
        assertEquals(RenderKind.PARAPHRASE, para.kind)
        assertEquals("هِيَ مُؤْمِنَةٌ", para.target)
    }

    @Test
    fun `a session's first step is the lesson screen, with its clue paragraph`() {
        val state =
            Session.start(
                StartArgs(
                    content = arabic.content,
                    rules = arabic.rules,
                    history = emptyList(),
                    learnerId = "lrn-1",
                    lang = Lang.ID,
                    audience = Audience.ADULTS,
                    nowEpochMs = Instant.parse("2026-10-17T02:00:00Z").toEpochMilli(),
                    zone = ZoneId.of("Asia/Jakarta"),
                    budgetMinutes = 10,
                    screensSeen = listOf("DEMO-S1", "DEMO-S2"),
                    appVersion = "test",
                    random = Random(1),
                ),
            )
        val screen = StepMapper.map(state, arabic.content, Lang.ID, "ar") as StepUi.Screen
        assertEquals("DEMO-S3", screen.screenId)
        assertEquals(2, screen.clueIndex)
        assertEquals(2, screen.examples.size)
    }
}
