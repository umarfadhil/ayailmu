package id.petalytix.ayailmu.core.design.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The AyaIlmu palette (ART_DIRECTION §2.3): paper, ink, clay, ochre, sage, slate — few and muted.
 * These are starting values; the illustrator's style bible (P4) replaces the hex codes, not the roles.
 * UI text must still meet 4.5:1 on paper (CR-A11Y-1); the illustration palette is exempt, UI is not.
 */
object AyaPalette {
    val Paper = Color(0xFFF6F1E7)
    val PaperDeep = Color(0xFFEDE5D6)
    val Ink = Color(0xFF2B2A28)
    val InkSoft = Color(0xFF5A5650)
    val Clay = Color(0xFFC4613A)
    val ClayDeep = Color(0xFF9E4A2A)
    val Ochre = Color(0xFFD9A441)
    val Sage = Color(0xFF8A9A77)
    val SageDeep = Color(0xFF66765A)
    val Slate = Color(0xFF5B6B80)
    val SlateDeep = Color(0xFF42506A)

    // Night paper: the same materials under lamplight, never pure black.
    val NightPaper = Color(0xFF1F1D1A)
    val NightPaperDeep = Color(0xFF2A2724)
    val NightInk = Color(0xFFEDE6DA)
    val NightInkSoft = Color(0xFFB8B0A4)
}

/** Semantic roles the components read; see [AyaTheme] for the Material mapping. */
@Immutable
data class AyaColorRoles(
    val paper: Color,
    val paperDeep: Color,
    val ink: Color,
    val inkSoft: Color,
    val accent: Color,
    val accentDeep: Color,
    val ochre: Color,
    val sage: Color,
    val slate: Color,
    val correct: Color,
    val notYet: Color,
    val isDark: Boolean,
)

val LightAyaColors =
    AyaColorRoles(
        paper = AyaPalette.Paper,
        paperDeep = AyaPalette.PaperDeep,
        ink = AyaPalette.Ink,
        inkSoft = AyaPalette.InkSoft,
        accent = AyaPalette.Clay,
        accentDeep = AyaPalette.ClayDeep,
        ochre = AyaPalette.Ochre,
        sage = AyaPalette.Sage,
        slate = AyaPalette.Slate,
        correct = AyaPalette.SageDeep,
        notYet = AyaPalette.ClayDeep,
        isDark = false,
    )

val DarkAyaColors =
    AyaColorRoles(
        paper = AyaPalette.NightPaper,
        paperDeep = AyaPalette.NightPaperDeep,
        ink = AyaPalette.NightInk,
        inkSoft = AyaPalette.NightInkSoft,
        accent = AyaPalette.Clay,
        accentDeep = AyaPalette.Ochre,
        ochre = AyaPalette.Ochre,
        sage = AyaPalette.Sage,
        slate = AyaPalette.Slate,
        correct = AyaPalette.Sage,
        notYet = AyaPalette.Clay,
        isDark = true,
    )

val LocalAyaColors = staticCompositionLocalOf { LightAyaColors }
