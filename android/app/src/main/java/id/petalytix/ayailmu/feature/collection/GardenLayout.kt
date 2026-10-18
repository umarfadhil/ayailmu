package id.petalytix.ayailmu.feature.collection

/** One plot of the garden scene, in fractions of the picture (top-left corner, width, height). */
data class GardenPlot(
    val id: String,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
)

/**
 * «Kebun Ilmu» (P6): one plot per unit on `scene_garden` (400×300). The plot rectangles must equal the
 * `regions.scene_garden` entries of content/assets/art/index.json (checked by a test); they live only here.
 */
object GardenLayout {
    const val SCENE = "scene_garden"
    const val SEED = "plot_seed"
    const val WIDTH = 400
    const val HEIGHT = 300
    const val MAX_PLOTS = 10

    private val BACK_X = listOf(0.07f, 0.25f, 0.43f, 0.61f, 0.79f)
    private val FRONT_X = listOf(0.04f, 0.23f, 0.42f, 0.61f, 0.80f)

    /** plot_01…plot_05: the back row; plot_06…plot_10: the front row (bigger, nearer). */
    val PLOTS: List<GardenPlot> =
        BACK_X.mapIndexed { i, x -> GardenPlot(plotId(i + 1), x, 0.42f, 0.14f, 0.18f) } +
            FRONT_X.mapIndexed { i, x -> GardenPlot(plotId(i + 6), x, 0.66f, 0.16f, 0.22f) }

    private fun plotId(n: Int): String = "plot_" + n.toString().padStart(2, '0')

    /** Plots for a track with [units] units, in unit order. Five or fewer use the front row; more fill back, then front. */
    fun plotsFor(units: Int): List<GardenPlot> =
        when {
            units <= 0 -> emptyList()
            units <= FRONT_X.size -> PLOTS.subList(BACK_X.size, BACK_X.size + units)
            else -> PLOTS.take(minOf(units, MAX_PLOTS))
        }
}
