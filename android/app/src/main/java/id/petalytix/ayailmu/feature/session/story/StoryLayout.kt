package id.petalytix.ayailmu.feature.session.story

/** A layer's box on the stage, in the stage's own units (the player passes dp). */
data class LayerRect(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float,
)

/**
 * Stage geometry (MODULES_LEVELS_STORIES.md section 2): scenes are 16:9; a layer's `x`, `y` place its top-left and
 * `w` its width as fractions of the scene, and its height follows the drawing's own aspect (width / height, from
 * ArtRegistry, passed in so this stays pure). Layers may overhang the edge a little; the stage clips them.
 */
object StoryLayout {
    /** Width / height of every scene (`hist_bg_*` are drawn on a 400 × 225 viewport). */
    const val STAGE_ASPECT: Float = 16f / 9f

    fun stageHeight(stageWidth: Float): Float = stageWidth / STAGE_ASPECT

    fun rect(
        layer: StoryLayerUi,
        stageWidth: Float,
        stageHeight: Float,
        aspect: (String) -> Float,
    ): LayerRect {
        val width = (layer.w * stageWidth).toFloat().coerceAtLeast(0f)
        val ratio = aspect(layer.art).takeIf { it > 0f && it.isFinite() } ?: 1f
        return LayerRect(
            left = (layer.x * stageWidth).toFloat(),
            top = (layer.y * stageHeight).toFloat(),
            width = width,
            height = width / ratio,
        )
    }

    /**
     * The visible horizontal span (start, end) of a `reveal` layer [width] wide, [fraction] of the way in. The clip
     * is applied inside the layer, before a mirrored layer is flipped, so a flipped layer clips from the other
     * side of its own drawing and still wipes in from the side the author asked for on screen.
     */
    fun revealSpan(
        fraction: Double,
        fromRight: Boolean,
        flip: Boolean,
        width: Float,
    ): Pair<Float, Float> {
        val f = fraction.coerceIn(0.0, 1.0).toFloat()
        return if (fromRight != flip) width * (1f - f) to width else 0f to width * f
    }
}
