package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.LocalizedText
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Follow-up 12: [MotionMath], the pure motion evaluation the story player calls every frame (MODULES_LEVELS_STORIES.md section 2). */
class MotionMathTest {
    private val eps = 1e-9

    private fun near(
        expected: Double,
        actual: Double,
        what: String = "",
        tolerance: Double = 1e-9,
    ) = assertTrue(abs(expected - actual) <= tolerance, "$what expected $expected, got $actual")

    /** Values of [f] at every 10 ms from 0 to [untilMs]. */
    private fun samples(
        untilMs: Long,
        f: (Long) -> Double,
    ): List<Double> = (0..untilMs step 10).map(f)

    private fun nonDecreasing(values: List<Double>) = values.zipWithNext().all { (a, b) -> b >= a - eps }

    private fun nonIncreasing(values: List<Double>) = values.zipWithNext().all { (a, b) -> b <= a + eps }

    @Test
    fun `no motion is the identity at any time and when final`() {
        for (m in listOf(null, Motion(), Motion(MotionType.NONE, ms = 500))) {
            assertEquals(Transform.IDENTITY, MotionMath.at(m, 0))
            assertEquals(Transform.IDENTITY, MotionMath.at(m, 12_345))
            assertEquals(Transform.IDENTITY, MotionMath.final(m))
            assertEquals(0L, MotionMath.endMs(m))
        }
    }

    @Test
    fun `defaults per type are within the validator limits`() {
        assertEquals(600, Motion(MotionType.FADE_IN).effectiveMs())
        assertEquals(5000, Motion(MotionType.ZOOM).effectiveMs())
        assertEquals(450, Motion(MotionType.FADE_IN, ms = 450).effectiveMs())
        assertEquals(0, Motion(MotionType.FADE_IN).effectiveDelayMs())
        assertEquals("bottom", Motion(MotionType.SLIDE_IN).effectiveFrom())
        assertEquals("left", Motion(MotionType.REVEAL).effectiveFrom())
        assertNull(Motion(MotionType.DRIFT, from = "left").effectiveFrom())
        assertEquals(1.06, Motion(MotionType.ZOOM).effectiveScaleTo())
        for (type in MotionType.entries) {
            val m = Motion(type, points = listOf(listOf(0.1, 0.1), listOf(0.5, 0.5)))
            assertEquals(emptyList(), PackValidator.motionProblems(m), type.name)
            assertEquals(emptyList(), PackValidator.motionProblems(m.copy(loop = true)), type.name)
        }
    }

    @Test
    fun `fade_in waits for its delay, eases in monotonically and ends fully visible`() {
        val m = Motion(MotionType.FADE_IN, ms = 600, delayMs = 300)
        assertEquals(0.0, MotionMath.at(m, 0).alpha)
        assertEquals(0.0, MotionMath.at(m, 300).alpha)
        assertTrue(MotionMath.at(m, 450).alpha in 0.5..0.99) // eased out: a quarter of the time, more than half visible
        assertEquals(1.0, MotionMath.at(m, 900).alpha)
        assertEquals(1.0, MotionMath.at(m, 60_000).alpha)
        assertTrue(nonDecreasing(samples(1200) { MotionMath.at(m, it).alpha }))
        assertEquals(Transform.IDENTITY, MotionMath.final(m))
        assertEquals(900L, MotionMath.endMs(m))
    }

    @Test
    fun `slide_in starts 15 percent away on its side and settles without overshoot`() {
        val bottom = Motion(MotionType.SLIDE_IN, ms = 600)
        near(0.15, MotionMath.at(bottom, 0).dy)
        assertEquals(0.0, MotionMath.at(bottom, 0).alpha)
        assertEquals(Transform.IDENTITY, MotionMath.at(bottom, 600))
        val dys = samples(800) { MotionMath.at(bottom, it).dy }
        assertTrue(nonIncreasing(dys))
        assertTrue(dys.all { it >= -eps }, "no overshoot past the place")
        assertTrue(nonDecreasing(samples(800) { MotionMath.at(bottom, it).alpha }))

        near(-0.15, MotionMath.at(bottom.copy(from = "left"), 0).dx)
        near(0.15, MotionMath.at(bottom.copy(from = "right"), 0).dx)
        near(-0.15, MotionMath.at(bottom.copy(from = "top"), 0).dy)
        assertEquals(Transform.IDENTITY, MotionMath.final(bottom.copy(from = "left", delayMs = 200)))
    }

    @Test
    fun `reveal wipes in from its side`() {
        val m = Motion(MotionType.REVEAL, ms = 1200)
        assertEquals(0.0, MotionMath.at(m, 0).revealFraction)
        assertEquals(1.0, MotionMath.at(m, 1200).revealFraction)
        assertTrue(nonDecreasing(samples(1400) { MotionMath.at(m, it).revealFraction }))
        assertEquals(false, MotionMath.at(m, 100).revealFromRight)
        assertEquals(true, MotionMath.at(m.copy(from = "right"), 100).revealFromRight)
        assertEquals(1.0, MotionMath.final(m).revealFraction)
    }

    @Test
    fun `a one-way drift glides to its offset and stays`() {
        val m = Motion(MotionType.DRIFT, dx = 0.04, dy = -0.02, ms = 2000)
        assertEquals(Transform.IDENTITY, MotionMath.at(m, 0))
        near(0.02, MotionMath.at(m, 1000).dx, "halfway")
        near(0.04, MotionMath.at(m, 2000).dx)
        near(-0.02, MotionMath.at(m, 5000).dy)
        assertTrue(nonDecreasing(samples(2500) { MotionMath.at(m, it).dx }))
        near(0.04, MotionMath.final(m).dx)
        assertEquals(2000L, MotionMath.endMs(m))
        near(MotionMath.DEFAULT_DRIFT, MotionMath.at(Motion(MotionType.DRIFT, ms = 100), 100).dx, "default drift")
    }

    @Test
    fun `a looping drift goes back and forth and rests at its start`() {
        val m = Motion(MotionType.DRIFT, dx = 0.04, ms = 2000, loop = true)
        near(0.0, MotionMath.at(m, 0).dx)
        near(0.04, MotionMath.at(m, 2000).dx, "end of the first leg")
        near(0.0, MotionMath.at(m, 4000).dx, "back home")
        near(MotionMath.at(m, 500).dx, MotionMath.at(m, 3500).dx, "mirror")
        near(MotionMath.at(m, 700).dx, MotionMath.at(m, 4700).dx, "periodic")
        assertTrue(samples(20_000) { MotionMath.at(m, it).dx }.all { it in -eps..0.04 + eps })
        assertEquals(Transform.IDENTITY, MotionMath.final(m))
        assertNull(MotionMath.endMs(m))
    }

    @Test
    fun `bob moves up and down within its amplitude, on twos`() {
        val m = Motion(MotionType.BOB, amp = 0.02, ms = 2000, loop = true)
        assertEquals(0.0, MotionMath.at(m, 0).dy)
        assertEquals(MotionMath.at(m, 0), MotionMath.at(m, 82), "held for two frames")
        assertTrue(MotionMath.at(m, 83).dy < 0.0, "goes up first")
        near(-0.02, MotionMath.at(m, 500).dy, "top", tolerance = 1e-4)
        near(0.02, MotionMath.at(m, 1500).dy, "bottom", tolerance = 1e-4)
        assertTrue(samples(10_000) { MotionMath.at(m, it).dy }.all { abs(it) <= 0.02 + eps })
        val steps = samples(2000) { MotionMath.at(m, it).dy }.distinct().size
        assertTrue(steps <= 2000 / 83 + 2, "stepped: $steps distinct values")
        assertEquals(Transform.IDENTITY, MotionMath.final(m))

        val once = m.copy(loop = false)
        assertEquals(0.0, MotionMath.at(once, 2500).dy, "one cycle, then rest")
        assertEquals(2000L, MotionMath.endMs(once))
    }

    @Test
    fun `sway turns about the bottom centre within its angle`() {
        val m = Motion(MotionType.SWAY, deg = 4.0, ms = 2400, loop = true)
        val t = MotionMath.at(m, 600)
        near(4.0, t.rotationDeg)
        assertEquals(0.5, t.originX)
        assertEquals(1.0, t.originY)
        near(-4.0, MotionMath.at(m, 1800).rotationDeg)
        assertTrue(samples(10_000) { MotionMath.at(m, it).rotationDeg }.all { abs(it) <= 4.0 + eps })
        assertEquals(0.0, MotionMath.final(m).rotationDeg)
    }

    @Test
    fun `glow pulses between 0_65 and 1 and rests fully lit`() {
        val m = Motion(MotionType.GLOW, ms = 2400, loop = true)
        assertEquals(1.0, MotionMath.at(m, 0).alpha)
        near(MotionMath.GLOW_MIN_ALPHA, MotionMath.at(m, 1200).alpha)
        near(1.0, MotionMath.at(m, 2400).alpha)
        assertTrue(samples(10_000) { MotionMath.at(m, it).alpha }.all { it in MotionMath.GLOW_MIN_ALPHA - eps..1.0 + eps })
        assertEquals(1.0, MotionMath.final(m).alpha)
    }

    @Test
    fun `path moves the layer through its points by arc length`() {
        val layer =
            StoryLayer(
                "hist_treasure_ship",
                x = 0.1,
                y = 0.5,
                w = 0.2,
                motion = Motion(MotionType.PATH, points = listOf(listOf(0.1, 0.5), listOf(0.5, 0.5), listOf(0.5, 0.3)), ms = 3000),
            )
        val start = MotionMath.at(layer, 0)
        near(0.0, start.dx)
        near(0.0, start.dy)
        // Total length 0.6: the corner (0.5, 0.5) is two thirds of the way.
        val corner = MotionMath.at(layer, 1500) // eased in-out: halfway in time is halfway along
        near(0.3, corner.dx, "half of 0.6 along the first segment")
        val end = MotionMath.at(layer, 3000)
        near(0.4, end.dx)
        near(-0.2, end.dy)
        assertEquals(end, MotionMath.final(layer))
        val along = samples(3000) { MotionMath.at(layer, it).dx }
        assertTrue(nonDecreasing(along))

        val looping = layer.copy(motion = layer.motion?.copy(loop = true))
        near(0.4, MotionMath.at(looping, 3000).dx, "there")
        near(0.0, MotionMath.at(looping, 6000).dx, "and back")
        assertEquals(Transform.IDENTITY, MotionMath.final(looping))
    }

    @Test
    fun `zoom grows from scale_from to scale_to, on a layer or the whole panel`() {
        val m = Motion(MotionType.ZOOM, scaleFrom = 1.0, scaleTo = 1.06, ms = 5000)
        assertEquals(1.0, MotionMath.at(m, 0).scale)
        near(1.03, MotionMath.at(m, 2500).scale)
        near(1.06, MotionMath.at(m, 5000).scale)
        near(1.06, MotionMath.final(m).scale)
        assertTrue(nonDecreasing(samples(6000) { MotionMath.at(m, it).scale }))
        near(1.06, MotionMath.at(m.copy(loop = true), 10_000).scale, "zoom never loops")

        val panel = StoryPanel("hist_bg_sea", caption = LocalizedText("Laut.", "Sea."), zoom = Motion(scaleTo = 1.1))
        val zoom = panel.sceneZoom
        assertEquals(MotionType.ZOOM, zoom?.type)
        near(1.1, MotionMath.final(zoom).scale)
        assertNull(StoryPanel("hist_bg_sea", caption = panel.caption).sceneZoom)
    }

    @Test
    fun `motion math is deterministic and loops never settle`() {
        val m = Motion(MotionType.GLOW, ms = 1600, loop = true, delayMs = 250)
        for (t in listOf(0L, 17L, 1234L, 99_999L)) assertEquals(MotionMath.at(m, t), MotionMath.at(m, t))
        assertNull(MotionMath.endMs(m))
        assertEquals(1850L, MotionMath.endMs(m.copy(loop = false)))
        assertEquals(1.0, MotionMath.at(m, 100).alpha, "before the delay it rests")
    }

    @Test
    fun `easing curves run from 0 to 1 monotonically`() {
        for (ease in listOf(MotionMath::easeOut, MotionMath::easeInOut)) {
            assertEquals(0.0, ease(0.0))
            near(1.0, ease(1.0))
            assertEquals(0.0, ease(-1.0))
            near(1.0, ease(2.0))
            assertTrue(nonDecreasing((0..100).map { ease(it / 100.0) }))
        }
    }
}
