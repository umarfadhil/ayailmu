package id.petalytix.ayailmu.core.design.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

/** Visual state of a selectable answer. Colour is never the only signal: the line weight changes too (CR-A11Y-2). */
enum class ChoiceState { IDLE, SELECTED, CORRECT, WRONG, DIMMED }

/**
 * One answer option: paper card with a drawn-looking edge. Two stroke weights (thin idle, heavy chosen) follow
 * ART_DIRECTION §2.2; no shadow, glow or gradient. ≥ 48 dp tall (≥ 56 dp unless [compact]). Set [fillWidth]
 * false for tiles laid out in a FlowRow.
 */
@Composable
fun OptionCard(
    state: ChoiceState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    compact: Boolean = false,
    fillWidth: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val reduceMotion = rememberReduceMotion()
    val edgeTarget =
        when (state) {
            ChoiceState.IDLE, ChoiceState.DIMMED -> colors.inkSoft.copy(alpha = 0.55f)
            ChoiceState.SELECTED -> colors.accent
            ChoiceState.CORRECT -> colors.correct
            ChoiceState.WRONG -> colors.notYet
        }
    val weightTarget = if (state == ChoiceState.IDLE || state == ChoiceState.DIMMED) THIN else HEAVY
    val edge by animateColorAsState(edgeTarget, if (reduceMotion) snap<Color>() else tween<Color>(AyaMotion.QUICK_MS, easing = AyaMotion.Ease), label = "edge")
    val weight by animateDpAsState(weightTarget, if (reduceMotion) snap<Dp>() else tween<Dp>(AyaMotion.QUICK_MS, easing = AyaMotion.Ease), label = "weight")
    val fill = if (state == ChoiceState.SELECTED) colors.paper else colors.paperDeep

    Box(
        modifier =
            modifier
                .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
                .heightIn(min = if (compact) AyaSpacing.touch else 56.dp)
                .alpha(if (state == ChoiceState.DIMMED) 0.55f else 1f)
                .background(fill, AyaRadius.md)
                .border(weight, edge, AyaRadius.md)
                .selectable(selected = state == ChoiceState.SELECTED, enabled = enabled, role = Role.RadioButton, onClick = onClick)
                .padding(horizontal = if (compact) AyaSpacing.sm else AyaSpacing.md, vertical = AyaSpacing.sm),
        contentAlignment = Alignment.CenterStart,
    ) {
        content()
    }
}

private val THIN = 1.2.dp
private val HEAVY = 2.6.dp

@Preview(name = "light", showBackground = true)
@Preview(name = "dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "fontScale 1.5", showBackground = true, fontScale = 1.5f)
@Composable
private fun OptionCardPreview() {
    AyaTheme {
        PaperBackground {
            Column(Modifier.padding(AyaSpacing.md), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                ChoiceState.entries.forEach { s ->
                    OptionCard(state = s, onClick = {}) {
                        Text(s.name.lowercase(), style = MaterialTheme.typography.bodyLarge, color = AyaThemeTokens.colors.ink)
                    }
                }
            }
        }
    }
}
