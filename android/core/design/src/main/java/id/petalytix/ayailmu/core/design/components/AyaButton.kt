package id.petalytix.ayailmu.core.design.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

/** Primary action. Flat clay on paper, no elevation or gradient (ART_DIRECTION §2.5); ≥ 48 dp tall. */
@Composable
fun AyaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = AyaThemeTokens.colors
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = AyaSpacing.touch),
        shape = AyaRadius.md,
        elevation = null,
        colors =
            ButtonDefaults.buttonColors(
                containerColor = colors.accent,
                contentColor = colors.paper,
                disabledContainerColor = colors.paperDeep,
                disabledContentColor = colors.inkSoft,
            ),
        contentPadding = PaddingValues(horizontal = AyaSpacing.lg, vertical = AyaSpacing.sm),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}

@Preview(name = "light", showBackground = true)
@Preview(name = "dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "fontScale 1.5", showBackground = true, fontScale = 1.5f)
@Composable
private fun AyaButtonPreview() {
    AyaTheme {
        PaperBackground {
            AyaButton(text = "Mulai", onClick = {})
        }
    }
}
