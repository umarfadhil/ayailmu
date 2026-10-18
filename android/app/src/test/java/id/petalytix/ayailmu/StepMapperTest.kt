package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.content.ChoiceOption
import id.petalytix.ayailmu.core.content.Gestures
import id.petalytix.ayailmu.core.content.HelpLine
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    private fun mapped(
        item: Item,
        targetLang: String? = null,
    ) = StepMapper.question(item, Step.Role.PRACTICE, math.content, Lang.ID, targetLang)

    private fun item(
        type: ItemType,
        options: List<ChoiceOption> = emptyList(),
    ) = Item(itemId = "FU11-1", unit = "01", type = type, pool = Pool.PRACT, promptId = "P-X", options = options, contentVersion = "t")

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

    // ---- follow-up 11: gestures, listening, tracing, reading aids ----

    @Test
    fun `pairs and sequences carry their gesture, with the type's default when the item leaves it out`() {
        assertEquals(Gestures.CONNECT, mathQuestion("MAT-K-P-01-007").gesture)
        assertEquals(Gestures.DRAG, mathQuestion("MAT-K-P-01-008").gesture)
        assertEquals(Gestures.DRAG, mathQuestion("MAT-K-P-01-005").gesture)
        assertNull(mathQuestion("MAT-K-P-01-001").gesture)
        assertEquals(Gestures.DRAG, mapped(math.content.item("MAT-K-P-01-007").copy(gesture = Gestures.DRAG)).gesture)
        assertEquals(Gestures.TAP, mapped(math.content.item("MAT-K-P-01-005").copy(gesture = Gestures.TAP)).gesture)
    }

    @Test
    fun `trace items get the trace renderer with their stroke key and reading aids`() {
        val trace =
            item(ItemType.TRACE).copy(trace = "hira_a", targetText = "あ", romanization = "a", audio = "ja/a")
        assertEquals(RenderKind.TRACE, StepMapper.kindOf(trace))
        val q = mapped(trace, targetLang = "ja")
        assertEquals(RenderKind.TRACE, q.kind)
        assertEquals("hira_a", q.trace)
        assertEquals("あ", q.target)
        assertEquals("a", q.romanization)
        assertEquals("ja/a", q.audio)
        assertEquals("ja", q.targetLang)
        assertFalse(q.listen)
        assertTrue(q.options.isEmpty())
        assertNull(q.gesture)
    }

    @Test
    fun `audio match is a choice with a listen button, and options carry clips and readings`() {
        val options =
            listOf(
                ChoiceOption(id = "a", image = "fruit_apple", audio = "ko/sagwa", romanization = "sagwa", correct = true),
                ChoiceOption(id = "b", targetText = "물", romanization = "mul"),
            )
        val listening = item(ItemType.AUDIO_MATCH, options).copy(audio = "ko/sagwa")
        val q = mapped(listening, targetLang = "ko")
        assertEquals(RenderKind.CHOICE, q.kind)
        assertTrue(q.listen)
        assertEquals("ko/sagwa", q.audio)
        assertFalse(q.audioMissing)
        assertEquals(listOf("ko/sagwa", null), q.options.map { it.audio })
        assertEquals(listOf("sagwa", "mul"), q.options.map { it.romanization })
        // No clip key at all: answered as "audio unavailable", never the learner's fault.
        assertTrue(mapped(listening.copy(audio = null)).audioMissing)
        assertFalse(mapped(item(ItemType.CHOOSE, options)).listen)
    }

    @Test
    fun `fill blank points at the help line with the gap`() {
        val gap = LocalizedText("Kita berpikir dengan ____.", "We think with our ____.")
        val fill =
            item(ItemType.FILL_BLANK, listOf(ChoiceOption(id = "t1", text = LocalizedText("otak", "brain")))).copy(
                helpLines = listOf(HelpLine("", LocalizedText("Petunjuk", "Hint")), HelpLine("", gap)),
                solution = listOf("t1"),
            )
        val q = mapped(fill)
        assertEquals(RenderKind.SEQUENCE, q.kind)
        assertEquals(1, q.blankLine)
        assertFalse(q.blankInTarget)
        assertEquals(1, q.slots)
        assertNull(mapped(item(ItemType.ORDER)).blankLine)
        // Language tracks write the gap in the target sentence.
        val target = mapped(fill.copy(targetText = "＿＿が すき！", romanization = "... ga suki!"), targetLang = "ja")
        assertTrue(target.blankInTarget)
        assertNull(target.blankLine)
        assertEquals(listOf("", "が すき！"), SlotBoard.inlineParts(target))
        assertNull(SlotBoard.inlineParts(target.copy(gesture = Gestures.TAP)))
    }
}
