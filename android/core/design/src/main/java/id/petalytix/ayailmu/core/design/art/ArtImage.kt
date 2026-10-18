package id.petalytix.ayailmu.core.design.art

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.sin

/**
 * Draws one catalog picture (docs/ART_CATALOG.md) at its own aspect ratio. Every picture is DRAFT art until an
 * illustrator redraws or approves it (ART_DIRECTION section 7); the key never changes when it is replaced.
 * An unknown key draws [placeholder] instead (the session shows a labelled dashed frame), never a crash.
 */
@Composable
fun ArtImage(
    key: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    alpha: Float = 1f,
    colorFilter: ColorFilter? = null,
    placeholder: @Composable (String) -> Unit = {},
) {
    val id = ArtRegistry.drawable(key)
    if (id == null) {
        placeholder(key)
        return
    }
    Image(
        painter = painterResource(id),
        contentDescription = contentDescription,
        modifier = modifier.aspectRatio(ArtRegistry.aspect(key)),
        contentScale = ContentScale.Fit,
        alpha = alpha,
        colorFilter = colorFilter,
    )
}

/** A picture not earned yet (sticker shelf): no colour, faint, still recognisable as a shape. */
val NotYetEarnedFilter: ColorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

/** Aya, the coach (draft design: a seedling with a two-leaf sprout). One pose per moment, never a reaction storm. */
enum class AyaPose(
    val key: String,
) {
    IDLE("aya_idle"),
    WAVE("aya_wave"),
    HAPPY("aya_happy"),
    THINK("aya_think"),
    SLEEP("aya_sleep"),
}

/**
 * Aya at [size]. With [float] she bobs gently (3 dp, 2.4 s a cycle) "on twos": the offset is held for two
 * frames at a time (about 12 drawings a second), so the idle reads as drawn rather than tweened
 * (ART_DIRECTION section 2.7). When the learner has turned animations off she stands still.
 */
@Composable
fun AyaFigure(
    pose: AyaPose,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 96.dp,
    float: Boolean = false,
) {
    val reduceMotion = rememberReduceMotion()
    val phase =
        if (float && !reduceMotion) {
            rememberInfiniteTransition(label = "aya-float")
                .animateFloat(
                    initialValue = 0f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(FLOAT_CYCLE_MS, easing = LinearEasing)),
                    label = "aya-float-phase",
                )
        } else {
            null
        }
    ArtImage(
        key = pose.key,
        contentDescription = contentDescription,
        modifier =
            modifier
                .size(size)
                .graphicsLayer {
                    // Read in the draw phase only: the bob never recomposes the screen.
                    val p = phase?.value ?: return@graphicsLayer
                    val held = floor(p * FLOAT_DRAWINGS) / FLOAT_DRAWINGS
                    translationY = (sin(held * 2 * PI) * FLOAT_AMPLITUDE.toPx()).toFloat()
                },
    )
}

private const val FLOAT_CYCLE_MS = 2_400
private const val FLOAT_DRAWINGS = 29f // 2.4 s at 12 drawings per second, rounded down
private val FLOAT_AMPLITUDE = 3.dp
