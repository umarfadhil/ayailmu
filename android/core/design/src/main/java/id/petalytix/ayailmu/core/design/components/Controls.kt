package id.petalytix.ayailmu.core.design.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

/** Secondary action: a drawn outline on paper, never filled (pairs with [AyaButton]). ≥ 48 dp tall. */
@Composable
fun AyaSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = AyaThemeTokens.colors
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = AyaSpacing.touch),
        shape = AyaRadius.md,
        border = BorderStroke(1.4.dp, if (enabled) colors.inkSoft else colors.inkSoft.copy(alpha = 0.35f)),
        contentPadding = PaddingValues(horizontal = AyaSpacing.lg, vertical = AyaSpacing.sm),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge, color = if (enabled) colors.ink else colors.inkSoft)
    }
}

/** Text input on paper. Ink line that thickens on focus; no filled grey box. */
@Composable
fun AyaTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    textStyle: TextStyle = MaterialTheme.typography.bodyLarge,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val colors = AyaThemeTokens.colors
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        supportingText = supporting?.let { text -> @Composable { Text(text) } },
        enabled = enabled,
        singleLine = singleLine,
        textStyle = textStyle.copy(color = colors.ink),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        shape = AyaRadius.md,
        modifier = modifier.fillMaxWidth(),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedBorderColor = colors.accent,
                unfocusedBorderColor = colors.inkSoft,
                focusedLabelColor = colors.accentDeep,
                unfocusedLabelColor = colors.inkSoft,
                cursorColor = colors.accent,
                focusedContainerColor = colors.paper,
                unfocusedContainerColor = colors.paper,
                disabledContainerColor = colors.paperDeep,
            ),
    )
}

/**
 * Session progress: a thin pencil rule with a heavier clay line over it (two stroke weights). Shows how far
 * along the session is — never a countdown or a timer (CODE_RULES §Healthy habit loop).
 */
@Composable
fun SessionProgressBar(
    progress: Float,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    val reduceMotion = rememberReduceMotion()
    val target = progress.coerceIn(0f, 1f)
    val shown by animateFloatAsState(
        targetValue = target,
        animationSpec = if (reduceMotion) snap<Float>() else tween<Float>(AyaMotion.GENTLE_MS, easing = AyaMotion.Settle),
        label = "progress",
    )
    Canvas(
        modifier =
            modifier
                .fillMaxWidth()
                .height(AyaSpacing.md)
                .semantics {
                    this.contentDescription = contentDescription
                    progressBarRangeInfo = ProgressBarRangeInfo(target, 0f..1f)
                },
    ) {
        val y = size.height / 2f
        val thin = 1.5.dp.toPx()
        val heavy = 4.dp.toPx()
        // Track: slightly short of both ends, like a ruled pencil line that stops before the margin.
        drawLine(colors.inkSoft.copy(alpha = 0.35f), Offset(heavy / 2f, y + 0.5f), Offset(size.width - heavy, y - 0.5f), thin, StrokeCap.Round)
        if (shown > 0f) {
            val end = heavy / 2f + (size.width - heavy * 1.5f) * shown
            drawLine(colors.accent, Offset(heavy / 2f, y), Offset(end, y), heavy, StrokeCap.Round)
        }
    }
}

/** Paper card one shade deeper than the page. [edge] draws a hand-ruled margin line (gems: ochre; clues: ochre). */
@Composable
fun PaperCard(
    modifier: Modifier = Modifier,
    edge: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Box(modifier = modifier.fillMaxWidth().background(colors.paperDeep, AyaRadius.lg)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(start = if (edge != null) AyaSpacing.lg else AyaSpacing.md, end = AyaSpacing.md, top = AyaSpacing.md, bottom = AyaSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
            content = content,
        )
        if (edge != null) {
            // matchParentSize: the margin line follows the content's height instead of making the card grow.
            Canvas(modifier = Modifier.matchParentSize()) {
                val x = AyaSpacing.sm.toPx() + 1.dp.toPx()
                drawLine(edge, Offset(x, size.height * 0.12f), Offset(x + 0.8f, size.height * 0.88f), 3.dp.toPx(), StrokeCap.Round)
            }
        }
    }
}

@Preview(name = "light", showBackground = true)
@Preview(name = "dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "fontScale 1.5", showBackground = true, fontScale = 1.5f)
@Composable
private fun ControlsPreview() {
    AyaTheme {
        PaperBackground {
            Column(Modifier.padding(AyaSpacing.md), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                SessionProgressBar(progress = 0.4f, contentDescription = "4 / 10")
                AyaTextField(value = "jujur", onValueChange = {}, label = "Jawabanmu", supporting = "Boleh singkat.")
                AyaSecondaryButton(text = "Saya belum tahu", onClick = {})
                PaperCard(edge = AyaThemeTokens.colors.ochre) {
                    Text("Permata", style = MaterialTheme.typography.titleLarge, color = AyaThemeTokens.colors.ink)
                    Text("Satu jam punya 60 menit…", style = MaterialTheme.typography.bodyMedium, color = AyaThemeTokens.colors.ink)
                }
            }
        }
    }
}
