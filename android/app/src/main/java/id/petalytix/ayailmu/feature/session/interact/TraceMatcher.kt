package id.petalytix.ayailmu.feature.session.interact

import id.petalytix.ayailmu.core.content.StrokePoint
import kotlin.math.hypot

/**
 * Loose check of one traced stroke (docs/content/INTERACTIONS_AUDIO.md section 4). The guide stroke and the
 * finger points share one space, 0..1 with the origin top-left. Tolerant on purpose: children trace shakily and
 * a stroke that is "about right" counts. A miss costs nothing; the learner just tries that stroke again.
 */
object TraceMatcher {
    /** The finger must start within this distance of the stroke's first point. */
    const val START_TOLERANCE = 0.15

    /** ... and lift within this distance of its last point. */
    const val END_TOLERANCE = 0.18

    /** Mean distance from the finger path to the stroke. */
    const val MEAN_DISTANCE = 0.12

    /** Mean distance from the stroke to the finger path: the finger went along the whole stroke, not a corner of it. */
    const val COVERAGE = 0.18

    /** Shorter than this is a tap, not a stroke (ignored without a "try again"). */
    const val MIN_FINGER_LENGTH = 0.03

    /** Points both paths are resampled to, so a slow (dense) part of the finger path does not outweigh the rest. */
    const val SAMPLES = 32

    enum class Verdict { OK, TOO_SHORT, START, END, FAR, COVERAGE, DIRECTION }

    fun matches(
        stroke: List<StrokePoint>,
        finger: List<StrokePoint>,
    ): Boolean = check(stroke, finger) == Verdict.OK

    fun check(
        stroke: List<StrokePoint>,
        finger: List<StrokePoint>,
    ): Verdict {
        if (finger.size < 2 || length(finger) < MIN_FINGER_LENGTH) return Verdict.TOO_SHORT
        if (stroke.size < 2) return Verdict.OK
        if (dist(finger.first(), stroke.first()) > START_TOLERANCE) return Verdict.START
        if (dist(finger.last(), stroke.last()) > END_TOLERANCE) return Verdict.END
        val f = resample(finger, SAMPLES)
        val s = resample(stroke, SAMPLES)
        if (f.map { distanceToPath(it, stroke) }.average() > MEAN_DISTANCE) return Verdict.FAR
        if (s.map { distanceToPath(it, finger) }.average() > COVERAGE) return Verdict.COVERAGE
        if (!forwards(f, s, stroke)) return Verdict.DIRECTION
        return Verdict.OK
    }

    /**
     * Direction. First: where the finger is a quarter and three quarters of the way along, measured along the
     * stroke (the ends are left out, so a closed stroke such as the circle of ㅇ is not ambiguous). Where a stroke
     * crosses itself (the knot of な) that can mislead, so a second look compares the two resampled paths point by
     * point: the finger must lie closer to the stroke drawn forwards than to the stroke drawn backwards.
     */
    private fun forwards(
        f: List<StrokePoint>,
        s: List<StrokePoint>,
        stroke: List<StrokePoint>,
    ): Boolean {
        val early = progressAlong(f[f.size / 4], stroke)
        val late = progressAlong(f[f.size * 3 / 4], stroke)
        if (late > early) return true
        val n = minOf(f.size, s.size)
        val ahead = (0 until n).sumOf { dist(f[it], s[it]) }
        val back = (0 until n).sumOf { dist(f[it], s[s.size - 1 - it]) }
        return ahead < back
    }

    fun length(path: List<StrokePoint>): Double = path.zipWithNext { a, b -> dist(a, b) }.sum()

    /** [count] points evenly spaced along [path] (first and last kept). */
    fun resample(
        path: List<StrokePoint>,
        count: Int,
    ): List<StrokePoint> {
        if (path.size < 2 || count < 2) return path
        val total = length(path)
        if (total <= 0.0) return List(count) { path.first() }
        val step = total / (count - 1)
        val out = ArrayList<StrokePoint>(count)
        out += path.first()
        var seg = 0
        var segStart = 0.0
        for (k in 1 until count - 1) {
            val at = step * k
            while (seg < path.size - 2 && segStart + dist(path[seg], path[seg + 1]) < at) {
                segStart += dist(path[seg], path[seg + 1])
                seg++
            }
            val a = path[seg]
            val b = path[seg + 1]
            val d = dist(a, b)
            val t = if (d <= 0.0) 0.0 else ((at - segStart) / d).coerceIn(0.0, 1.0)
            out += StrokePoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        }
        out += path.last()
        return out
    }

    /** Shortest distance from [p] to the polyline [path]. */
    fun distanceToPath(
        p: StrokePoint,
        path: List<StrokePoint>,
    ): Double {
        if (path.size == 1) return dist(p, path[0])
        return path.zipWithNext { a, b -> distanceToSegment(p, a, b) }.minOrNull() ?: Double.MAX_VALUE
    }

    /** How far along [path] (0..1 of its length) the point of the path nearest to [p] is. */
    fun progressAlong(
        p: StrokePoint,
        path: List<StrokePoint>,
    ): Double {
        val total = length(path)
        if (path.size < 2 || total <= 0.0) return 0.0
        var best = Double.MAX_VALUE
        var bestAt = 0.0
        var walked = 0.0
        for (i in 0 until path.size - 1) {
            val a = path[i]
            val b = path[i + 1]
            val d = dist(a, b)
            val t = projection(p, a, b)
            val q = StrokePoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
            val gap = dist(p, q)
            if (gap < best) {
                best = gap
                bestAt = walked + d * t
            }
            walked += d
        }
        return bestAt / total
    }

    private fun projection(
        p: StrokePoint,
        a: StrokePoint,
        b: StrokePoint,
    ): Double {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val len2 = dx * dx + dy * dy
        if (len2 <= 0.0) return 0.0
        return (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).coerceIn(0.0, 1.0)
    }

    private fun distanceToSegment(
        p: StrokePoint,
        a: StrokePoint,
        b: StrokePoint,
    ): Double {
        val t = projection(p, a, b)
        return hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t))
    }

    private fun dist(
        a: StrokePoint,
        b: StrokePoint,
    ): Double = hypot(a.x - b.x, a.y - b.y)
}
