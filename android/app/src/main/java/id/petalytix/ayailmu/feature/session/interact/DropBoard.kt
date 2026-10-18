package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.OptionFace
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

/**
 * Drag each card onto its target: match_pairs with gesture "drag" ([oneToOne]: a target holds one card, usually a
 * picture onto its word) and sort_buckets (baskets drawn as paper trays, any number of cards each). Free cards wait
 * in a pool at the top. A card dropped on a target settles into it; dropped anywhere else it slides back. Cards
 * already placed can be dragged to another target or back to the pool. Tap-then-tap works everywhere (tap a card,
 * then its target; tap a placed card to take it out), and screen readers get one action per target.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DropBoardBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    oneToOne: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val sfx = LocalSoundFx.current
    val reduceMotion = rememberReduceMotion()
    val scope = rememberCoroutineScope()
    val dnd = remember(q.itemId) { DragDropState() }
    val numbers = remember(q.itemId) { (q.left + q.right).mapIndexed { i, o -> o.id to i + 1 }.toMap() }
    val byId = remember(q.itemId) { q.left.associateBy { it.id } }
    val dropSlop = with(LocalDensity.current) { DROP_SLOP.toPx() }
    val targetLabels = q.right.associate { it.id to optionLabel(it, numbers.getValue(it.id)) }
    val putInRes = if (oneToOne) R.string.interact_pair_with else R.string.interact_put_in
    val inTargetRes = if (oneToOne) R.string.interact_linked_to else R.string.interact_in_basket
    val putIn = targetLabels.mapValues { (_, label) -> stringResource(putInRes, label) }
    val inTarget = targetLabels.mapValues { (_, label) -> stringResource(inTargetRes, label) }
    val takeOut = stringResource(R.string.interact_take_out)
    val selectedText = stringResource(R.string.interact_selected)

    fun linkTo(
        id: String,
        target: String,
    ) {
        sfx.play(Sfx.SNAP)
        dnd.tapMove(id, scope, reduceMotion) { draft.link(id, target, oneToOne) }
    }

    fun takeBack(id: String) {
        sfx.play(Sfx.TAP)
        dnd.tapMove(id, scope, reduceMotion) { draft.unlink(id) }
    }

    /** Where a dragged card lands when the finger lifts. */
    fun release(id: String) {
        val f = dnd.finger
        val hit = dnd.targets.hit(f.x, f.y, dropSlop)
        val now = draft.pairs[id]
        when {
            hit == POOL && now != null -> {
                sfx.play(Sfx.TAP)
                dnd.land(scope, reduceMotion) { draft.unlink(id) }
            }
            hit != null && hit != POOL && hit.removePrefix(TARGET) != now -> {
                sfx.play(Sfx.SNAP)
                dnd.land(scope, reduceMotion) { draft.link(id, hit.removePrefix(TARGET), oneToOne) }
            }
            hit == null -> {
                sfx.play(Sfx.DROP)
                dnd.land(scope, reduceMotion) {}
            }
            else -> dnd.land(scope, reduceMotion) {}
        }
    }

    @Composable
    fun Card(o: OptionUi) {
        val placedIn = draft.pairs[o.id]
        val actions =
            q.right.filter { it.id != placedIn }.map { t ->
                CustomAccessibilityAction(putIn.getValue(t.id)) {
                    linkTo(o.id, t.id)
                    true
                }
            } +
                listOfNotNull(
                    placedIn?.let {
                        CustomAccessibilityAction(takeOut) {
                            takeBack(o.id)
                            true
                        }
                    },
                )
        DragCard(
            o = o,
            number = numbers.getValue(o.id),
            ts = ts,
            dnd = dnd,
            enabled = enabled,
            selected = draft.activeLeft == o.id,
            stateText = placedIn?.let { inTarget[it] } ?: selectedText.takeIf { draft.activeLeft == o.id },
            actions = actions,
            onTap = {
                if (placedIn != null) {
                    // A placed card comes out and stays picked, ready for another target.
                    sfx.play(Sfx.TAP)
                    dnd.tapMove(o.id, scope, reduceMotion) { draft.tapCard(o.id, left = true, oneToOne = oneToOne) }
                } else if (draft.tapCard(o.id, left = true, oneToOne = oneToOne) != PairBoard.Event.NONE) {
                    sfx.play(Sfx.TAP)
                }
            },
            onRelease = { release(o.id) },
        )
    }

    Text(
        stringResource(if (oneToOne) R.string.interact_drag_pairs_hint else R.string.interact_buckets_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = colors.inkSoft,
    )
    Box(modifier = Modifier.fillMaxWidth().onGloballyPositioned { dnd.origin = it.positionInRoot() }) {
        Column(verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            val free = q.left.filter { it.id !in draft.pairs }
            FlowRow(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = POOL_MIN)
                        .onGloballyPositioned { dnd.targets.put(POOL, it.rootRect().toHitBox()) }
                        .dashedFrame(colors.inkSoft.copy(alpha = 0.45f))
                        .padding(AyaSpacing.sm),
                horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
            ) {
                free.forEach { key(it.id) { Card(it) } }
                if (free.isEmpty()) {
                    Text(stringResource(R.string.interact_pool_empty), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                }
            }
            if (oneToOne) {
                q.right.forEach { t ->
                    val card = PairBoard.partnerOf(draft.pairs, t.id)?.let { byId[it] }
                    val cardLabel = card?.let { optionLabel(it, numbers.getValue(it.id)) }
                    val tap: () -> Unit = { draft.activeLeft?.let { linkTo(it, t.id) } }
                    PairTarget(t, numbers.getValue(t.id), cardLabel, dnd, enabled, ts, onTap = tap) {
                        card?.let { key(it.id) { Card(it) } }
                    }
                }
            } else {
                q.right.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                        row.forEach { t ->
                            val inside = PairBoard.inTarget(draft.pairs, t.id, q.left.map { it.id }).mapNotNull { byId[it] }
                            val tap: () -> Unit = { draft.activeLeft?.let { linkTo(it, t.id) } }
                            Tray(t, numbers.getValue(t.id), dnd, enabled, ts, Modifier.weight(1f), onTap = tap) {
                                inside.forEach { key(it.id) { Card(it) } }
                            }
                        }
                        if (row.size == 1 && q.right.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        DragOverlay(dnd) { id -> byId[id]?.let { LiftedCard { CompactFace(it, ts, numbers.getValue(id), speaker = false) } } }
    }
}

/** match_pairs drag target: a dashed place for the card beside the target's own word or picture. */
@Composable
private fun PairTarget(
    t: OptionUi,
    number: Int,
    cardLabel: String?,
    dnd: DragDropState,
    enabled: Boolean,
    ts: TargetStyle,
    onTap: () -> Unit,
    slot: @Composable () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val empty = stringResource(R.string.interact_empty)
    val holds = cardLabel?.let { stringResource(R.string.interact_linked_to, it) }
    val over = dnd.phase == DragDropState.Phase.DRAGGING && dnd.targets[TARGET + t.id]?.contains(dnd.finger.x, dnd.finger.y) == true
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = TARGET_MIN)
                .onGloballyPositioned { dnd.targets.put(TARGET + t.id, it.rootRect().toHitBox()) }
                .clickable(enabled = enabled, role = Role.Button, onClick = onTap)
                .semantics { stateDescription = holds ?: empty },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .heightIn(min = TARGET_MIN)
                    .dashedFrame(if (over) colors.accent else colors.inkSoft.copy(alpha = 0.55f), dashed = cardLabel == null && !over)
                    .padding(AyaSpacing.xs),
            contentAlignment = Alignment.Center,
        ) {
            slot()
        }
        Box(modifier = Modifier.weight(1f)) { OptionFace(t, ts, pictureHeight = TARGET_PICTURE, fallbackLabel = optionLabel(t, number)) }
    }
}

/** sort_buckets basket: a drawn paper tray (wobbly pencil sides, a heavier rim) with its label and its cards. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Tray(
    t: OptionUi,
    number: Int,
    dnd: DragDropState,
    enabled: Boolean,
    ts: TargetStyle,
    modifier: Modifier,
    onTap: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val over = dnd.phase == DragDropState.Phase.DRAGGING && dnd.targets[TARGET + t.id]?.contains(dnd.finger.x, dnd.finger.y) == true
    val edge = if (over) colors.accent else colors.inkSoft
    Column(
        modifier =
            modifier
                .heightIn(min = TRAY_MIN)
                .onGloballyPositioned { dnd.targets.put(TARGET + t.id, it.rootRect().toHitBox()) }
                .drawBehind { drawTray(t.id, colors.paperDeep, edge) }
                .clickable(enabled = enabled, role = Role.Button, onClick = onTap)
                .padding(horizontal = AyaSpacing.md, vertical = AyaSpacing.md),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        OptionFace(t, ts, pictureHeight = TARGET_PICTURE, fallbackLabel = optionLabel(t, number))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
            content()
        }
    }
}

/** The tray: a paper fill a little wider at the rim, pencil sides and bottom, and a heavier rim line. */
private fun DrawScope.drawTray(
    id: String,
    fill: Color,
    edge: Color,
) {
    val w = size.width
    val h = size.height
    val rim = 6.dp.toPx()
    val slant = 8.dp.toPx()
    val bottom = h - 2.dp.toPx()
    val body =
        Path().apply {
            moveTo(0f, rim)
            lineTo(w, rim + 1f)
            lineTo(w - slant, bottom)
            lineTo(slant, bottom - 1f)
            close()
        }
    drawPath(body, fill)
    drawPencil(Offset(0f, rim), Offset(slant, bottom - 1f), PencilPath.seedOf(id, "left"), 1f, edge.copy(alpha = 0.7f))
    drawPencil(Offset(w, rim + 1f), Offset(w - slant, bottom), PencilPath.seedOf(id, "right"), 1f, edge.copy(alpha = 0.7f))
    drawPencil(Offset(slant, bottom - 1f), Offset(w - slant, bottom), PencilPath.seedOf(id, "bottom"), 1f, edge.copy(alpha = 0.8f))
    drawPencil(Offset(-1f, rim), Offset(w + 1f, rim + 1f), PencilPath.seedOf(id, "rim"), 1f, edge)
}

/** A hand-ruled frame: dashed while empty (a place waiting for a card), solid once something is there. */
private fun Modifier.dashedFrame(
    color: Color,
    dashed: Boolean = true,
): Modifier =
    drawBehind {
        drawRoundRect(
            color = color,
            cornerRadius = CornerRadius(10.dp.toPx()),
            style =
                Stroke(
                    width = 1.4.dp.toPx(),
                    pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(10f, 7f)) else null,
                ),
        )
    }

private const val POOL = "pool"
private const val TARGET = "t:"
private val POOL_MIN = 64.dp
private val TARGET_MIN = 64.dp
private val TRAY_MIN = 132.dp
private val TARGET_PICTURE = 72.dp
