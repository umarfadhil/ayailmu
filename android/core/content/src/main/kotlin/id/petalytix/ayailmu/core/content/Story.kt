package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * An animated story (docs/content/MODULES_LEVELS_STORIES.md section 2), kept in the pack's `stories` map and played by a
 * `story` item whose [Item.storyId] names it. [figure] is the person and their years as shown
 * ("Raden Ajeng Kartini (1879–1904)"), [source] a real, checkable source, [emblem] an art key for the figure's
 * work (shown on «Lihat lagi / Watch again» and in lists). Checked by [PackValidator] against [StoryLimits].
 */
@Serializable
data class Story(
    val figure: String,
    val title: LocalizedText,
    val source: String,
    val emblem: String? = null,
    val panels: List<StoryPanel>,
)

/**
 * One panel: a 16:9 background [scene] (art key, `hist_bg_*`), up to 4 [layers], a [caption] (at most 2 short
 * sentences, always shown) and a [narration] clip per instruction language (`"id": "id/sej_kartini_01"`), played
 * when the panel appears if it is bundled. [zoom] is an optional slow push-in on the whole scene; its `type` may
 * be left out (use [sceneZoom]).
 */
@Serializable
data class StoryPanel(
    val scene: String,
    val caption: LocalizedText,
    val narration: Map<String, String> = emptyMap(),
    val layers: List<StoryLayer> = emptyList(),
    val zoom: Motion? = null,
) {
    /** The narration clip key for [lang], or null (then the caption alone is shown). */
    fun narrationFor(lang: Lang): String? = narration[lang.tag]

    /** [zoom] as a [MotionType.ZOOM] motion for [MotionMath] (authors usually leave its `type` out). Compute once per panel. */
    val sceneZoom: Motion? get() = zoom?.let { if (it.type == MotionType.ZOOM) it else it.copy(type = MotionType.ZOOM) }

    /** [layers] in drawing order: by `z`, a layer without `z` drawing at its list position (stable). */
    val layersInDrawOrder: List<StoryLayer>
        get() = layers.withIndex().sortedBy { it.value.z ?: it.index }.map { it.value }
}

/**
 * A picture layer on a panel. [x], [y] = top-left as fractions of the scene (0..1), [w] = width fraction (height
 * follows the drawing's aspect); [z] = draw order (default: list order); [flip] mirrors it horizontally.
 */
@Serializable
data class StoryLayer(
    val art: String,
    val x: Double,
    val y: Double,
    val w: Double,
    val z: Int? = null,
    val flip: Boolean = false,
    val motion: Motion? = null,
)

/** Motion types of a layer or a panel zoom (MODULES_LEVELS_STORIES.md section 2 table). */
@Serializable
enum class MotionType {
    @SerialName("none")
    NONE,

    @SerialName("fade_in")
    FADE_IN,

    @SerialName("slide_in")
    SLIDE_IN,

    @SerialName("drift")
    DRIFT,

    @SerialName("bob")
    BOB,

    @SerialName("sway")
    SWAY,

    @SerialName("glow")
    GLOW,

    @SerialName("path")
    PATH,

    @SerialName("zoom")
    ZOOM,

    @SerialName("reveal")
    REVEAL,
}

/**
 * How a layer (or a panel's zoom) moves. Every field but [type] is optional and has a per-type default
 * ([effectiveMs] and friends); fields a type does not use are ignored. Lengths ([dx], [dy], [amp], [points]) are
 * fractions of the scene: x and dx of its width, y, dy and amp of its height.
 *
 * - `ms`: one leg for `drift` and `path` (there, and back again when looping), the whole push-in for `zoom`, one
 *   full cycle for pulses (`bob`, `sway`, `glow`), the duration of entrances (`fade_in`, `slide_in`, `reveal`).
 * - [loop]: only `drift`, `bob`, `sway`, `glow` and `path` loop (back and forth, never a jump); without it a move
 *   plays once and stays at its end, a pulse plays one cycle and rests.
 * - [from]: `slide_in` side (left/right/top/bottom, default bottom); `reveal` side (left/right, default left).
 * - [points]: `path` positions of the layer's top-left, `[[x, y], …]`, 2–6 of them; give the layer the first
 *   point as its `x`, `y`.
 */
@Serializable
data class Motion(
    val type: MotionType = MotionType.NONE,
    val ms: Int? = null,
    @SerialName("delay_ms") val delayMs: Int? = null,
    val loop: Boolean = false,
    val from: String? = null,
    val dx: Double? = null,
    val dy: Double? = null,
    val amp: Double? = null,
    val deg: Double? = null,
    val points: List<List<Double>> = emptyList(),
    @SerialName("scale_from") val scaleFrom: Double? = null,
    @SerialName("scale_to") val scaleTo: Double? = null,
) {
    /** True for every type but [MotionType.NONE] (counted against [StoryLimits.MAX_MOVING_LAYERS]). */
    val isMoving: Boolean get() = type != MotionType.NONE

    /** True when the motion repeats: [loop] on a type that may loop. */
    val loops: Boolean get() = loop && type in MotionMath.LOOPABLE

    fun effectiveMs(): Int = ms ?: MotionMath.defaultMs(type)

    fun effectiveDelayMs(): Int = delayMs ?: 0

    /** The side a `slide_in` or `reveal` comes from (null for other types). */
    fun effectiveFrom(): String? =
        when (type) {
            MotionType.SLIDE_IN -> from ?: MotionSide.BOTTOM
            MotionType.REVEAL -> from ?: MotionSide.LEFT
            else -> null
        }

    /** `drift` offsets; with neither given the layer drifts gently to the right. */
    fun effectiveDx(): Double = dx ?: if (dy == null) MotionMath.DEFAULT_DRIFT else 0.0

    fun effectiveDy(): Double = dy ?: 0.0

    fun effectiveAmp(): Double = amp ?: MotionMath.DEFAULT_BOB_AMP

    fun effectiveDeg(): Double = deg ?: MotionMath.DEFAULT_SWAY_DEG

    fun effectiveScaleFrom(): Double = scaleFrom ?: 1.0

    fun effectiveScaleTo(): Double = scaleTo ?: MotionMath.DEFAULT_ZOOM_TO
}

/** Values of [Motion.from]. */
object MotionSide {
    const val LEFT = "left"
    const val RIGHT = "right"
    const val TOP = "top"
    const val BOTTOM = "bottom"

    val SLIDE: Set<String> = setOf(LEFT, RIGHT, TOP, BOTTOM)
    val REVEAL: Set<String> = setOf(LEFT, RIGHT)
}

/**
 * Where a layer is drawn at one moment, relative to its authored place. [dx], [dy] are fractions of the scene's
 * width and height; [scale] and [rotationDeg] apply about ([originX], [originY]) as fractions of the layer itself
 * (centre, or bottom centre for `sway`); [alpha] 0..1; [revealFraction] 0..1 is the visible part of the layer,
 * wiping in from the left (from the right when [revealFromRight]).
 */
data class Transform(
    val dx: Double = 0.0,
    val dy: Double = 0.0,
    val scale: Double = 1.0,
    val rotationDeg: Double = 0.0,
    val alpha: Double = 1.0,
    val revealFraction: Double = 1.0,
    val revealFromRight: Boolean = false,
    val originX: Double = 0.5,
    val originY: Double = 0.5,
) {
    companion object {
        val IDENTITY: Transform = Transform()
    }
}

/**
 * Pure, deterministic motion evaluation for the story player (MODULES_LEVELS_STORIES.md section 2): the app calls [at] every
 * frame with the milliseconds since the panel appeared, and [final] when reduce-motion is on (or to draw a still).
 * Entrances ease out (no bounce), moves ease in and out, loops go back and forth, `bob` steps on twos.
 */
object MotionMath {
    /** How far a `slide_in` starts from its place (fraction of the scene). */
    const val SLIDE_DISTANCE = 0.15

    /** Lowest alpha of a `glow` pulse. */
    const val GLOW_MIN_ALPHA = 0.65

    /** `bob` is drawn "on twos": its time advances in steps of two film frames (12 a second). */
    const val TWOS_MS = 83L

    const val DEFAULT_DRIFT = 0.03
    const val DEFAULT_BOB_AMP = 0.01
    const val DEFAULT_SWAY_DEG = 3.0
    const val DEFAULT_ZOOM_TO = 1.06

    /** Types whose `loop` is honoured. */
    val LOOPABLE: Set<MotionType> = setOf(MotionType.DRIFT, MotionType.BOB, MotionType.SWAY, MotionType.GLOW, MotionType.PATH)

    /** Pulses: `ms` is one full cycle and they rest where they started. */
    private val PULSES: Set<MotionType> = setOf(MotionType.BOB, MotionType.SWAY, MotionType.GLOW)

    /** Duration used when a motion leaves `ms` out (all within the validator's limits). */
    fun defaultMs(type: MotionType): Int =
        when (type) {
            MotionType.NONE -> 0
            MotionType.FADE_IN, MotionType.SLIDE_IN -> 600
            MotionType.REVEAL -> 1200
            MotionType.DRIFT -> 4000
            MotionType.BOB -> 2000
            MotionType.SWAY, MotionType.GLOW -> 2400
            MotionType.PATH -> 4000
            MotionType.ZOOM -> 5000
        }

    /** Decelerating entrance curve: monotonic, ends exactly at 1, never overshoots. */
    fun easeOut(x: Double): Double {
        val c = 1.0 - x.coerceIn(0.0, 1.0)
        return 1.0 - c * c * c
    }

    /** Gentle start and stop for moves: monotonic from 0 to 1. */
    fun easeInOut(x: Double): Double = (1.0 - cos(PI * x.coerceIn(0.0, 1.0))) / 2.0

    /** The motion of [layer] at [tMs] since its panel appeared (a `path` is measured from the layer's x, y). */
    fun at(
        layer: StoryLayer,
        tMs: Long,
    ): Transform = at(layer.motion, tMs, layer.x, layer.y)

    /** The motion's final state for [layer] (reduce-motion, stills). */
    fun final(layer: StoryLayer): Transform = final(layer.motion, layer.x, layer.y)

    /**
     * [motion] at [tMs] since its panel appeared. [anchorX], [anchorY] are the layer's authored top-left, used only
     * by `path` (whose points are scene positions); a null or `none` motion is [Transform.IDENTITY].
     */
    fun at(
        motion: Motion?,
        tMs: Long,
        anchorX: Double = 0.0,
        anchorY: Double = 0.0,
    ): Transform {
        if (motion == null || motion.type == MotionType.NONE) return Transform.IDENTITY
        val ms = motion.effectiveMs().toLong().coerceAtLeast(1L)
        val local = tMs - motion.effectiveDelayMs()
        return when (motion.type) {
            MotionType.NONE -> Transform.IDENTITY
            MotionType.FADE_IN -> Transform(alpha = easeOut(fraction(local, ms)))
            MotionType.SLIDE_IN -> {
                val e = easeOut(fraction(local, ms))
                val rest = 1.0 - e
                when (motion.effectiveFrom()) {
                    MotionSide.LEFT -> Transform(dx = z(-SLIDE_DISTANCE * rest), alpha = e)
                    MotionSide.RIGHT -> Transform(dx = SLIDE_DISTANCE * rest, alpha = e)
                    MotionSide.TOP -> Transform(dy = z(-SLIDE_DISTANCE * rest), alpha = e)
                    else -> Transform(dy = SLIDE_DISTANCE * rest, alpha = e)
                }
            }
            MotionType.REVEAL ->
                Transform(revealFraction = easeOut(fraction(local, ms)), revealFromRight = motion.effectiveFrom() == MotionSide.RIGHT)
            MotionType.DRIFT -> {
                val f = leg(local, ms, motion.loops)
                Transform(dx = z(motion.effectiveDx() * f), dy = z(motion.effectiveDy() * f))
            }
            MotionType.PATH -> {
                val (px, py) = along(motion.points, leg(local, ms, motion.loops), anchorX, anchorY)
                Transform(dx = px - anchorX, dy = py - anchorY)
            }
            MotionType.ZOOM -> {
                val from = motion.effectiveScaleFrom()
                Transform(scale = from + (motion.effectiveScaleTo() - from) * leg(local, ms, loops = false))
            }
            MotionType.BOB -> {
                val stepped = if (local > 0) local - local % TWOS_MS else local
                Transform(dy = z(-motion.effectiveAmp() * sin(2.0 * PI * cycle(stepped, ms, motion.loops))))
            }
            MotionType.SWAY -> {
                val deg = motion.effectiveDeg() * sin(2.0 * PI * cycle(local, ms, motion.loops))
                Transform(rotationDeg = z(deg), originX = 0.5, originY = 1.0)
            }
            MotionType.GLOW -> {
                val pulse = (1.0 - cos(2.0 * PI * cycle(local, ms, motion.loops))) / 2.0
                Transform(alpha = 1.0 - (1.0 - GLOW_MIN_ALPHA) * pulse)
            }
        }
    }

    /**
     * Where [motion] ends: entrances fully in, a one-way move at its end, a pulse or any looping motion at its rest
     * pose (its state at the start of a cycle). What reduce-motion shows.
     */
    fun final(
        motion: Motion?,
        anchorX: Double = 0.0,
        anchorY: Double = 0.0,
    ): Transform {
        if (motion == null || motion.type == MotionType.NONE) return Transform.IDENTITY
        val delay = motion.effectiveDelayMs().toLong()
        val t = if (motion.loops) delay else delay + motion.effectiveMs().coerceAtLeast(1)
        return at(motion, t, anchorX, anchorY)
    }

    /** Milliseconds after which [motion] no longer changes (the app may stop redrawing); null while it loops. */
    fun endMs(motion: Motion?): Long? =
        when {
            motion == null || motion.type == MotionType.NONE -> 0L
            motion.loops -> null
            else -> motion.effectiveDelayMs().toLong() + motion.effectiveMs().coerceAtLeast(1)
        }

    /** True when the motion is a pulse (`bob`, `sway`, `glow`): `ms` is a full cycle. */
    fun isPulse(type: MotionType): Boolean = type in PULSES

    /** Turns -0.0 into 0.0 so a resting transform equals [Transform.IDENTITY] (data-class equality tells them apart). */
    private fun z(v: Double): Double = v + 0.0

    private fun fraction(
        local: Long,
        ms: Long,
    ): Double = if (local <= 0L) 0.0 else (local.toDouble() / ms).coerceAtMost(1.0)

    /** One-way progress 0..1 (eased), or back and forth when [loops] (period 2 × ms). */
    private fun leg(
        local: Long,
        ms: Long,
        loops: Boolean,
    ): Double {
        if (local <= 0L) return 0.0
        if (!loops) return easeInOut(fraction(local, ms))
        val ph = local % (2 * ms)
        val x = if (ph <= ms) ph.toDouble() / ms else (2 * ms - ph).toDouble() / ms
        return easeInOut(x)
    }

    /** Phase 0..1 within a pulse cycle; 0 before the delay and after a single (non-looping) cycle. */
    private fun cycle(
        local: Long,
        ms: Long,
        loops: Boolean,
    ): Double =
        when {
            local <= 0L -> 0.0
            !loops && local >= ms -> 0.0
            else -> (local % ms).toDouble() / ms
        }

    /** The point at arc-length fraction [f] along [points] (malformed points are skipped; none = the anchor). */
    private fun along(
        points: List<List<Double>>,
        f: Double,
        anchorX: Double,
        anchorY: Double,
    ): Pair<Double, Double> {
        val pts = points.filter { it.size >= 2 }
        if (pts.isEmpty()) return anchorX to anchorY
        if (pts.size == 1) return pts[0][0] to pts[0][1]
        val lengths = pts.zipWithNext { a, b -> hypot(b[0] - a[0], b[1] - a[1]) }
        val total = lengths.sum()
        if (total <= 0.0) return pts[0][0] to pts[0][1]
        var left = f.coerceIn(0.0, 1.0) * total
        for (i in lengths.indices) {
            val len = lengths[i]
            if (left <= len || i == lengths.lastIndex) {
                val u = if (len <= 0.0) 1.0 else (left / len).coerceIn(0.0, 1.0)
                val a = pts[i]
                val b = pts[i + 1]
                return (a[0] + (b[0] - a[0]) * u) to (a[1] + (b[1] - a[1]) * u)
            }
            left -= len
        }
        return pts.last()[0] to pts.last()[1]
    }
}

/** Story limits (MODULES_LEVELS_STORIES.md section 2), enforced by [PackValidator]. */
object StoryLimits {
    const val MIN_PANELS = 3
    const val MAX_PANELS = 6
    const val MAX_LAYERS = 4
    const val MAX_MOVING_LAYERS = 3
    const val CAPTION_MAX_SENTENCES = 2
    const val CAPTION_MAX_WORDS = 40

    /** `x + w` may overhang the right edge a little (a ship sailing in). */
    const val MAX_RIGHT_EDGE = 1.05
    const val ENTRANCE_MAX_MS = 900
    const val DRIFT_MAX = 0.08
    const val DRIFT_LOOP_MIN_MS = 2000
    const val BOB_MAX_AMP = 0.02
    const val PULSE_MIN_MS = 1600
    const val SWAY_MAX_DEG = 6.0
    const val PATH_MIN_POINTS = 2
    const val PATH_MAX_POINTS = 6
    const val LONG_MAX_MS = 6000
    const val ZOOM_MIN = 1.0
    const val ZOOM_MAX = 1.12
    const val REVEAL_MAX_MS = 2000
}

/** Caption measures for the validator: words and sentences, tolerant of initials ("R.A.", "B.J.") and "c. 780". */
object StoryText {
    private val ABBREVIATIONS =
        setOf("dr", "ir", "prof", "st", "no", "dll", "dsb", "dst", "sdr", "bpk", "mr", "mrs", "ms", "c", "ca", "vs", "etc", "jl", "kh")
    private const val TERMINATORS = ".!?…"
    private const val CLOSERS = "\"'”’)»"
    private const val OPENERS = "\"'“‘(«"

    /** Tokens that contain a letter or a digit. */
    fun wordCount(text: String): Int = tokens(text).count { t -> t.any { it.isLetterOrDigit() } }

    /** Sentences: a token ending in . ! ? or … ends one when the next token does not start in lower case. */
    fun sentenceCount(text: String): Int {
        val tokens = tokens(text)
        if (tokens.isEmpty()) return 0
        var count = 1
        for (i in 0 until tokens.lastIndex) {
            val core = tokens[i].trimEnd { it in CLOSERS }
            if (core.isEmpty() || core.last() !in TERMINATORS) continue
            if (core.last() == '.' && isAbbreviation(core)) continue
            val next = tokens[i + 1].trimStart { it in OPENERS }.firstOrNull { it.isLetterOrDigit() } ?: continue
            if (next.isLowerCase()) continue
            count++
        }
        return count
    }

    private fun tokens(text: String): List<String> = text.split(' ', '\n', '\t').filter { it.isNotBlank() }

    private fun isAbbreviation(token: String): Boolean {
        val word = token.trimStart { it in OPENERS }.trimEnd('.')
        if (word.lowercase() in ABBREVIATIONS) return true
        // Initials: every dot-separated part is a single letter ("R.A.", "B.J.", "A.").
        val parts = word.split('.')
        return parts.isNotEmpty() && parts.all { it.length == 1 && it[0].isLetter() }
    }
}
