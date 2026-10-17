package id.petalytix.ayailmu.core.design.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** Spacing scale (CR-KT-6: raw dp outside tokens is a review flag). */
object AyaSpacing {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 16.dp
    val lg = 24.dp
    val xl = 32.dp
    val xxl = 48.dp

    /** Minimum touch target (CR-A11Y-1). */
    val touch = 48.dp
}

/** Corners are soft, slightly irregular in spirit; Compose can only do uniform radii, so keep them modest. */
object AyaRadius {
    val sm = RoundedCornerShape(6.dp)
    val md = RoundedCornerShape(12.dp)
    val lg = RoundedCornerShape(20.dp)
}

/**
 * Motion (ART_DIRECTION §2.7, CR-VIS-2): small, slow-in/slow-out, UI transitions ≤ 600 ms.
 * Character animation lives in Rive and does not use these.
 */
object AyaMotion {
    const val QUICK_MS = 160
    const val STANDARD_MS = 280
    const val GENTLE_MS = 420
    const val MAX_MS = 600

    /** Slow-in, slow-out; no overshoot, nothing bounces like rubber. */
    val Ease: Easing = CubicBezierEasing(0.4f, 0.0f, 0.2f, 1.0f)

    /** Entering elements settle in; used for cards and sheets. */
    val Settle: Easing = CubicBezierEasing(0.0f, 0.0f, 0.2f, 1.0f)
}
