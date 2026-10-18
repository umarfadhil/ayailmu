package id.petalytix.ayailmu.feature.session.story

import id.petalytix.ayailmu.core.content.Motion
import id.petalytix.ayailmu.core.content.MotionMath
import id.petalytix.ayailmu.core.content.MotionType
import id.petalytix.ayailmu.core.content.Transform

/**
 * The player's side of story motion. :core:content's [MotionMath] decides what every motion looks like at a given
 * millisecond (eased entrances, back-and-forth loops, bob on twos); this adapter decides which clock drives each
 * layer and what reduce-motion shows (ART_DIRECTION 2.7: small, slow, still when animations are off):
 *
 * - one-way motions (entrances, single moves and pulses, the scene zoom) read the panel's entrance clock, which
 *   runs once for [finiteMs] and stops;
 * - looping motions read their own loop clock, a phase that repeats every [loopPeriodMs] after the motion's delay,
 *   so a loop never jumps;
 * - `sway` is held on twos here, like `bob` in MotionMath and Aya's float (about 12 drawings a second);
 * - reduce-motion: every layer at [still] (MotionMath.final) and no scene zoom.
 */
object StoryMotion {
    /** How long the panel's one-way motions need; 0 when everything is still or looping (no entrance clock). */
    fun finiteMs(panel: StoryPanelUi): Long {
        val oneWay = panel.layers.mapNotNull { l -> l.motion?.takeIf { !it.loops } } + listOfNotNull(panel.zoom)
        return oneWay.maxOfOrNull { MotionMath.endMs(it) ?: 0L } ?: 0L
    }

    /** The repeat period of a looping motion: there and back for moves (2 × ms), one cycle for pulses; null if it does not loop. */
    fun loopPeriodMs(motion: Motion?): Long? {
        if (motion == null || !motion.loops) return null
        val ms = motion.effectiveMs().toLong().coerceAtLeast(1L)
        return if (MotionMath.isPulse(motion.type)) ms else 2 * ms
    }

    /** Milliseconds before a loop starts (its loop clock holds 0 until then). */
    fun loopDelayMs(motion: Motion?): Int = motion?.effectiveDelayMs()?.coerceAtLeast(0) ?: 0

    /** [layer] at [tMs] since its panel appeared. */
    fun at(
        layer: StoryLayerUi,
        tMs: Long,
    ): Transform {
        val m = layer.motion
        val t = if (m?.type == MotionType.SWAY && tMs > 0L) tMs - tMs % MotionMath.TWOS_MS else tMs
        return MotionMath.at(m, t, layer.x, layer.y)
    }

    /** A looping [layer] at [phaseMs] into its current cycle (0 until [loopPeriodMs]), counted after its delay. */
    fun atLoop(
        layer: StoryLayerUi,
        phaseMs: Long,
    ): Transform = at(layer, loopDelayMs(layer.motion) + phaseMs.coerceAtLeast(0L))

    /** Reduce-motion (and stills): where the layer ends, entrances fully in, loops at rest. */
    fun still(layer: StoryLayerUi): Transform = MotionMath.final(layer.motion, layer.x, layer.y)

    /** The whole scene's scale at [tMs]; 1 with reduce-motion or without a panel zoom. */
    fun sceneScale(
        panel: StoryPanelUi,
        tMs: Long,
        reduceMotion: Boolean,
    ): Float {
        val zoom = panel.zoom
        if (reduceMotion || zoom == null) return 1f
        return MotionMath.at(zoom, tMs).scale.toFloat()
    }

    /** True when the layer is driven by a loop clock rather than the panel's entrance clock. */
    fun loops(layer: StoryLayerUi): Boolean = loopPeriodMs(layer.motion) != null
}
