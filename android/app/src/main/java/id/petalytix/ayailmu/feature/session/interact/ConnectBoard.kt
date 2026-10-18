package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.OptionFace
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

/** Where the cards of a connect board are (root pixels) and the line being drawn by the finger. One per question. */
@Stable
private class ConnectState {
    /** Card rectangles by [key]: read while drawing, so a layout change redraws the lines. */
    val rects = mutableStateMapOf<String, Rect>()
    val targets = DropTargets()
    var origin by mutableStateOf(Offset.Zero)
    var boardMid by mutableStateOf(0f)

    /** The card a line is being drawn from, and the finger (root pixels). */
    var from by mutableStateOf<PairPick?>(null)
    var finger by mutableStateOf(Offset.Zero)

    fun key(
        id: String,
        left: Boolean,
    ): String = (if (left) "L:" else "R:") + id

    /** The dot of a card: the middle of its edge that faces the other column (root pixels). */
    fun dot(
        id: String,
        left: Boolean,
    ): Offset? {
        val r = rects[key(id, left)] ?: return null
        return Offset(if (r.center.x < boardMid) r.right else r.left, r.center.y)
    }

    fun place(
        id: String,
        left: Boolean,
        r: Rect,
    ) {
        val k = key(id, left)
        if (rects[k] != r) rects[k] = r
        targets.put(k, r.toHitBox())
    }
}

/**
 * match_pairs with gesture "connect": two columns of cards. Drag from a card (its dot) to its partner, or tap one
 * and then the other; a pencil line is drawn on in at most 250 ms. Tapping a line or a linked card removes the
 * link. Check is enabled when every left card is linked (AnswerDraft.toResponse).
 */
@Composable
internal fun ConnectPairsBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val sfx = LocalSoundFx.current
    val reduceMotion = rememberReduceMotion()
    val board = remember(q.itemId) { ConnectState() }
    val leftIds = remember(q.itemId) { q.left.map { it.id }.toSet() }
    val tapSlop = with(LocalDensity.current) { LINE_TAP.toPx() }
    Text(stringResource(R.string.interact_connect_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .onGloballyPositioned {
                    val o = it.positionInRoot()
                    board.origin = o
                    board.boardMid = o.x + it.size.width / 2f
                }.pointerInput(enabled, q.itemId) {
                    if (!enabled) return@pointerInput
                    // Taps that no card took (a card consumes its own tap, a scroll consumes the move): a tap on or
                    // near a pencil line removes that link. The down is not consumed, so the page still scrolls.
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        val up = waitForUpOrCancellation() ?: return@awaitEachGesture
                        val p = up.position
                        val lines =
                            draft.pairs
                                .filterKeys { it in leftIds }
                                .mapNotNull { (l, r) ->
                                    val a = board.dot(l, true) ?: return@mapNotNull null
                                    val b = board.dot(r, false) ?: return@mapNotNull null
                                    val o = board.origin
                                    l to Segment(a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y)
                                }.toMap()
                        DropTargets.nearestLine(p.x, p.y, lines, tapSlop)?.let {
                            up.consume()
                            draft.unlink(it)
                            sfx.play(Sfx.TAP)
                        }
                    }
                },
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                q.left.forEachIndexed { i, o ->
                    ConnectCard(o, i + 1, left = true, others = q.right, firstOther = q.left.size + 1, board, draft, enabled, ts)
                }
            }
            Spacer(Modifier.width(AyaSpacing.xxl))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                q.right.forEachIndexed { i, o ->
                    ConnectCard(o, q.left.size + i + 1, left = false, others = q.left, firstOther = 1, board, draft, enabled, ts)
                }
            }
        }
        draft.pairs.filterKeys { it in leftIds }.forEach { (l, r) ->
            key(l, r) { PencilLink(board, l, r, colors.ink, reduceMotion, Modifier.matchParentSize()) }
        }
        Canvas(modifier = Modifier.matchParentSize()) {
            val o = board.origin
            val dotR = DOT.toPx()
            val edge = 1.6.dp.toPx()
            fun dotAt(
                id: String,
                left: Boolean,
            ) {
                val d = board.dot(id, left) ?: return
                val c = d - o
                val linked = if (left) id in draft.pairs else draft.pairs.containsValue(id)
                val active = draft.pick == PairPick(id, left) || board.from == PairPick(id, left)
                drawCircle(colors.paper, dotR, c)
                when {
                    active -> drawCircle(colors.accent, dotR, c)
                    linked -> drawCircle(colors.ink, dotR * 0.8f, c)
                    else -> drawCircle(colors.inkSoft, dotR, c, style = Stroke(edge))
                }
            }
            q.left.forEach { dotAt(it.id, true) }
            q.right.forEach { dotAt(it.id, false) }
            // The line under the finger: straight and light until it lands on a partner.
            board.from?.let { f ->
                val d = board.dot(f.id, f.left) ?: return@let
                drawLine(colors.accent.copy(alpha = 0.7f), d - o, board.finger - o, strokeWidth = 2.4.dp.toPx(), cap = StrokeCap.Round)
            }
        }
    }
}

@Composable
private fun ConnectCard(
    o: OptionUi,
    number: Int,
    left: Boolean,
    others: List<OptionUi>,
    firstOther: Int,
    board: ConnectState,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
) {
    val sfx = LocalSoundFx.current
    val me = PairPick(o.id, left)
    val partnerId = if (left) draft.pairs[o.id] else PairBoard.partnerOf(draft.pairs, o.id)
    val partner = others.firstOrNull { it.id == partnerId }
    val stateText =
        when {
            draft.pick == me -> stringResource(R.string.interact_selected)
            partner != null -> stringResource(R.string.interact_linked_to, optionLabel(partner, others.indexOf(partner) + firstOther))
            else -> null
        }
    val actions =
        others.mapIndexed { i, other ->
            CustomAccessibilityAction(stringResource(R.string.interact_pair_with, optionLabel(other, i + firstOther))) {
                if (left) draft.link(o.id, other.id, oneToOne = true) else draft.link(other.id, o.id, oneToOne = true)
                sfx.play(Sfx.CONNECT)
                true
            }
        } +
            listOfNotNull(
                partner?.let {
                    CustomAccessibilityAction(stringResource(R.string.interact_unlink)) {
                        draft.unlink(if (left) o.id else it.id)
                        true
                    }
                },
            )
    val opposite = others.map { board.key(it.id, !left) }
    val dropSlop = with(LocalDensity.current) { DROP_SLOP.toPx() }
    val current by rememberUpdatedState(opposite)
    OptionCard(
        state = if (draft.pick == me || board.from == me) ChoiceState.SELECTED else ChoiceState.IDLE,
        enabled = enabled,
        compact = true,
        onClick = {
            when (draft.tapCard(o.id, left, oneToOne = true)) {
                PairBoard.Event.LINKED -> sfx.play(Sfx.CONNECT)
                PairBoard.Event.NONE -> Unit
                else -> sfx.play(Sfx.TAP)
            }
        },
        modifier =
            Modifier
                .onGloballyPositioned { board.place(o.id, left, it.rootRect()) }
                .pointerInput(board, draft, o.id, left, enabled) {
                    if (!enabled) return@pointerInput
                    detectCardDrag(
                        onStart = { down ->
                            val r = board.rects[board.key(o.id, left)]
                            if (board.from != null || r == null) {
                                false
                            } else {
                                draft.pick = null
                                board.from = me
                                board.finger = r.topLeft + down
                                true
                            }
                        },
                        onMove = { d -> board.finger += d },
                        onEnd = {
                            val hit = board.targets.hit(board.finger.x, board.finger.y, dropSlop, among = current)
                            if (hit != null) {
                                val other = hit.substringAfter(':')
                                if (left) draft.link(o.id, other, oneToOne = true) else draft.link(other, o.id, oneToOne = true)
                                sfx.play(Sfx.CONNECT)
                            }
                            board.from = null
                        },
                        onCancel = { board.from = null },
                    )
                }.semantics {
                    // After "Check" the board is read-only for screen readers too.
                    if (enabled) customActions = actions
                    stateText?.let { stateDescription = it }
                },
    ) {
        OptionFace(o, ts, pictureHeight = CARD_PICTURE, fallbackLabel = optionLabel(o, number))
    }
}

/** One link: a pencil line drawn on from the left dot to the right dot (still when animations are off). */
@Composable
private fun PencilLink(
    board: ConnectState,
    left: String,
    right: String,
    color: Color,
    reduceMotion: Boolean,
    modifier: Modifier,
) {
    val progress = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduceMotion) progress.animateTo(1f, tween(DRAW_ON_MS, easing = AyaMotion.Ease))
    }
    val seed = PencilPath.seedOf(left, right)
    Canvas(modifier = modifier) {
        val a = board.dot(left, true) ?: return@Canvas
        val b = board.dot(right, false) ?: return@Canvas
        drawPencil(a - board.origin, b - board.origin, seed, progress.value, color)
    }
}

/**
 * A pencil stroke: tapered (thin at both ends, heavier in the middle) with a lighter second pass beside it, so the
 * line has two weights like a real pencil (ART_DIRECTION 2.2). [progress] draws it on from [a] to [b].
 */
internal fun DrawScope.drawPencil(
    a: Offset,
    b: Offset,
    seed: String,
    progress: Float,
    color: Color,
) {
    val pts = PencilPath.points(a.x, a.y, b.x, b.y, seed)
    val n = pts.size / 2 - 1
    if (n < 1) return
    val shown = progress.coerceIn(0f, 1f) * n
    val thin = 1.2.dp.toPx()
    val heavy = 3.2.dp.toPx()
    val grain = 0.9.dp.toPx()
    for (i in 0 until n) {
        if (i >= shown) break
        val frac = (shown - i).coerceAtMost(1f)
        val x0 = pts[i * 2]
        val y0 = pts[i * 2 + 1]
        val x1 = x0 + (pts[i * 2 + 2] - x0) * frac
        val y1 = y0 + (pts[i * 2 + 3] - y0) * frac
        val w = PencilPath.width((i + 0.5f) / n, thin, heavy)
        drawLine(color, Offset(x0, y0), Offset(x1, y1), strokeWidth = w, cap = StrokeCap.Round)
        val g = Offset(grain, -grain)
        drawLine(color.copy(alpha = GRAIN_ALPHA), Offset(x0, y0) + g, Offset(x1, y1) + g, strokeWidth = thin, cap = StrokeCap.Round)
    }
}

private const val GRAIN_ALPHA = 0.35f
private val DOT = 6.dp
private val LINE_TAP = 20.dp
private val CARD_PICTURE = 64.dp
