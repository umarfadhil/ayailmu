package id.petalytix.ayailmu.feature.session.interact

import kotlin.math.hypot

/** A rectangle in one shared coordinate space (the renderers use root pixels). */
data class HitBox(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val area: Float get() = width.coerceAtLeast(0f) * height.coerceAtLeast(0f)
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f

    fun contains(
        x: Float,
        y: Float,
        slop: Float = 0f,
    ): Boolean = x >= left - slop && x <= right + slop && y >= top - slop && y <= bottom + slop

    /** 0 inside, else the distance to the nearest edge. */
    fun distanceTo(
        x: Float,
        y: Float,
    ): Float {
        val dx = maxOf(left - x, 0f, x - right)
        val dy = maxOf(top - y, 0f, y - bottom)
        return hypot(dx, dy)
    }
}

/** A straight segment between two anchors (a connect line, dot to dot). */
data class Segment(
    val x0: Float,
    val y0: Float,
    val x1: Float,
    val y1: Float,
)

/**
 * Where a dragged card or a finger lands. Renderers register every target's rectangle after layout and ask
 * [hit] when the finger lifts. Pure Kotlin: the rectangles are plain numbers, so the rules are unit-tested.
 */
class DropTargets {
    private val boxes = LinkedHashMap<String, HitBox>()

    val ids: Set<String> get() = boxes.keys

    operator fun get(id: String): HitBox? = boxes[id]

    fun put(
        id: String,
        box: HitBox,
    ) {
        boxes[id] = box
    }

    fun remove(id: String) {
        boxes.remove(id)
    }

    fun clear() = boxes.clear()

    /**
     * The target under (x, y). Several overlapping targets: the smallest wins (the precise one, as on tap pictures).
     * None under the point: the nearest one within [slop], so a card dropped just beside a target still lands.
     * [among] limits the search (for example to the other column).
     */
    fun hit(
        x: Float,
        y: Float,
        slop: Float = 0f,
        among: Collection<String>? = null,
    ): String? {
        val candidates = boxes.entries.filter { among == null || it.key in among }
        candidates
            .filter { it.value.contains(x, y) }
            .minByOrNull { it.value.area }
            ?.let { return it.key }
        if (slop <= 0f) return null
        return candidates
            .map { it.key to it.value.distanceTo(x, y) }
            .filter { it.second <= slop }
            .minByOrNull { it.second }
            ?.first
    }

    companion object {
        /** Distance from (x, y) to the segment. */
        fun distanceToSegment(
            x: Float,
            y: Float,
            s: Segment,
        ): Float {
            val dx = s.x1 - s.x0
            val dy = s.y1 - s.y0
            val len2 = dx * dx + dy * dy
            if (len2 <= 0f) return hypot(x - s.x0, y - s.y0)
            val t = (((x - s.x0) * dx + (y - s.y0) * dy) / len2).coerceIn(0f, 1f)
            return hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy))
        }

        /** The line nearest to a tap, if one is within [maxDistance] (tapping a pencil line removes it). */
        fun nearestLine(
            x: Float,
            y: Float,
            lines: Map<String, Segment>,
            maxDistance: Float,
        ): String? =
            lines.entries
                .map { it.key to distanceToSegment(x, y, it.value) }
                .filter { it.second <= maxDistance }
                .minByOrNull { it.second }
                ?.first
    }
}
