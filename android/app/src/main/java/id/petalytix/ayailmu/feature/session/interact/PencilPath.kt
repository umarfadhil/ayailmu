package id.petalytix.ayailmu.feature.session.interact

import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.random.Random

/**
 * A hand-drawn pencil line between two anchors (ART_DIRECTION section 2, "drawn lines": weight varies, curves
 * wobble a little). The bend and the wobble come from a seed made of the two card ids, so the same link always
 * draws the same line: nothing jitters when the screen recomposes. Pure Kotlin; the renderer strokes the points.
 */
object PencilPath {
    /** Points along the line (segments + 1). */
    const val SEGMENTS = 24

    /** Largest sideways bend of the curve, as a fraction of its length. */
    const val BEND = 0.08f

    /** Largest small wobble of a point, as a fraction of the length. */
    const val JITTER = 0.006f

    /** The seed for a link: the same pair of cards always gives the same line. */
    fun seedOf(
        a: String,
        b: String,
    ): String = "$a>$b"

    /**
     * The line from (x0, y0) to (x1, y1) as x, y pairs: a cubic curve with a seeded bend, plus a smoothed seeded
     * wobble on the inner points. Both ends are exact, so the line meets the dots.
     */
    fun points(
        x0: Float,
        y0: Float,
        x1: Float,
        y1: Float,
        seed: String,
        segments: Int = SEGMENTS,
        bend: Float = BEND,
        jitter: Float = JITTER,
    ): FloatArray {
        val dx = x1 - x0
        val dy = y1 - y0
        val len = hypot(dx, dy)
        if (len <= 0f || segments < 1) return floatArrayOf(x0, y0, x1, y1)
        val rnd = Random(seed.hashCode())
        // Unit normal: the sideways direction of the line.
        val nx = -dy / len
        val ny = dx / len
        val b1 = (rnd.nextFloat() * 2f - 1f) * bend * len
        val b2 = (rnd.nextFloat() * 2f - 1f) * bend * len
        val c1x = x0 + dx * 0.3f + nx * b1
        val c1y = y0 + dy * 0.3f + ny * b1
        val c2x = x0 + dx * 0.7f + nx * b2
        val c2y = y0 + dy * 0.7f + ny * b2
        val raw = FloatArray(segments + 1) { (rnd.nextFloat() * 2f - 1f) * jitter * len }
        val out = FloatArray((segments + 1) * 2)
        for (i in 0..segments) {
            val t = i.toFloat() / segments
            val u = 1f - t
            val bx = u * u * u * x0 + 3f * u * u * t * c1x + 3f * u * t * t * c2x + t * t * t * x1
            val by = u * u * u * y0 + 3f * u * u * t * c1y + 3f * u * t * t * c2y + t * t * t * y1
            val wobble =
                if (i == 0 || i == segments) {
                    0f
                } else {
                    (raw[i - 1] + raw[i] * 2f + raw[i + 1]) / 4f
                }
            out[i * 2] = bx + nx * wobble
            out[i * 2 + 1] = by + ny * wobble
        }
        return out
    }

    /** Pencil pressure along the line (t in 0..1): thin at both ends, heaviest in the middle. */
    fun width(
        t: Float,
        thin: Float,
        heavy: Float,
    ): Float = thin + (heavy - thin) * sin(PI * t.coerceIn(0f, 1f)).toFloat()
}
