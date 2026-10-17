package id.petalytix.ayailmu.core.design.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.DrawScope
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import kotlin.random.Random

/**
 * Paper, always (ART_DIRECTION §2.1). In P0 the grain is a sparse, seeded speckle drawn on Canvas so the app
 * never shows a flat white; in P4 it is replaced by the illustrator's texture overlay (sanctioned exception
 * in CR-VIS-1). The speckle is deterministic (fixed seed) so screenshot tests are stable.
 */
@Composable
fun PaperBackground(
    modifier: Modifier = Modifier,
    grain: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Box(modifier = modifier.fillMaxSize().background(colors.paper)) {
        if (grain) {
            val speck = colors.inkSoft.copy(alpha = if (colors.isDark) 0.10f else 0.07f)
            Canvas(modifier = Modifier.fillMaxSize()) { drawGrain(speck, seed = 7) }
        }
        content()
    }
}

private fun DrawScope.drawGrain(
    color: androidx.compose.ui.graphics.Color,
    seed: Int,
) {
    val rnd = Random(seed)
    val count = (size.width * size.height / 2_600f).toInt().coerceIn(200, 2_400)
    repeat(count) {
        val x = rnd.nextFloat() * size.width
        val y = rnd.nextFloat() * size.height
        val r = 0.6f + rnd.nextFloat() * 1.1f
        drawCircle(color = color, radius = r, center = Offset(x, y))
    }
}
