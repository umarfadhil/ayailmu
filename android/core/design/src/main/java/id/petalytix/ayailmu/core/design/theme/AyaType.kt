package id.petalytix.ayailmu.core.design.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Typography. P0 uses the system sans so the project compiles without font files; the headline/body pairing
 * is shortlisted at the P3 gate (ART_DIRECTION §8). Noto Naskh Arabic is bundled in P1 together with the
 * first Arabic pack (CR-ENG-6) and exposed here as [AyaFonts.arabic].
 */
object AyaFonts {
    val headline: FontFamily = FontFamily.SansSerif
    val body: FontFamily = FontFamily.SansSerif
    val arabic: FontFamily = FontFamily.Serif // placeholder until noto_naskh_arabic.ttf lands (P1)
}

val AyaTypography =
    Typography(
        displaySmall =
            TextStyle(
                fontFamily = AyaFonts.headline,
                fontWeight = FontWeight.SemiBold,
                fontSize = 34.sp,
                lineHeight = 40.sp,
            ),
        headlineMedium =
            TextStyle(
                fontFamily = AyaFonts.headline,
                fontWeight = FontWeight.SemiBold,
                fontSize = 26.sp,
                lineHeight = 32.sp,
            ),
        titleLarge =
            TextStyle(
                fontFamily = AyaFonts.headline,
                fontWeight = FontWeight.Medium,
                fontSize = 20.sp,
                lineHeight = 26.sp,
            ),
        bodyLarge =
            TextStyle(
                fontFamily = AyaFonts.body,
                fontWeight = FontWeight.Normal,
                fontSize = 17.sp,
                lineHeight = 26.sp,
            ),
        bodyMedium =
            TextStyle(
                fontFamily = AyaFonts.body,
                fontWeight = FontWeight.Normal,
                fontSize = 15.sp,
                lineHeight = 22.sp,
            ),
        labelLarge =
            TextStyle(
                fontFamily = AyaFonts.body,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                lineHeight = 20.sp,
            ),
        labelSmall =
            TextStyle(
                fontFamily = AyaFonts.body,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
    )

/** Arabic learner text: full harakat, never below 22 sp, user-scalable in Settings (CR-ENG-6). */
val AyaArabicText =
    TextStyle(
        fontFamily = AyaFonts.arabic,
        fontSize = 28.sp,
        lineHeight = 48.sp,
    )
