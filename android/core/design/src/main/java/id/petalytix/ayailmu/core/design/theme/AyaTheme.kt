package id.petalytix.ayailmu.core.design.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

/**
 * App theme. Material 3 is the substrate (accessibility, text fields, dialogs); the look comes from
 * [AyaColorRoles], [AyaTypography] and the components in `components/`. No dynamic colour: the palette is
 * part of the hand-made identity (ART_DIRECTION §2).
 */
@Composable
fun AyaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val roles = if (darkTheme) DarkAyaColors else LightAyaColors
    val scheme =
        if (darkTheme) {
            darkColorScheme(
                primary = roles.accent,
                onPrimary = roles.paper,
                secondary = roles.sage,
                onSecondary = roles.paper,
                tertiary = roles.slate,
                background = roles.paper,
                onBackground = roles.ink,
                surface = roles.paper,
                onSurface = roles.ink,
                surfaceVariant = roles.paperDeep,
                onSurfaceVariant = roles.inkSoft,
                error = roles.notYet,
                onError = roles.paper,
                outline = roles.inkSoft,
            )
        } else {
            lightColorScheme(
                primary = roles.accent,
                onPrimary = roles.paper,
                secondary = roles.sage,
                onSecondary = roles.paper,
                tertiary = roles.slate,
                background = roles.paper,
                onBackground = roles.ink,
                surface = roles.paper,
                onSurface = roles.ink,
                surfaceVariant = roles.paperDeep,
                onSurfaceVariant = roles.inkSoft,
                error = roles.notYet,
                onError = roles.paper,
                outline = roles.inkSoft,
            )
        }

    CompositionLocalProvider(LocalAyaColors provides roles) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AyaTypography,
            content = content,
        )
    }
}

/** Convenience accessor: `AyaTheme.colors.accent`. */
object AyaThemeTokens {
    val colors: AyaColorRoles
        @Composable @ReadOnlyComposable
        get() = LocalAyaColors.current
}
