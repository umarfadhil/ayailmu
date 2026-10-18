package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitTouchSlopOrCancellation
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.zIndex
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.OptionUi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// Shared drag-and-drop machinery for the follow-up 11 renderers (INTERACTIONS_AUDIO.md section 2.1). A card is
// never moved while the finger holds it: a floating copy follows the finger above the board, and the answer only
// changes when the finger lifts. Then the copy flies from where it was let go to where the card now sits
// (settles into its target, or slides back home), at most 300 ms, eased, no bounce; with animations off it snaps.

/** Settling into a target or sliding back (ART_DIRECTION 2.7: small, slow-in/slow-out, no bounce). */
internal const val SETTLE_MS = 280

/** A connect line being drawn on. */
internal const val DRAW_ON_MS = 240

/** A target counts as hit when the finger lifts this close to it. */
internal val DROP_SLOP = 24.dp

/** The card's rectangle in root pixels (not clipped, so a card half scrolled away keeps its true size). */
internal fun LayoutCoordinates.rootRect(): Rect = Rect(positionInRoot(), size.toSize())

internal fun Rect.toHitBox(): HitBox = HitBox(left, top, right, bottom)

/** What a screen reader calls a card: its text, its target text, or "Picture option [number]" for a bare picture. */
@Composable
internal fun optionLabel(
    o: OptionUi,
    number: Int,
): String = o.text ?: o.target ?: stringResource(R.string.session_picture_option_cd, number)

internal fun lerpRect(
    a: Rect,
    b: Rect,
    t: Float,
): Rect =
    Rect(
        a.left + (b.left - a.left) * t,
        a.top + (b.top - a.top) * t,
        a.right + (b.right - a.right) * t,
        a.bottom + (b.bottom - a.bottom) * t,
    )

/**
 * Card drag recognizer. Waits for the touch slop first, so a tap stays a tap (tap-then-tap keeps working) and a
 * page scroll that starts on a card still scrolls when the card refuses ([onStart] false). Then every move is
 * consumed and reported as a delta. [onStart] receives the down position, local to the card.
 */
internal suspend fun PointerInputScope.detectCardDrag(
    onStart: (Offset) -> Boolean,
    onMove: (Offset) -> Unit,
    onEnd: () -> Unit,
    onCancel: () -> Unit,
) = awaitEachGesture {
    val down = awaitFirstDown(requireUnconsumed = false)
    var started = false
    var ended = false
    // finally: a gesture cancelled mid-drag (the board turns read-only at "Check", the question changes) calls
    // [onCancel], which puts everything back without changing the answer, so no floating card or half-drawn line
    // is left on screen.
    try {
        val slop =
            awaitTouchSlopOrCancellation(down.id) { change, _ ->
                if (!started) started = onStart(down.position)
                if (started) {
                    change.consume()
                    onMove(change.position - down.position)
                }
            }
        if (slop != null && started) {
            drag(slop.id) { change ->
                onMove(change.positionChange())
                change.consume()
            }
        }
        if (started) {
            ended = true
            onEnd()
        }
    } finally {
        if (started && !ended) onCancel()
    }
}

/** Where every card and target of one board is, and the card in the air. One per question. */
@Stable
internal class DragDropState {
    enum class Phase { IDLE, DRAGGING, FLYING }

    /** Root rectangles of the cards, by card id, from their latest layout. */
    val cards = HashMap<String, Rect>()

    /** Where a card can land, in root pixels. */
    val targets = DropTargets()

    /** The board's top-left in root pixels: the floating card is drawn relative to it. */
    var origin: Offset = Offset.Zero

    var active by mutableStateOf<String?>(null)
        private set
    var phase by mutableStateOf(Phase.IDLE)
        private set

    /** The finger, in root pixels, while dragging. */
    var finger by mutableStateOf(Offset.Zero)
        private set
    private var flight by mutableStateOf(Rect.Zero)
    private var grab = Offset.Zero
    private var size = Size.Zero

    val busy: Boolean get() = phase != Phase.IDLE

    /** True for the card that is in the air: its own place shows nothing (or a faint ghost) meanwhile. */
    fun hides(id: String): Boolean = active == id && phase != Phase.IDLE

    fun begin(
        id: String,
        down: Offset,
    ): Boolean {
        if (busy) return false
        val r = cards[id] ?: return false
        active = id
        grab = down
        size = r.size
        finger = r.topLeft + down
        phase = Phase.DRAGGING
        return true
    }

    fun move(delta: Offset) {
        if (phase == Phase.DRAGGING) finger += delta
    }

    /** The drag was cancelled (not dropped): the card goes straight back, the answer is unchanged. */
    fun cancel() {
        if (phase == Phase.DRAGGING) {
            active = null
            phase = Phase.IDLE
        }
    }

    /** The rectangle the floating card is drawn at now (root pixels). */
    fun floatingRect(): Rect = if (phase == Phase.DRAGGING) Rect(finger - grab, size) else flight

    /**
     * The finger lifted: [commit] changes the answer (or nothing, and the card slides back), then the copy flies
     * to wherever the card sits after the change.
     */
    fun land(
        scope: CoroutineScope,
        reduceMotion: Boolean,
        commit: () -> Unit,
    ) {
        val id = active ?: return
        val from = floatingRect()
        commit()
        flyFrom(id, from, scope, reduceMotion)
    }

    /** Tap-then-tap: the card flies from its old place to its new one after [commit]. */
    fun tapMove(
        id: String,
        scope: CoroutineScope,
        reduceMotion: Boolean,
        commit: () -> Unit,
    ) {
        val from = cards[id]
        commit()
        if (from == null || busy) return
        active = id
        flyFrom(id, from, scope, reduceMotion)
    }

    private fun flyFrom(
        id: String,
        from: Rect,
        scope: CoroutineScope,
        reduceMotion: Boolean,
    ) {
        if (reduceMotion) {
            finish()
            return
        }
        flight = from
        phase = Phase.FLYING
        scope.launch {
            try {
                // Two frames: the answer change recomposes, then the card is laid out in its new place.
                withFrameNanos { }
                withFrameNanos { }
                val to = cards[id] ?: from
                animate(0f, 1f, animationSpec = tween(SETTLE_MS, easing = AyaMotion.Settle)) { t, _ ->
                    flight = lerpRect(from, to, t)
                }
            } finally {
                finish()
            }
        }
    }

    fun finish() {
        phase = Phase.IDLE
        active = null
    }
}

/**
 * The card in the air, drawn above the whole board (call it last inside the board's Box). Not interactive: the
 * gesture stays with the card that started it.
 */
@Composable
internal fun DragOverlay(
    state: DragDropState,
    content: @Composable (String) -> Unit,
) {
    val id = state.active ?: return
    if (state.phase == DragDropState.Phase.IDLE) return
    val r = state.floatingRect()
    val density = LocalDensity.current
    Box(
        modifier =
            Modifier
                .zIndex(OVERLAY_Z)
                .offset { IntOffset((r.left - state.origin.x).roundToInt(), (r.top - state.origin.y).roundToInt()) }
                .size(with(density) { r.width.toDp() }, with(density) { r.height.toDp() }),
    ) {
        content(id)
    }
}

/** The face of a card in the air: the lifted look (heavy clay edge on light paper), no shadow (ART_DIRECTION 2.5). */
@Composable
internal fun LiftedCard(content: @Composable () -> Unit) {
    val colors = AyaThemeTokens.colors
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(colors.paper, AyaRadius.md)
                .border(LIFT_EDGE, colors.accent, AyaRadius.md)
                .padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.sm),
        contentAlignment = Alignment.CenterStart,
    ) {
        content()
    }
}

private const val OVERLAY_Z = 10f
private val LIFT_EDGE = 2.6.dp
