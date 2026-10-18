package id.petalytix.ayailmu.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

/** A profile's picture: its animal on a round paper disc (never the first letter of its name). */
@Composable
fun ProfileAvatar(
    key: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = AVATAR,
) {
    val colors = AyaThemeTokens.colors
    Box(
        modifier =
            modifier
                .size(size)
                .clip(CircleShape)
                .background(colors.paperDeep)
                .border(RING, colors.inkSoft.copy(alpha = 0.5f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        ArtImage(key = key, contentDescription = contentDescription, modifier = Modifier.fillMaxSize().padding(size * INSET))
    }
}

/** Every avatar as a picture card; the chosen one has the heavy edge. TalkBack reads the animal's name. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AvatarPicker(
    chosen: String?,
    enabled: Boolean,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        Avatars.KEYS.forEach { key ->
            OptionCard(
                state = if (key == chosen) ChoiceState.SELECTED else ChoiceState.IDLE,
                onClick = { onPick(key) },
                enabled = enabled,
                compact = true,
                fillWidth = false,
            ) {
                ProfileAvatar(key = key, contentDescription = stringResource(avatarName(key)), size = PICKER_AVATAR)
            }
        }
    }
}

/** The animal's name, for TalkBack. */
internal fun avatarName(key: String): Int =
    when (key) {
        "pic_cat" -> R.string.avatar_cat
        "pic_dog" -> R.string.avatar_dog
        "pic_rabbit" -> R.string.avatar_rabbit
        "pic_bird" -> R.string.avatar_bird
        "pic_fish" -> R.string.avatar_fish
        "pic_duck" -> R.string.avatar_duck
        "pic_chicken" -> R.string.avatar_chicken
        "pic_cow" -> R.string.avatar_cow
        "pic_goat" -> R.string.avatar_goat
        "pic_horse" -> R.string.avatar_horse
        "pic_elephant" -> R.string.avatar_elephant
        else -> R.string.avatar_monkey
    }

private val AVATAR = 40.dp
private val PICKER_AVATAR = 52.dp
private val RING = 1.4.dp
private const val INSET = 0.12f
