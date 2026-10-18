package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Pool
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Follow-up 11 schema and validator rules (docs/content/INTERACTIONS_AUDIO.md sections 2, 3.1 and 4). */
class InteractionsValidatorTest {
    private val sample: ContentPack by lazy { Fixtures.load("fixtures/lang-sample-v1.json") }
    private val strokes: StrokeIndex by lazy { loadStrokes("fixtures/strokes-sample.json") }

    private fun loadStrokes(resource: String): StrokeIndex {
        val stream = requireNotNull(javaClass.classLoader.getResourceAsStream(resource)) { "missing test resource $resource" }
        return stream.use { StrokeIndex.parse(it.readBytes().toString(Charsets.UTF_8)) }
    }

    private fun item(id: String): Item = sample.items.first { it.itemId == id }

    /** Problems of the sample pack after replacing one item. */
    private fun problemsWith(
        changed: Item,
        index: StrokeIndex? = null,
    ): List<PackProblem> {
        val items = sample.items.map { if (it.itemId == changed.itemId) changed else it }
        return PackValidator.validate(sample.copy(items = items), strokes = index)
    }

    private fun messages(
        changed: Item,
        index: StrokeIndex? = null,
    ): String = problemsWith(changed, index).joinToString("\n")

    private val trace = "JPN-T-P-01-001"
    private val listen = "JPN-T-P-01-002"
    private val matchDrag = "JPN-T-P-01-003"
    private val matchDefault = "JPN-T-P-01-004"
    private val sort = "JPN-T-P-01-005"
    private val order = "JPN-T-P-01-006"

    // ---- decoding -----------------------------------------------------------------------------------

    @Test
    fun `the follow-up 11 sample decodes with its new fields and is valid with and without a strokes index`() {
        val t = item(trace)
        assertEquals(ItemType.TRACE, t.type)
        assertTrue(t.isTrace)
        assertEquals("hira_a", t.trace)
        assertEquals("a", t.romanization)
        assertEquals("ja/a", t.audio)
        assertEquals("drag", item(matchDrag).gesture)
        val word = item(matchDrag).options.first { it.id == "w_ringo" }
        assertEquals("ja/ringo", word.audio)
        assertEquals("ringo", word.romanization)
        assertEquals(emptyList(), PackValidator.validate(sample))
        assertEquals(emptyList(), PackValidator.validate(sample, strokes = strokes))
    }

    @Test
    fun `trace is a practice-only type with its own renderer`() {
        assertEquals(ItemType.Renderer.TRACE, ItemType.TRACE.renderer)
        assertFalse(ItemType.TRACE.evidenceCapable)
        assertTrue(ItemType.TRACE.isV1)
        val t = item(trace)
        assertFalse(t.isSequence || t.isPairs || t.isChoiceFamily || t.isNumeric || t.isTyped)
    }

    @Test
    fun `old fixtures still decode, carry none of the new fields and re-encode without them`() {
        for (pack in listOf(Fixtures.math(), Fixtures.arabic())) {
            assertEquals(emptyList(), PackValidator.validate(pack))
            assertTrue(pack.items.all { it.gesture == null && it.romanization == null && it.trace == null })
            assertTrue(pack.items.flatMap { it.options }.all { it.audio == null && it.romanization == null })
            val text = PackLoader.encode(pack)
            assertFalse("\"gesture\"" in text || "\"romanization\"" in text || "\"trace\"" in text)
        }
    }

    // ---- gesture ------------------------------------------------------------------------------------

    @Test
    fun `gestures follow the per-type table`() {
        val m = item(matchDrag)
        assertEquals(emptyList(), problemsWith(m.copy(gesture = "connect")))
        assertEquals(emptyList(), problemsWith(m.copy(gesture = "drag")))
        assertTrue("gesture tap is not allowed here (match_pairs takes only connect|drag)" in messages(m.copy(gesture = "tap")))

        val s = item(sort)
        assertEquals(emptyList(), problemsWith(s.copy(gesture = "drag")))
        assertTrue("not allowed" in messages(s.copy(gesture = "connect")))
        assertTrue("not allowed" in messages(s.copy(gesture = "tap")))

        for (type in listOf(ItemType.ORDER, ItemType.TILES, ItemType.FILL_BLANK)) {
            val o = item(order).copy(type = type)
            assertEquals(emptyList(), problemsWith(o.copy(gesture = "drag")), type.name)
            assertEquals(emptyList(), problemsWith(o.copy(gesture = "tap")), type.name)
            assertTrue("not allowed" in messages(o.copy(gesture = "connect")), type.name)
        }
    }

    @Test
    fun `a gesture on any other type, or an unknown gesture, is a problem`() {
        assertTrue("audio_match takes no gesture" in messages(item(listen).copy(gesture = "drag")))
        assertTrue("trace takes no gesture" in messages(item(trace).copy(gesture = "tap")))
        assertTrue("unknown gesture swipe" in messages(item(matchDrag).copy(gesture = "swipe")))
        assertTrue("unknown gesture Drag" in messages(item(sort).copy(gesture = "Drag")))
    }

    @Test
    fun `the renderer default applies when gesture is left out`() {
        assertEquals("connect", item(matchDefault).effectiveGesture)
        assertEquals("drag", item(matchDrag).effectiveGesture)
        assertEquals("drag", item(sort).copy(gesture = null).effectiveGesture)
        assertEquals("tap", item(order).effectiveGesture)
        assertEquals("drag", item(order).copy(gesture = null).effectiveGesture)
        assertNull(item(listen).effectiveGesture)
        assertNull(item(trace).effectiveGesture)
    }

    // ---- clip keys and romanization -----------------------------------------------------------------

    @Test
    fun `clip keys must be lang slash slug`() {
        for (ok in listOf("ja/ringo", "zh/ni_hao", "ko/annyeonghaseyo", "en/apple2")) assertTrue(PackValidator.isClipKey(ok), ok)
        val bad = listOf("ringo", "JA/ringo", "ja/Ringo", "jpn/ringo", "ja/ringo.mp3", "ja/", "ja/ringo/x", "ja/rin go", "ja/ringo-2")
        for (key in bad) {
            assertFalse(PackValidator.isClipKey(key), key)
            val onItem = problemsWith(item(listen).copy(audio = key))
            assertEquals(listOf(listen), onItem.map { it.path }, key)
            assertTrue("audio clip key $key" in onItem.single().message, key)
        }
        val m = item(matchDrag)
        val broken = m.copy(options = m.options.map { if (it.id == "w_neko") it.copy(audio = "neko") else it })
        assertEquals(listOf("$matchDrag.option.w_neko"), problemsWith(broken).map { it.path })
    }

    @Test
    fun `romanization, when present, must not be blank`() {
        assertTrue("romanization must not be blank" in messages(item(trace).copy(romanization = " ")))
        val m = item(matchDrag)
        val broken = m.copy(options = m.options.map { if (it.id == "w_ringo") it.copy(romanization = "") else it })
        assertEquals(listOf("$matchDrag.option.w_ringo"), problemsWith(broken).map { it.path })
    }

    // ---- audio_match --------------------------------------------------------------------------------

    @Test
    fun `audio_match accepts picture options, text options and still needs its clip`() {
        val a = item(listen)
        assertTrue(a.options.all { it.image != null && it.text == null && it.targetText == null })
        assertEquals(emptyList(), problemsWith(a))
        val words =
            a.copy(
                options =
                    listOf(
                        ChoiceOption("ringo", targetText = "りんご", correct = true),
                        ChoiceOption("neko", text = LocalizedText("kucing", "cat")),
                    ),
            )
        assertEquals(emptyList(), problemsWith(words))
        assertTrue("audio_match needs an audio asset" in messages(a.copy(audio = null)))
    }

    // ---- trace --------------------------------------------------------------------------------------

    @Test
    fun `a trace item needs a trace key, no options and no solution`() {
        val t = item(trace)
        assertTrue("trace item needs a trace key" in messages(t.copy(trace = null)))
        assertTrue("trace item needs a trace key" in messages(t.copy(trace = "")))
        assertTrue("trace items take no options" in messages(t.copy(options = listOf(ChoiceOption("a", targetText = "あ")))))
        assertTrue("trace items take no solution" in messages(t.copy(solution = listOf("1", "2", "3"))))
    }

    @Test
    fun `trace keys are checked against the strokes index only when one is supplied`() {
        val unknown = item(trace).copy(trace = "hira_xx")
        assertEquals(emptyList(), problemsWith(unknown))
        assertEquals(listOf("unknown trace key hira_xx"), problemsWith(unknown, strokes).map { it.message })
        assertEquals(emptyList(), problemsWith(item(trace).copy(trace = "hira_i"), strokes))
    }

    @Test
    fun `a trace key on a non-trace item is a problem`() {
        assertTrue("trace key on a non-trace item (order)" in messages(item(order).copy(trace = "hira_a")))
        assertTrue("trace key on a non-trace item (audio_match)" in messages(item(listen).copy(trace = "hira_a")))
    }

    @Test
    fun `a trace may sit in REMED like any practice item`() {
        val remed = sample.items.first { it.pool == Pool.REMED && it.isTrace }
        assertEquals("hira_i", remed.trace)
        assertEquals(emptyList(), PackValidator.validate(sample, strokes = strokes))
    }

    // ---- strokes index ------------------------------------------------------------------------------

    @Test
    fun `the strokes index decodes glyphs, scripts and polylines`() {
        assertEquals(setOf("hira_a", "hira_i"), strokes.keys.keys)
        val a = strokes.keys.getValue("hira_a")
        assertEquals("あ", a.glyph)
        assertEquals("hiragana", a.script)
        assertEquals(3, a.strokes.size)
        assertEquals(StrokePoint(0.25, 0.30), a.polylines().first().first())
        assertEquals(emptyList(), strokes.problems())
    }

    @Test
    fun `a malformed strokes index reports each problem`() {
        val bad =
            StrokeIndex.parse(
                """{"keys": {"x": {"glyph": " ", "strokes": []},
                   "y": {"glyph": "y", "strokes": [[[0.1, 0.1]], [[0.1, 0.1], [1.2, 0.5]], [[0.1], [0.2, 0.2]]]}}}""",
            )
        val found = bad.problems().map { "${it.path} ${it.message}" }
        assertTrue("strokes.x glyph must not be blank" in found, found.toString())
        assertTrue("strokes.x needs at least one stroke" in found, found.toString())
        assertTrue("strokes.y.stroke0 a stroke needs at least two points" in found, found.toString())
        assertTrue("strokes.y.stroke1 points must be [x, y] with coordinates in 0..1" in found, found.toString())
        assertTrue("strokes.y.stroke2 points must be [x, y] with coordinates in 0..1" in found, found.toString())
        assertEquals(listOf(1, 2, 1), bad.keys.getValue("y").polylines().map { it.size })
    }
}
