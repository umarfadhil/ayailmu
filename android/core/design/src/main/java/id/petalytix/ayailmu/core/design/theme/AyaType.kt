package id.petalytix.ayailmu.core.design.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import id.petalytix.ayailmu.core.design.R

/**
 * Typography. Headline and body use the system sans until the illustrator's type pairing is chosen
 * (ART_DIRECTION §8). Arabic is Noto Naskh Arabic 2.021 (SIL OFL 1.1, licence in
 * `content/src/main/assets/licenses/`), bundled 2026-10-17 so harakat render the same on every phone (CR-ENG-6).
 */
object AyaFonts {
    val headline: FontFamily = FontFamily.SansSerif
    val body: FontFamily = FontFamily.SansSerif
    val arabic: FontFamily =
        FontFamily(
            Font(R.font.noto_naskh_arabic_regular, FontWeight.Normal),
            Font(R.font.noto_naskh_arabic_bold, FontWeight.Bold),
        )
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
