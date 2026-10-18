package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.TargetStyle

/**
 * A card that can be dragged (pool, target, basket or answer place) and also tapped (tap-then-tap). While it is
 * in the air its own place shows a faint ghost; while the floating copy settles into the new place, the card
 * there stays invisible until the copy arrives. [onRelease] decides where it lands (DragDropState.land).
 */
@Composable
internal fun DragCard(
    o: OptionUi,
    number: Int,
    ts: TargetStyle,
    dnd: DragDropState,
    enabled: Boolean,
    selected: Boolean,
    stateText: String?,
    actions: List<CustomAccessibilityAction>,
    onTap: () -> Unit,
    onRelease: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sfx = LocalSoundFx.current
    val release by rememberUpdatedState(onRelease)
    val alpha =
        when {
            dnd.active != o.id -> 1f
            dnd.phase == DragDropState.Phase.DRAGGING -> GHOST_ALPHA
            dnd.phase == DragDropState.Phase.FLYING -> 0f
            else -> 1f
        }
    OptionCard(
        state = if (selected) ChoiceState.SELECTED else ChoiceState.IDLE,
        enabled = enabled,
        compact = true,
        fillWidth = false,
        onClick = onTap,
        modifier =
            modifier
                .onGloballyPositioned { dnd.cards[o.id] = it.rootRect() }
                .alpha(alpha)
                // Keyed by the board too: a new question gets a new DragDropState, never a stale one.
                .pointerInput(dnd, o.id, enabled) {
                    if (!enabled) return@pointerInput
                    detectCardDrag(
                        onStart = { down -> dnd.begin(o.id, down).also { if (it) sfx.play(Sfx.PICK) } },
                        onMove = { dnd.move(it) },
                        onEnd = { if (dnd.active == o.id && dnd.phase == DragDropState.Phase.DRAGGING) release() },
                        onCancel = { if (dnd.active == o.id) dnd.cancel() },
                    )
                }.semantics {
                    // After "Check" the board is read-only for screen readers too.
                    if (enabled) customActions = actions
                    stateText?.let { stateDescription = it }
                },
    ) {
        CompactFace(o, ts, number)
    }
}

/**
 * A card face that only takes the room it needs (cards sit side by side in a flowing row): a picture at a fixed
 * height, target text with its reading aid, or plain text; plus the speaker when a word card has a clip (never on a
 * picture: saying its word would give the match away, see OptionFace).
 */
@Composable
internal fun CompactFace(
    o: OptionUi,
    ts: TargetStyle,
    number: Int,
    pictureHeight: Dp = CARD_PICTURE,
    speaker: Boolean = true,
) {
    val colors = AyaThemeTokens.colors
    val label = optionLabel(o, number)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
        when {
            o.image != null ->
                ArtImage(
                    key = o.image,
                    contentDescription = label,
                    modifier = Modifier.height(pictureHeight),
                    placeholder = { CompactPlaceholder(pictureHeight) },
                )
            o.target != null ->
                Column {
                    TargetLine(o.target, ts, small = true)
                    o.romanization?.let { RomanizationLine(it) }
                }
            o.text != null -> Text(o.text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        }
        if (speaker && o.image == null) SpeakerButton(o.audio, label)
    }
}

/** A picture with no drawing yet, at card size: a dashed square (the full-size placeholder names the key). */
@Composable
private fun CompactPlaceholder(side: Dp) {
    val colors = AyaThemeTokens.colors
    Box(
        modifier =
            Modifier
                .size(side)
                .padding(AyaSpacing.xxs)
                .drawBehind {
                    drawRoundRect(
                        color = colors.inkSoft,
                        cornerRadius = CornerRadius(6.dp.toPx()),
                        style = Stroke(width = 1.2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))),
                    )
                },
    )
}

private const val GHOST_ALPHA = 0.3f
private val CARD_PICTURE = 64.dp
