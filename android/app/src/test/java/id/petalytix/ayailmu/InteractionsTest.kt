package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.content.StrokeIndex
import id.petalytix.ayailmu.core.content.StrokePoint
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.interact.DropTargets
import id.petalytix.ayailmu.feature.session.interact.HitBox
import id.petalytix.ayailmu.feature.session.interact.PairBoard
import id.petalytix.ayailmu.feature.session.interact.PairPick
import id.petalytix.ayailmu.feature.session.interact.PencilPath
import id.petalytix.ayailmu.feature.session.interact.Segment
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import id.petalytix.ayailmu.feature.session.interact.TargetScript
import id.petalytix.ayailmu.feature.session.interact.TraceMatcher
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.random.Random

/** Follow-up 11 interactions: the pure rules behind connect, drag, baskets, slots and tracing. */
class InteractionsTest {
    // ---- pairs ----

    @Test
    fun `pair board - tap then tap links either way round, and a second tap puts the card down`() {
        val links = mutableMapOf<String, String>()
        var t = PairBoard.tap(links, null, PairPick("n1", left = true), oneToOne = true)
        assertEquals(PairBoard.Event.PICKED, t.event)
        t = PairBoard.tap(links, t.pick, PairPick("n1", left = true), oneToOne = true)
        assertEquals(PairBoard.Event.UNPICKED, t.event)
        assertNull(t.pick)
        // Right card first, then its partner on the left.
        t = PairBoard.tap(links, null, PairPick("w2", left = false), oneToOne = true)
        assertEquals(PairBoard.Event.PICKED, t.event)
        t = PairBoard.tap(links, t.pick, PairPick("n2", left = true), oneToOne = true)
        assertEquals(PairBoard.Event.LINKED, t.event)
        assertEquals(mapOf("n2" to "w2"), links)
        // Picking another card on the same side switches the pick.
        t = PairBoard.tap(links, null, PairPick("n1", left = true), oneToOne = true)
        t = PairBoard.tap(links, t.pick, PairPick("n3", left = true), oneToOne = true)
        assertEquals(PairBoard.Event.SWITCHED, t.event)
        assertEquals(PairPick("n3", left = true), t.pick)
    }

    @Test
    fun `pair board - tapping a connected card removes the link and keeps it picked`() {
        val links = mutableMapOf("n1" to "w1", "n2" to "w2")
        val left = PairBoard.tap(links, null, PairPick("n1", left = true), oneToOne = true)
        assertEquals(PairBoard.Event.UNLINKED, left.event)
        assertEquals(PairPick("n1", left = true), left.pick)
        assertEquals(mapOf("n2" to "w2"), links)
        val right = PairBoard.tap(links, null, PairPick("w2", left = false), oneToOne = true)
        assertEquals(PairBoard.Event.UNLINKED, right.event)
        assertTrue(links.isEmpty())
    }

    @Test
    fun `pair board - one-to-one steals the partner, baskets take many and are never picked`() {
        val links = mutableMapOf("n1" to "w1")
        assertTrue(PairBoard.link(links, "n2", "w1", oneToOne = true))
        assertEquals(mapOf("n2" to "w1"), links)
        assertFalse(PairBoard.link(links, "n2", "w1", oneToOne = true))

        val baskets = mutableMapOf<String, String>()
        PairBoard.link(baskets, "n1", "even", oneToOne = false)
        PairBoard.link(baskets, "n2", "even", oneToOne = false)
        assertEquals(listOf("n1", "n2"), PairBoard.inTarget(baskets, "even", listOf("n1", "n2", "n3")))
        val tapBasket = PairBoard.tap(baskets, null, PairPick("even", left = false), oneToOne = false)
        assertEquals(PairBoard.Event.NONE, tapBasket.event)
        assertNull(tapBasket.pick)
        assertEquals(2, baskets.size)
        // Move a card from one basket to another by picking it and tapping the other basket.
        val picked = PairBoard.tap(baskets, null, PairPick("n2", left = true), oneToOne = false)
        PairBoard.tap(baskets, picked.pick, PairPick("odd", left = false), oneToOne = false)
        assertEquals(mapOf("n1" to "even", "n2" to "odd"), baskets)
    }

    @Test
    fun `pair board - pairings only once every left card is placed, in left order`() {
        val links = mutableMapOf("n2" to "w2")
        assertNull(PairBoard.pairings(links, listOf("n1", "n2")))
        PairBoard.link(links, "n1", "w1", oneToOne = true)
        assertEquals(
            listOf(Response.Pairing("n1", "w1"), Response.Pairing("n2", "w2")),
            PairBoard.pairings(links, listOf("n1", "n2")),
        )
        assertNull(PairBoard.pairings(links, emptyList()))
        assertTrue(PairBoard.unlink(links, "n1"))
        assertFalse(PairBoard.unlink(links, "n1"))
    }

    // ---- drop targets ----

    @Test
    fun `drop targets - the smallest target under the finger wins, near misses land within the slop`() {
        val t = DropTargets()
        t.put("basket", HitBox(0f, 0f, 200f, 200f))
        t.put("slot", HitBox(20f, 20f, 60f, 60f))
        t.put("other", HitBox(300f, 0f, 400f, 100f))
        assertEquals("slot", t.hit(30f, 30f))
        assertEquals("basket", t.hit(150f, 150f))
        assertNull(t.hit(250f, 50f))
        assertEquals("other", t.hit(280f, 50f, slop = 24f))
        assertEquals("basket", t.hit(210f, 50f, slop = 24f))
        assertEquals("other", t.hit(30f, 30f, slop = 400f, among = listOf("other")))
        t.remove("slot")
        assertEquals("basket", t.hit(30f, 30f))
        assertEquals(setOf("basket", "other"), t.ids)
    }

    @Test
    fun `drop targets - a tap near a pencil line finds that line`() {
        val lines = mapOf("a" to Segment(0f, 0f, 100f, 0f), "b" to Segment(0f, 50f, 100f, 100f))
        assertEquals("a", DropTargets.nearestLine(50f, 8f, lines, maxDistance = 20f))
        assertEquals("b", DropTargets.nearestLine(50f, 70f, lines, maxDistance = 20f))
        assertNull(DropTargets.nearestLine(50f, 30f, lines, maxDistance = 10f))
        assertEquals(5f, DropTargets.distanceToSegment(-3f, 4f, Segment(0f, 0f, 10f, 0f)), 1e-4f)
    }

    // ---- sequence slots ----

    @Test
    fun `slots - drop puts a tile in place, reorders placed tiles, and swaps when full`() {
        val placed = mutableListOf<String>()
        assertTrue(SlotBoard.drop(placed, "a", 3, 4)) // beyond the filled places = at the end
        SlotBoard.drop(placed, "b", 3, 4)
        SlotBoard.drop(placed, "c", 0, 4) // in front, the others move on
        assertEquals(listOf("c", "a", "b"), placed)
        assertTrue(SlotBoard.drop(placed, "c", 2, 4)) // reorder by dragging
        assertEquals(listOf("a", "b", "c"), placed)
        assertFalse(SlotBoard.drop(placed, "b", 1, 4))
        SlotBoard.drop(placed, "d", 3, 4)
        assertTrue(SlotBoard.drop(placed, "e", 1, 4)) // full: e swaps b out
        assertEquals(listOf("a", "e", "c", "d"), placed)
        assertTrue(SlotBoard.takeBack(placed, "e"))
        assertEquals(listOf("a", "c", "d"), placed)
        assertFalse(SlotBoard.drop(placed, "x", 0, 0))
    }

    @Test
    fun `slots - tap places in the next place and takes a placed tile back`() {
        val placed = mutableListOf<String>()
        assertTrue(SlotBoard.tap(placed, "a", 2))
        assertTrue(SlotBoard.tap(placed, "b", 2))
        assertFalse(SlotBoard.tap(placed, "c", 2))
        assertTrue(SlotBoard.tap(placed, "a", 2))
        assertEquals(listOf("b"), placed)
    }

    @Test
    fun `fill blank sentences split at runs of underscores`() {
        assertEquals(listOf("Kita berpikir dengan ", "."), SlotBoard.splitBlanks("Kita berpikir dengan ____."))
        assertEquals(listOf("", " + ", " = 10"), SlotBoard.splitBlanks("__ + ___ = 10"))
        assertEquals(listOf("no_gap here"), SlotBoard.splitBlanks("no_gap here"))
        assertEquals(listOf("Kita berpikir dengan ", "."), SlotBoard.inlineBlank("Kita berpikir dengan ____.", 1))
        assertNull(SlotBoard.inlineBlank("Kita berpikir dengan ____.", 2))
        assertNull(SlotBoard.inlineBlank(null, 1))
        // Japanese and Chinese write the gap with full-width low lines; one is enough.
        assertEquals(listOf("これは ", "です。"), SlotBoard.splitBlanks("これは ＿＿です。"))
        assertEquals(listOf("一 yī、", "、三 sān"), SlotBoard.splitBlanks("一 yī、＿、三 sān"))
        assertTrue(SlotBoard.hasBlank("I ___ like fish."))
        assertFalse(SlotBoard.hasBlank("snake_case"))
        assertFalse(SlotBoard.hasBlank(null))
    }

    // ---- trace ----

    private val strokes: StrokeIndex by lazy {
        val stream = requireNotNull(javaClass.classLoader!!.getResourceAsStream("strokes/index.json")) { "strokes/index.json" }
        StrokeIndex.parse(stream.use { it.readBytes().decodeToString() })
    }

    private fun stroke(
        key: String,
        index: Int,
    ): List<StrokePoint> = requireNotNull(strokes.keys[key]) { key }.polylines()[index]

    /** A child's finger: densely sampled, wobbling, a little off to one side, starting and ending a bit early or late. */
    private fun shaky(
        path: List<StrokePoint>,
        seed: Int,
        offset: Double = 0.04,
        wobble: Double = 0.035,
    ): List<StrokePoint> {
        val rnd = Random(seed)
        return TraceMatcher.resample(path, 60).mapIndexed { i, p ->
            val a = i * 0.7 + rnd.nextDouble() * 0.6
            StrokePoint(p.x + offset + sin(a) * wobble, p.y - offset / 2 + cos(a * 1.3) * wobble)
        }
    }

    @Test
    fun `trace - a clean stroke and a shaky child stroke both count`() {
        val all = strokes.keys.filterKeys { it in setOf("hira_a", "hangul_g", "hanzi_shi", "hangul_ng", "hira_su") }
        assertEquals(5, all.size)
        all.forEach { (key, glyph) ->
            glyph.polylines().forEachIndexed { i, s ->
                assertEquals("$key stroke $i clean", TraceMatcher.Verdict.OK, TraceMatcher.check(s, s))
                assertEquals("$key stroke $i shaky", TraceMatcher.Verdict.OK, TraceMatcher.check(s, shaky(s, seed = i + 7)))
            }
        }
    }

    @Test
    fun `trace - reversed strokes do not count, including a closed circle`() {
        val line = stroke("hanzi_shi", 0)
        assertFalse(TraceMatcher.matches(line, line.reversed()))
        val circle = stroke("hangul_ng", 0)
        assertEquals(TraceMatcher.Verdict.DIRECTION, TraceMatcher.check(circle, circle.reversed()))
        assertTrue(TraceMatcher.matches(circle, shaky(circle, seed = 3)))
    }

    @Test
    fun `trace - strokes far away, detours and taps do not count`() {
        val s = stroke("hira_a", 0)
        val moved = s.map { StrokePoint(it.x, it.y + 0.3) }
        assertEquals(TraceMatcher.Verdict.START, TraceMatcher.check(s, moved))
        val detour = listOf(s.first(), StrokePoint(0.5, 0.95), s.last())
        assertEquals(TraceMatcher.Verdict.FAR, TraceMatcher.check(s, detour))
        assertEquals(TraceMatcher.Verdict.TOO_SHORT, TraceMatcher.check(s, listOf(s.first(), s.first())))
        val tooEarly = TraceMatcher.resample(s, 20).take(6)
        assertEquals(TraceMatcher.Verdict.END, TraceMatcher.check(s, tooEarly))
        // A small wiggle at the top of the circle starts and ends right but does not go round it.
        val circle = stroke("hangul_ng", 0)
        val wiggle = listOf(circle.first(), StrokePoint(0.42, 0.24), StrokePoint(0.47, 0.26), StrokePoint(0.53, 0.24), circle.last())
        assertEquals(TraceMatcher.Verdict.COVERAGE, TraceMatcher.check(circle, wiggle))
    }

    @Test
    fun `trace - resampling keeps both ends and spaces points evenly`() {
        val path = listOf(StrokePoint(0.0, 0.0), StrokePoint(0.1, 0.0), StrokePoint(0.1, 0.9))
        val r = TraceMatcher.resample(path, 11)
        assertEquals(11, r.size)
        assertEquals(path.first(), r.first())
        assertEquals(path.last(), r.last())
        r.zipWithNext { a, b -> assertEquals(0.1, hypot(a.x - b.x, a.y - b.y), 1e-9) }
        assertEquals(0.5, TraceMatcher.progressAlong(StrokePoint(0.2, 0.4), path), 1e-9)
    }

    // ---- pencil lines and target text ----

    @Test
    fun `pencil path - same link same line, ends meet the dots, the wobble stays small`() {
        val a = PencilPath.points(10f, 20f, 210f, 120f, PencilPath.seedOf("n1", "w1"))
        val b = PencilPath.points(10f, 20f, 210f, 120f, PencilPath.seedOf("n1", "w1"))
        assertArrayEquals(a, b, 0f)
        assertEquals((PencilPath.SEGMENTS + 1) * 2, a.size)
        assertEquals(10f, a[0], 0f)
        assertEquals(20f, a[1], 0f)
        assertEquals(210f, a[a.size - 2], 1e-3f)
        assertEquals(120f, a[a.size - 1], 1e-3f)
        val other = PencilPath.points(10f, 20f, 210f, 120f, PencilPath.seedOf("n2", "w1"))
        assertNotEquals(a.toList(), other.toList())
        val len = hypot(200f, 100f)
        val chord = Segment(10f, 20f, 210f, 120f)
        for (i in a.indices step 2) {
            assertTrue(DropTargets.distanceToSegment(a[i], a[i + 1], chord) <= len * (PencilPath.BEND + PencilPath.JITTER))
        }
        assertArrayEquals(floatArrayOf(5f, 5f, 5f, 5f), PencilPath.points(5f, 5f, 5f, 5f, "x"), 0f)
        assertEquals(1f, PencilPath.width(0f, 1f, 3f), 1e-6f)
        assertEquals(3f, PencilPath.width(0.5f, 1f, 3f), 1e-6f)
    }

    @Test
    fun `target text locale picks the right Han forms, Arabic keeps its style`() {
        assertEquals("ja-JP", TargetScript.localeTag("ja"))
        assertEquals("zh-Hans-CN", TargetScript.localeTag("zh"))
        assertEquals("ko-KR", TargetScript.localeTag("ko"))
        assertEquals("en", TargetScript.localeTag("en"))
        assertNull(TargetScript.localeTag(null))
        assertTrue(TargetScript.usesArabicStyle("ar"))
        assertTrue(TargetScript.usesArabicStyle(null))
        assertFalse(TargetScript.usesArabicStyle("ja"))
    }
}
