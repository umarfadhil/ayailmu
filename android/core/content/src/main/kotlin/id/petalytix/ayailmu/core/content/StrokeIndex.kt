package id.petalytix.ayailmu.core.content

import kotlinx.serialization.Serializable

/**
 * Stroke data for `trace` items (`content/src/main/assets/strokes/index.json`, INTERACTIONS_AUDIO.md §4):
 * `{"keys": {"hira_a": {"glyph": "あ", "script": "hiragana", "strokes": [[[x, y], ...], ...]}}}`.
 * The validator checks that every `trace` key exists here; the app loads it to draw and check the strokes.
 */
@Serializable
data class StrokeIndex(
    val keys: Map<String, StrokeGlyph> = emptyMap(),
) {
    /** Structural problems of the index itself (blank glyph, no strokes, points outside 0..1). */
    fun problems(): List<PackProblem> =
        keys.flatMap { (key, g) ->
            val at = "strokes.$key"
            buildList {
                if (g.glyph.isBlank()) add(PackProblem(at, "glyph must not be blank"))
                if (g.strokes.isEmpty()) add(PackProblem(at, "needs at least one stroke"))
                g.strokes.forEachIndexed { i, stroke ->
                    if (stroke.size < 2) add(PackProblem("$at.stroke$i", "a stroke needs at least two points"))
                    if (stroke.any { p -> p.size != 2 || p.any { c -> c < 0.0 || c > 1.0 } }) {
                        add(PackProblem("$at.stroke$i", "points must be [x, y] with coordinates in 0..1"))
                    }
                }
            }
        }

    companion object {
        fun parse(text: String): StrokeIndex = ContentJson.json.decodeFromString(serializer(), text)
    }
}

/**
 * One traceable glyph. Each stroke is a polyline in drawing order and direction; a point is `[x, y]` with
 * coordinates 0..1 (origin top-left). Stroke ids in a `trace` response are the 1-based stroke numbers ("1", "2", …).
 */
@Serializable
data class StrokeGlyph(
    val glyph: String,
    /** `hiragana`, `hangul` or `hanzi`. */
    val script: String? = null,
    val strokes: List<List<List<Double>>> = emptyList(),
) {
    /** The strokes as points; malformed points (not exactly two numbers) are dropped. */
    fun polylines(): List<List<StrokePoint>> = strokes.map { s -> s.filter { it.size == 2 }.map { StrokePoint(it[0], it[1]) } }
}

/** A point of a stroke, 0..1 with the origin top-left. */
data class StrokePoint(
    val x: Double,
    val y: Double,
)
