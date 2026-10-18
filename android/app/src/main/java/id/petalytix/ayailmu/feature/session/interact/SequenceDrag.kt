package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

/**
 * order, tiles and fill_blank with gesture "drag": numbered places (or, for a fill_blank sentence with one gap per
 * place, the gaps inside the sentence) above a pool of tiles. Drag a tile into a place, drag placed tiles to
 * reorder them or back to the pool; tapping still works (a free tile goes to the next place, a placed one comes
 * back). The answer is the tiles in place order (AnswerDraft.toResponse).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SequenceDragBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val sfx = LocalSoundFx.current
    val reduceMotion = rememberReduceMotion()
    val scope = rememberCoroutineScope()
    val dnd = remember(q.itemId) { DragDropState() }
    val byId = remember(q.itemId) { q.options.associateBy { it.id } }
    val numbers = remember(q.itemId) { q.options.mapIndexed { i, o -> o.id to i + 1 }.toMap() }
    val parts = SlotBoard.inlineParts(q)
    // Target-language tiles (and a target sentence with its gaps) flow right to left for Arabic.
    val rtlTiles = ts.rtl && (if (parts != null) q.blankInTarget else q.options.any { it.target != null })
    val dropSlop = with(LocalDensity.current) { DROP_SLOP.toPx() }
    val putLabels = (1..q.slots).map { stringResource(R.string.interact_put_in_slot, it) }
    val takeOut = stringResource(R.string.interact_take_out)

    fun release(id: String) {
        val f = dnd.finger
        val hit = dnd.targets.hit(f.x, f.y, dropSlop)
        val slot = hit?.takeIf { it.startsWith(SLOT) }?.removePrefix(SLOT)?.toIntOrNull()
        when {
            slot != null -> {
                sfx.play(Sfx.SNAP)
                dnd.land(scope, reduceMotion) { draft.dropInSlot(id, slot, q.slots) }
            }
            hit == POOL && id in draft.placed -> {
                sfx.play(Sfx.TAP)
                dnd.land(scope, reduceMotion) { draft.takeBack(id) }
            }
            hit == null -> {
                sfx.play(Sfx.DROP)
                dnd.land(scope, reduceMotion) {}
            }
            else -> dnd.land(scope, reduceMotion) {}
        }
    }

    @Composable
    fun Tile(o: OptionUi) {
        val at = draft.placed.indexOf(o.id)
        val actions =
            (0 until q.slots).filter { it != at }.map { i ->
                CustomAccessibilityAction(putLabels[i]) {
                    sfx.play(Sfx.SNAP)
                    draft.dropInSlot(o.id, i, q.slots)
                    true
                }
            } +
                listOfNotNull(
                    if (at >= 0) {
                        CustomAccessibilityAction(takeOut) {
                            draft.takeBack(o.id)
                            true
                        }
                    } else {
                        null
                    },
                )
        DragCard(
            o = o,
            number = numbers.getValue(o.id),
            ts = ts,
            dnd = dnd,
            // Free tiles stay draggable when every place is full: a drop swaps out the tile in that place.
            enabled = enabled,
            selected = false,
            stateText = if (at >= 0) stringResource(R.string.interact_in_slot, at + 1) else null,
            actions = actions,
            onTap = {
                val placing = at < 0
                // Tapping a free tile when every place is full does nothing (drag it onto a place to swap).
                if (!placing || draft.placed.size < q.slots) {
                    sfx.play(if (placing) Sfx.SNAP else Sfx.TAP)
                    dnd.tapMove(o.id, scope, reduceMotion) { draft.place(o.id, q.slots) }
                }
            },
            onRelease = { release(o.id) },
        )
    }

    @Composable
    fun Place(i: Int) {
        val tile = draft.placed.getOrNull(i)?.let { byId[it] }
        val over = dnd.phase == DragDropState.Phase.DRAGGING && dnd.targets[SLOT + i]?.contains(dnd.finger.x, dnd.finger.y) == true
        val description = stringResource(R.string.interact_slot_empty_cd, i + 1)
        Box(
            modifier =
                Modifier
                    .widthIn(min = PLACE_MIN_WIDTH)
                    .heightIn(min = PLACE_MIN_HEIGHT)
                    .onGloballyPositioned { dnd.targets.put(SLOT + i, it.rootRect().toHitBox()) }
                    .drawBehind {
                        drawRoundRect(
                            color = if (over) colors.accent else colors.inkSoft.copy(alpha = 0.6f),
                            cornerRadius = CornerRadius(10.dp.toPx()),
                            style =
                                Stroke(
                                    width = (if (over) 2.4.dp else 1.4.dp).toPx(),
                                    pathEffect = if (tile == null) PathEffect.dashPathEffect(floatArrayOf(9f, 7f)) else null,
                                ),
                        )
                    }
                    // An empty place is read as "Place 2, empty"; a filled one lets its tile speak for itself.
                    .then(if (tile == null) Modifier.clearAndSetSemantics { contentDescription = description } else Modifier)
                    .padding(AyaSpacing.xxs),
            contentAlignment = Alignment.Center,
        ) {
            if (tile != null) {
                key(tile.id) { Tile(tile) }
            } else {
                Text((i + 1).toString(), style = MaterialTheme.typography.labelLarge, color = colors.inkSoft)
            }
        }
    }

    Text(stringResource(R.string.interact_sequence_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    Box(modifier = Modifier.fillMaxWidth().onGloballyPositioned { dnd.origin = it.positionInRoot() }) {
        Column(verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            val direction = if (rtlTiles) LayoutDirection.Rtl else LocalLayoutDirection.current
            CompositionLocalProvider(LocalLayoutDirection provides direction) {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs),
                    verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
                ) {
                    if (parts != null) {
                        // The sentence, word by word so it wraps naturally, with a place in each gap.
                        parts.forEachIndexed { i, part ->
                            part.split(' ').filter { it.isNotEmpty() }.forEach { word ->
                                val centered = Modifier.align(Alignment.CenterVertically)
                                if (q.blankInTarget) {
                                    TargetLine(word, ts, modifier = centered)
                                } else {
                                    Text(word, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = centered)
                                }
                            }
                            if (i < q.slots) Place(i)
                        }
                    } else {
                        (0 until q.slots).forEach { Place(it) }
                    }
                }
            }
            if (parts != null && q.blankInTarget) q.romanization?.let { RomanizationLine(it) }
            val free = q.options.filter { it.id !in draft.placed }
            FlowRow(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = PLACE_MIN_HEIGHT)
                        .onGloballyPositioned { dnd.targets.put(POOL, it.rootRect().toHitBox()) },
                horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
            ) {
                free.forEach { key(it.id) { Tile(it) } }
            }
        }
        DragOverlay(dnd) { id -> byId[id]?.let { LiftedCard { CompactFace(it, ts, numbers.getValue(id), speaker = false) } } }
    }
}

private const val POOL = "pool"
private const val SLOT = "slot:"
private val PLACE_MIN_WIDTH = 64.dp
private val PLACE_MIN_HEIGHT = 56.dp
