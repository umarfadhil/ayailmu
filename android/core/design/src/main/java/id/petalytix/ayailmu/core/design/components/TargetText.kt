package id.petalytix.ayailmu.core.design.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import id.petalytix.ayailmu.core.design.theme.AyaArabicText
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

/**
 * Text in the language being learned (CR-I18N-3): its own font, size and direction, separate from the
 * instruction language. [scale] is the profile's Arabic text size (never below 22 sp, CR-ENG-6); the system
 * font scale still applies on top because sizes are in sp.
 */
@Composable
fun TargetText(
    text: String,
    modifier: Modifier = Modifier,
    rtl: Boolean = true,
    scale: Float = 1f,
    small: Boolean = false,
    color: Color = AyaThemeTokens.colors.ink,
    textAlign: TextAlign = TextAlign.Start,
) {
    val factor = scale.coerceIn(MIN_SCALE, MAX_SCALE) * (if (small) SMALL_FACTOR else 1f)
    val size: TextUnit = AyaArabicText.fontSize * factor
    val line: TextUnit = AyaArabicText.lineHeight * factor
    val style =
        AyaArabicText.copy(
            fontSize = size,
            lineHeight = line,
            textDirection = if (rtl) TextDirection.Rtl else TextDirection.Content,
        )
    CompositionLocalProvider(LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
        Text(text = text, style = style, color = color, textAlign = textAlign, modifier = modifier)
    }
}

/** 22 sp / 28 sp ≈ 0.8: the smallest Arabic size allowed (CR-ENG-6). */
private const val MIN_SCALE = 0.8f
private const val MAX_SCALE = 2.0f
private const val SMALL_FACTOR = 0.82f

@Preview(name = "light", showBackground = true)
@Preview(name = "dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "fontScale 1.5", showBackground = true, fontScale = 1.5f)
@Composable
private fun TargetTextPreview() {
    AyaTheme {
        PaperBackground {
            Column(Modifier.padding(AyaSpacing.md)) {
                TargetText("هِيَ مُؤْمِنَةٌ", modifier = Modifier.fillMaxWidth())
                TargetText("هُوَ صَادِقٌ", modifier = Modifier.fillMaxWidth(), small = true)
                TargetText("هُوَ صَادِقٌ", modifier = Modifier.fillMaxWidth(), scale = 1.4f)
            }
        }
    }
}
