package id.petalytix.ayailmu.feature.modules

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject

/**
 * A catalog picture, or a related drawing while a new key (MODULES_LEVELS_STORIES.md section 6.1, drawn this round)
 * is not in this build's ArtRegistry yet: never an empty hole and never text in its place (section 8).
 */
@Composable
internal fun ArtWithFallback(
    key: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
) {
    ArtImage(key = key, contentDescription = contentDescription, modifier = modifier, placeholder = {
        ArtImage(key = fallbackArt(key), contentDescription = contentDescription, modifier = modifier)
    })
}

/** The older drawing that stands in for a section 6.1 key until it is drawn. */
internal fun fallbackArt(key: String): String =
    when {
        key.startsWith("cover_lang_") -> "cover_bahasa"
        key.startsWith("level_") -> "state_seedling"
        key == "cover_nilai" || key == "cover_sejarah" || key.startsWith("hist_") -> "cover_sosial_seni"
        else -> "state_seedling"
    }

/**
 * A small badge: its picture and a short word («Korea», «Menengah»). TalkBack reads [description] once for the
 * whole badge.
 */
@Composable
internal fun ArtBadge(
    art: String,
    label: String,
    description: String,
    modifier: Modifier = Modifier,
    size: Dp = BADGE_ART,
) {
    val colors = AyaThemeTokens.colors
    Row(
        modifier =
            modifier
                .background(colors.ochre.copy(alpha = 0.18f), AyaRadius.sm)
                .padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xxs)
                .clearAndSetSemantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs),
    ) {
        ArtWithFallback(art, contentDescription = null, modifier = Modifier.size(size))
        Text(label, style = MaterialTheme.typography.labelLarge, color = colors.ink)
    }
}

private val BADGE_ART = 28.dp

/**
 * A way somewhere drawn as its picture with a short name (the gem box, a sticker, the figure gallery): a plain
 * button for TalkBack, not a choice, so it is never announced as a radio button.
 */
@Composable
internal fun PictureButton(
    picture: String,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    pictureSize: Dp = BUTTON_ART,
) {
    val colors = AyaThemeTokens.colors
    Row(
        modifier =
            modifier
                .heightIn(min = AyaSpacing.touch)
                .clip(AyaRadius.md)
                .background(colors.paperDeep)
                .border(BUTTON_EDGE, colors.inkSoft.copy(alpha = 0.55f), AyaRadius.md)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(AyaSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        ArtWithFallback(picture, contentDescription = null, modifier = Modifier.size(pictureSize))
        Text(label, style = MaterialTheme.typography.labelLarge, color = colors.ink)
    }
}

private val BUTTON_ART = 40.dp
private val BUTTON_EDGE = 1.2.dp

internal fun moduleName(subject: Subject): Int =
    when (subject) {
        Subject.BAHASA -> R.string.module_name_bahasa
        Subject.MATEMATIKA -> R.string.module_name_matematika
        Subject.SAINS -> R.string.module_name_sains
        Subject.SOSIAL_SENI -> R.string.module_name_sosial_seni
        Subject.NILAI -> R.string.module_name_nilai
        Subject.SEJARAH -> R.string.module_name_sejarah
    }

internal fun languageName(language: ModuleLanguage): Int =
    when (language) {
        ModuleLanguage.ARAB -> R.string.module_lang_ar
        ModuleLanguage.INGGRIS -> R.string.module_lang_en
        ModuleLanguage.KOREA -> R.string.module_lang_ko
        ModuleLanguage.JEPANG -> R.string.module_lang_ja
        ModuleLanguage.MANDARIN -> R.string.module_lang_zh
    }

internal fun levelName(level: Level): Int =
    when (level) {
        Level.PEMULA -> R.string.level_name_pemula
        Level.MENENGAH -> R.string.level_name_menengah
        Level.MAHIR -> R.string.level_name_mahir
        Level.MASTER -> R.string.level_name_master
    }

/** What a level means for this audience (framework section 1: kids follow the SD phases, adults real-life use). */
internal fun levelDescription(
    level: Level,
    audience: Audience,
): Int =
    when (audience) {
        Audience.KIDS ->
            when (level) {
                Level.PEMULA -> R.string.level_desc_pemula_kids
                Level.MENENGAH -> R.string.level_desc_menengah_kids
                Level.MAHIR -> R.string.level_desc_mahir_kids
                Level.MASTER -> R.string.level_desc_master_kids
            }
        Audience.ADULTS ->
            when (level) {
                Level.PEMULA -> R.string.level_desc_pemula_adults
                Level.MENENGAH -> R.string.level_desc_menengah_adults
                Level.MAHIR -> R.string.level_desc_mahir_adults
                Level.MASTER -> R.string.level_desc_master_adults
            }
    }
