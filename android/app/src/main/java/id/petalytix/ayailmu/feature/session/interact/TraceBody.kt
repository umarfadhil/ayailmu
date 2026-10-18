package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.content.StrokePoint
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle
import kotlinx.coroutines.launch

/**
 * trace (INTERACTIONS_AUDIO.md section 4): a square of writing paper with the glyph's strokes drawn faint, the
 * next stroke's start dot and direction arrow. The learner traces each stroke with a finger; a stroke that is
 * about right turns to ink (sfx_stroke), one that is not fades away with a gentle "try again" and no penalty.
 * When every stroke is done the answer goes in by itself (Response.sequence of the stroke numbers, through
 * AnswerDraft). Without stroke data the glyph is shown big with a "Lanjut" that answers "don't know".
 */
@Composable
internal fun TraceBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
    onSubmit: (Response) -> Unit,
) {
    val glyph = q.trace?.let { LocalStrokes.current.keys[it] }
    val strokes = remember(glyph) { glyph?.polylines()?.filter { it.size >= 2 }.orEmpty() }
    LaunchedEffect(q.itemId, strokes.size) { draft.traceStrokes = strokes.size }
    if (strokes.isEmpty()) {
        TraceFallback(glyph?.glyph ?: q.target, ts, enabled) {
            draft.traceSkipped = true
            draft.toResponse(q)?.let(onSubmit)
        }
        return
    }
    val colors = AyaThemeTokens.colors
    val sfx = LocalSoundFx.current
    val reduceMotion = rememberReduceMotion()
    val scope = rememberCoroutineScope()
    val submit by rememberUpdatedState(onSubmit)
    val finger = remember(q.itemId) { mutableStateListOf<Offset>() }
    var missPath by remember(q.itemId) { mutableStateOf<List<Offset>>(emptyList()) }
    var missed by remember(q.itemId) { mutableStateOf(false) }
    val missFade = remember(q.itemId) { Animatable(0f) }
    // Where each stroke's direction arrow points: an eighth of the way along it.
    val leads = remember(strokes) { strokes.map { TraceMatcher.resample(it, LEAD_SAMPLES)[1] } }

    fun accept(index: Int) {
        if (index >= strokes.size) return
        draft.strokeDone(index)
        sfx.play(Sfx.STROKE)
        missed = false
        if (draft.traceComplete) draft.toResponse(q)?.let { submit(it) }
    }

    fun traced(
        points: List<Offset>,
        size: IntSize,
    ) {
        val next = draft.traced.size
        val stroke = strokes.getOrNull(next) ?: return
        if (size.width <= 0 || size.height <= 0) return
        val w = size.width.toDouble()
        val h = size.height.toDouble()
        val path = points.map { StrokePoint(it.x / w, it.y / h) }
        when (TraceMatcher.check(stroke, path)) {
            TraceMatcher.Verdict.OK -> accept(next)
            // A tap is not a stroke: nothing to say.
            TraceMatcher.Verdict.TOO_SHORT -> Unit
            else -> {
                missed = true
                missPath = points
                scope.launch {
                    missFade.snapTo(if (reduceMotion) 0f else 1f)
                    if (!reduceMotion) missFade.animateTo(0f, tween(MISS_FADE_MS, easing = AyaMotion.Ease))
                }
            }
        }
    }

    val total = strokes.size
    val done = draft.traced.size
    val status =
        when {
            draft.traceComplete -> stringResource(R.string.trace_done)
            missed -> stringResource(R.string.trace_try_again)
            else -> stringResource(R.string.trace_progress, done + 1, total)
        }
    val canvasDescription = stringResource(R.string.trace_canvas_cd, glyph?.glyph ?: q.target.orEmpty())
    val skipLabel = stringResource(R.string.trace_skip_stroke)
    Text(stringResource(R.string.trace_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Canvas(
            modifier =
                Modifier
                    .widthIn(max = CANVAS_MAX)
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(colors.paper, AyaRadius.lg)
                    .border(1.4.dp, colors.inkSoft.copy(alpha = 0.5f), AyaRadius.lg)
                    .pointerInput(enabled, q.itemId, strokes, draft) {
                        if (!enabled) return@pointerInput
                        awaitEachGesture {
                            // Every touch on the paper is writing: moves are consumed, so the page does not scroll.
                            val down = awaitFirstDown()
                            down.consume()
                            val points = mutableListOf(down.position)
                            finger.clear()
                            finger.add(down.position)
                            drag(down.id) { change ->
                                points.add(change.position)
                                finger.add(change.position)
                                change.consume()
                            }
                            finger.clear()
                            traced(points, size)
                        }
                    }.semantics {
                        contentDescription = canvasDescription
                        stateDescription = status
                        // Tracing needs a finger on the glass; a screen reader can mark the stroke done instead
                        // (practice only, nothing is scored).
                        if (enabled && !draft.traceComplete) {
                            customActions =
                                listOf(
                                    CustomAccessibilityAction(skipLabel) {
                                        accept(draft.traced.size)
                                        true
                                    },
                                )
                        }
                    },
        ) {
            val s = size.minDimension
            val dash = PathEffect.dashPathEffect(floatArrayOf(s * 0.025f, s * 0.025f))
            val guide = colors.inkSoft.copy(alpha = 0.2f)
            // Writing-paper guides: a dashed cross through the middle.
            val hair = 1.dp.toPx()
            drawLine(guide, Offset(size.width / 2f, 0f), Offset(size.width / 2f, size.height), strokeWidth = hair, pathEffect = dash)
            drawLine(guide, Offset(0f, size.height / 2f), Offset(size.width, size.height / 2f), strokeWidth = hair, pathEffect = dash)
            val doneNow = draft.traced.size
            val width = s * STROKE_WIDTH
            val guideStroke = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round)
            val fingerStroke = Stroke(s * FINGER_WIDTH, cap = StrokeCap.Round, join = StrokeJoin.Round)
            strokes.forEachIndexed { i, st ->
                val color = if (i < doneNow) colors.ink else colors.inkSoft.copy(alpha = FAINT_ALPHA)
                drawPath(strokePath(st), color, style = guideStroke)
            }
            strokes.getOrNull(doneNow)?.let { st ->
                drawPath(strokePath(st), colors.accent.copy(alpha = NEXT_ALPHA), style = guideStroke)
                val p0 = Offset((st[0].x * size.width).toFloat(), (st[0].y * size.height).toFloat())
                val lead = leads[doneNow]
                val p1 = Offset((lead.x * size.width).toFloat(), (lead.y * size.height).toFloat())
                drawArrow(p0, p1, s, colors.accentDeep)
                drawCircle(colors.accent, radius = s * DOT_RADIUS, center = p0)
            }
            if (missFade.value > 0f && missPath.size > 1) {
                drawPath(offsetPath(missPath), colors.notYet.copy(alpha = 0.7f * missFade.value), style = fingerStroke)
            }
            if (finger.size > 1) {
                drawPath(offsetPath(finger), colors.accentDeep.copy(alpha = 0.85f), style = fingerStroke)
            }
        }
    }
    Text(
        status,
        style = MaterialTheme.typography.bodyLarge,
        color = if (missed) colors.notYet else colors.inkSoft,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** No stroke data on this phone: the glyph, big, and a way on ("don't know", never wrong). */
@Composable
private fun TraceFallback(
    glyph: String?,
    ts: TargetStyle,
    enabled: Boolean,
    onContinue: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    if (glyph != null) {
        BoxWithConstraints(
            modifier =
                Modifier
                    .widthIn(max = CANVAS_MAX)
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(colors.paper, AyaRadius.lg),
            contentAlignment = Alignment.Center,
        ) {
            val fontSize = with(LocalDensity.current) { (maxWidth * BIG_GLYPH).toSp() }
            val base = MaterialTheme.typography.headlineMedium
            val locale = TargetScript.localeTag(ts.lang)?.let { LocaleList(Locale(it)) }
            Text(glyph, style = base.copy(fontSize = fontSize, lineHeight = fontSize * 1.2f, localeList = locale), color = colors.ink)
        }
    }
    Text(stringResource(R.string.trace_no_strokes), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    AyaSecondaryButton(
        text = stringResource(R.string.action_continue),
        onClick = onContinue,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun DrawScope.strokePath(points: List<StrokePoint>): Path =
    Path().apply {
        points.forEachIndexed { i, p ->
            val x = (p.x * size.width).toFloat()
            val y = (p.y * size.height).toFloat()
            if (i == 0) moveTo(x, y) else lineTo(x, y)
        }
    }

private fun offsetPath(points: List<Offset>): Path =
    Path().apply {
        points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) }
    }

/** A short drawn arrow beside the start of the next stroke, pointing the way it goes. */
private fun DrawScope.drawArrow(
    from: Offset,
    toward: Offset,
    s: Float,
    color: Color,
) {
    val d = toward - from
    val len = d.getDistance()
    if (len <= 0f) return
    val u = d / len
    val n = Offset(-u.y, u.x)
    val start = from + n * (s * ARROW_OFFSET) + u * (s * 0.02f)
    val end = start + u * (s * ARROW_LENGTH)
    val head = s * ARROW_HEAD
    val w = s * 0.012f
    drawLine(color, start, end, strokeWidth = w, cap = StrokeCap.Round)
    drawLine(color, end, end - u * head + n * (head * 0.6f), strokeWidth = w, cap = StrokeCap.Round)
    drawLine(color, end, end - u * head - n * (head * 0.6f), strokeWidth = w, cap = StrokeCap.Round)
}

private const val LEAD_SAMPLES = 9
private const val MISS_FADE_MS = 360
private const val STROKE_WIDTH = 0.06f
private const val FINGER_WIDTH = 0.03f
private const val FAINT_ALPHA = 0.22f
private const val NEXT_ALPHA = 0.35f
private const val DOT_RADIUS = 0.035f
private const val ARROW_OFFSET = 0.08f
private const val ARROW_LENGTH = 0.12f
private const val ARROW_HEAD = 0.035f
private const val BIG_GLYPH = 0.6f
private val CANVAS_MAX = 420.dp
