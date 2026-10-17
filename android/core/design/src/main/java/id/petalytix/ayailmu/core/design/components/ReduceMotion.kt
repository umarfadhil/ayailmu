package id.petalytix.ayailmu.core.design.components

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode

/**
 * True when the learner has turned animations off (Developer options / Accessibility → "Remove animations").
 * Every animated component snaps to its end state instead (ART_DIRECTION §2.7: the reduce-motion fallback is
 * always a still pose). A per-app toggle joins this in Settings (P3b).
 */
@Composable
fun rememberReduceMotion(): Boolean {
    if (LocalInspectionMode.current) return false
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
}
