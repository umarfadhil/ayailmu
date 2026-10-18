package id.petalytix.ayailmu.feature.session.story

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.absoluteOffset
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.content.Motion
import id.petalytix.ayailmu.core.content.MotionType
import id.petalytix.ayailmu.core.content.Transform
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.ArtRegistry
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.LocalVoice
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.interact.SpeakerGlyph
import kotlin.math.sin

// The animated story player (docs/content/MODULES_LEVELS_STORIES.md section 2; ART_DIRECTION 2.7 quiet motion).
// A 16:9 stage draws the panel's scene and up to four picture layers, each placed by StoryLayout and moved by
// StoryMotion (MotionMath) every frame: layers read their clock only inside graphicsLayer / drawWithContent, so a
// moving layer never recomposes the screen. Panels never move on by themselves; narration plays per panel when its
// clip is bundled and stops when the panel or the player goes away. Reduce-motion: every layer at its final pose,
// no scene zoom, no crossfade.

/**
 * Plays [story] at [timeline] (hoisted: the session keeps it in its AnswerDraft). Tapping the picture goes to the
 * next panel. With [controls] the player draws its own «Kembali» and «Lanjut» / «Selesai» row (the «Lihat cerita
 * lagi» dialog and the figure gallery); in a session the bottom bar holds them, and its «Lanjut» on the last panel
 * answers the story item.
 */
@Composable
fun StoryPlayer(
    story: StoryUi,
    timeline: StoryTimeline,
    onTimeline: (StoryTimeline) -> Unit,
    modifier: Modifier = Modifier,
    controls: Boolean = false,
    onDone: () -> Unit = {},
    reduceMotion: Boolean = rememberReduceMotion(),
) {
    val colors = AyaThemeTokens.colors
    val sound = LocalSoundFx.current
    val voice = LocalVoice.current
    val panels = story.panels
    if (panels.isEmpty()) {
        Text(stringResource(R.string.session_unsupported), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        return
    }
    val index = timeline.index.coerceIn(0, panels.lastIndex)
    val panel = panels[index]
    val turn: (StoryTimeline) -> Unit = { next ->
        if (StoryTimeline.turnsPage(timeline, next)) sound.play(Sfx.PAGE)
        onTimeline(next)
    }
    // Narration: once when the panel appears (if bundled), silence otherwise; stopped when the player leaves.
    LaunchedEffect(story.storyId, index, voice) {
        when (val cue = StoryNarration.cue(panel.narration) { voice.has(it) }) {
            is NarrationCue.Play -> voice.play(cue.clip)
            NarrationCue.Stop -> voice.stop()
        }
    }
    DisposableEffect(story.storyId, voice) { onDispose { voice.stop() } }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Text(story.figure, style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
        Text(story.title, style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        StoryStage(
            panels = panels,
            index = index,
            reduceMotion = reduceMotion,
            onNext = if (timeline.isLast) null else ({ turn(timeline.next()) }),
            onBack = if (timeline.isFirst) null else ({ turn(timeline.back()) }),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            PanelDots(count = panels.size, index = index, furthest = timeline.furthest, modifier = Modifier.weight(1f))
            NarrationSpeaker(panel.narration)
        }
        // A new caption is announced when the panel changes (TalkBack users step with the buttons or custom actions).
        Text(
            panel.caption,
            style = MaterialTheme.typography.titleLarge,
            color = colors.ink,
            modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (timeline.isLast) {
            story.source?.let {
                Text(stringResource(R.string.story_source, it), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            }
        }
        if (controls) {
            StoryNavRow(
                timeline = timeline,
                forwardLabel = stringResource(if (timeline.isLast) R.string.story_done else R.string.story_next),
                onBack = { turn(timeline.back()) },
                onForward = { if (timeline.isLast) onDone() else turn(timeline.next()) },
            )
        }
    }
}

/** «Kembali» and the forward button, shared by the player's own controls and the session's bottom bar. */
@Composable
internal fun StoryNavRow(
    timeline: StoryTimeline,
    forwardLabel: String,
    onBack: () -> Unit,
    onForward: () -> Unit,
    modifier: Modifier = Modifier,
    forwardEnabled: Boolean = true,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        AyaSecondaryButton(
            text = stringResource(R.string.action_back),
            onClick = onBack,
            enabled = !timeline.isFirst,
            modifier = Modifier.weight(1f),
        )
        AyaButton(text = forwardLabel, onClick = onForward, enabled = forwardEnabled, modifier = Modifier.weight(2f))
    }
}

/**
 * The 16:9 picture. One tap anywhere goes on (no ripple: the page turn is the feedback); for TalkBack it is one
 * labelled picture ("Gambar 2 dari 5: <caption>") with "next" and "back" custom actions.
 */
@Composable
private fun StoryStage(
    panels: List<StoryPanelUi>,
    index: Int,
    reduceMotion: Boolean,
    onNext: (() -> Unit)?,
    onBack: (() -> Unit)?,
) {
    val colors = AyaThemeTokens.colors
    val description = stringResource(R.string.story_stage_cd, index + 1, panels.size, panels[index].caption)
    val nextLabel = stringResource(R.string.story_next)
    val backLabel = stringResource(R.string.action_back)
    val tapNext by rememberUpdatedState(onNext)
    BoxWithConstraints(
        modifier =
            Modifier
                .fillMaxWidth()
                .aspectRatio(StoryLayout.STAGE_ASPECT)
                .clip(AyaRadius.md)
                .background(colors.paperDeep)
                .pointerInput(Unit) { detectTapGestures(onTap = { tapNext?.invoke() }) }
                .semantics {
                    contentDescription = description
                    customActions =
                        listOfNotNull(
                            onNext?.let { go ->
                                CustomAccessibilityAction(nextLabel) {
                                    go()
                                    true
                                }
                            },
                            onBack?.let { go ->
                                CustomAccessibilityAction(backLabel) {
                                    go()
                                    true
                                }
                            },
                        )
                },
    ) {
        val stageWidth = maxWidth
        val stageHeight = maxHeight
        Crossfade(
            targetState = index,
            modifier = Modifier.fillMaxSize(),
            animationSpec = if (reduceMotion) snap<Float>() else tween<Float>(PANEL_FADE_MS, easing = AyaMotion.Ease),
            label = "story-panel",
        ) { i ->
            PanelScene(panels[i.coerceIn(0, panels.lastIndex)], stageWidth, stageHeight, reduceMotion)
        }
    }
}

/**
 * One panel's scene and layers. The entrance clock runs once from 0 to [StoryMotion.finiteMs] (linear time; the
 * easing lives in MotionMath) and drives entrances, one-way moves and the scene zoom; looping layers have their
 * own loop clock. A test's frame clock runs the entrance clock to its end and holds loops at rest.
 */
@Composable
private fun PanelScene(
    panel: StoryPanelUi,
    stageWidth: Dp,
    stageHeight: Dp,
    reduceMotion: Boolean,
) {
    val finite = remember(panel) { StoryMotion.finiteMs(panel) }
    val entrance = remember(panel) { Animatable(if (reduceMotion) finite.toFloat() else 0f) }
    LaunchedEffect(panel, reduceMotion) {
        if (reduceMotion || finite <= 0L) {
            entrance.snapTo(finite.toFloat())
        } else {
            entrance.animateTo(finite.toFloat(), tween(durationMillis = finite.toInt(), easing = LinearEasing))
        }
    }
    val entranceMs: () -> Long = remember(entrance) { { entrance.value.toLong() } }
    Box(
        modifier =
            Modifier.fillMaxSize().graphicsLayer {
                val scale = StoryMotion.sceneScale(panel, entranceMs(), reduceMotion)
                scaleX = scale
                scaleY = scale
            },
    ) {
        ArtImage(key = panel.scene, contentDescription = null, modifier = Modifier.fillMaxSize(), placeholder = { ScenePlaceholder(it) })
        panel.layers.forEachIndexed { i, layer ->
            key(i) {
                val rect = StoryLayout.rect(layer, stageWidth.value, stageHeight.value) { art -> ArtRegistry.aspect(art) }
                StageLayer(layer, rect, stageWidth, stageHeight, entranceMs, reduceMotion)
            }
        }
    }
}

@Composable
private fun StageLayer(
    layer: StoryLayerUi,
    rect: LayerRect,
    stageWidth: Dp,
    stageHeight: Dp,
    entranceMs: () -> Long,
    reduceMotion: Boolean,
) {
    val period = StoryMotion.loopPeriodMs(layer.motion)
    val loopPhase: State<Float>? =
        if (!reduceMotion && period != null) rememberLoopPhase(period, StoryMotion.loopDelayMs(layer.motion)) else null
    val still = remember(layer) { StoryMotion.still(layer) }
    val transform: () -> Transform = {
        when {
            reduceMotion -> still
            loopPhase != null -> StoryMotion.atLoop(layer, loopPhase.value.toLong())
            else -> StoryMotion.at(layer, entranceMs())
        }
    }
    val reveals = !reduceMotion && layer.motion?.type == MotionType.REVEAL
    val placed =
        Modifier
            .absoluteOffset(x = rect.left.dp, y = rect.top.dp)
            .size(width = rect.width.dp, height = rect.height.dp)
            .graphicsLayer {
                // Read here, in the draw phase: the layer moves without recomposing anything.
                val t = transform()
                translationX = (t.dx * stageWidth.toPx()).toFloat()
                translationY = (t.dy * stageHeight.toPx()).toFloat()
                val scale = t.scale.toFloat()
                scaleX = if (layer.flip) -scale else scale
                scaleY = scale
                rotationZ = t.rotationDeg.toFloat()
                alpha = t.alpha.toFloat().coerceIn(0f, 1f)
                transformOrigin = TransformOrigin(t.originX.toFloat(), t.originY.toFloat())
            }.then(
                if (reveals) {
                    Modifier.drawWithContent {
                        val t = transform()
                        val (start, end) = StoryLayout.revealSpan(t.revealFraction, t.revealFromRight, layer.flip, size.width)
                        clipRect(left = start, top = 0f, right = end, bottom = size.height) { this@drawWithContent.drawContent() }
                    }
                } else {
                    Modifier
                },
            )
    ArtImage(key = layer.art, contentDescription = null, modifier = placed, placeholder = { LayerPlaceholder(placed) })
}

/** A looping motion's phase in ms (0 until its period), repeating after the motion's delay; still in tests. */
@Composable
private fun rememberLoopPhase(
    periodMs: Long,
    delayMs: Int,
): State<Float> =
    rememberInfiniteTransition(label = "story-loop").animateFloat(
        initialValue = 0f,
        targetValue = periodMs.toFloat(),
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = periodMs.toInt(), easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
                initialStartOffset = StartOffset(delayMs),
            ),
        label = "story-loop-phase",
    )

/** A scene with no drawing yet: a dashed frame that names the key (draft art, never a crash or a blank). */
@Composable
private fun ScenePlaceholder(key: String) {
    val colors = AyaThemeTokens.colors
    Box(modifier = Modifier.fillMaxSize().drawBehind { dashedFrame(colors.inkSoft) }, contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.session_image_placeholder, key), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    }
}

/** A layer with no drawing yet: its dashed outline only. */
@Composable
private fun LayerPlaceholder(placed: Modifier) {
    val colors = AyaThemeTokens.colors
    Box(modifier = placed.drawBehind { dashedFrame(colors.inkSoft) })
}

private fun DrawScope.dashedFrame(color: Color) {
    drawRoundRect(
        color = color,
        cornerRadius = CornerRadius(6.dp.toPx()),
        style = Stroke(width = 1.4.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 7f))),
    )
}

/** Where we are: one drawn dot per panel (the current one larger and in clay, seen ones filled, the rest rings). */
@Composable
private fun PanelDots(
    count: Int,
    index: Int,
    furthest: Int,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    // The picture says "2 of 5" to TalkBack already; the dots are decoration for it.
    Box(modifier = modifier.clearAndSetSemantics {}) {
        Canvas(modifier = Modifier.size(width = DOT_PITCH * count, height = DOT_ROW)) {
            val pitch = DOT_PITCH.toPx()
            val r = DOT_RADIUS.toPx()
            for (i in 0 until count) {
                // A slightly different size per dot, like dots made with a pen (ART_DIRECTION 2.2).
                val wobble = 1f + DOT_WOBBLE * sin(i * 2.1f)
                val c = Offset(pitch * i + pitch / 2f, size.height / 2f)
                when {
                    i == index -> drawCircle(colors.accent, radius = r * CURRENT_DOT * wobble, center = c)
                    i <= furthest -> drawCircle(colors.inkSoft, radius = r * wobble, center = c)
                    else -> drawCircle(colors.inkSoft, radius = r * wobble, center = c, style = Stroke(width = DOT_RING.toPx()))
                }
            }
        }
    }
}

/** The small speaker that plays the panel's narration again; hidden when the clip is not on this phone. */
@Composable
private fun NarrationSpeaker(clip: String?) {
    val voice = LocalVoice.current
    val playable = StoryNarration.replay(clip) { voice.has(it) } ?: return
    val description = stringResource(R.string.story_listen_cd)
    Box(
        modifier =
            Modifier
                .size(AyaSpacing.touch)
                .clip(CircleShape)
                .clickable(role = Role.Button) { voice.play(playable) }
                .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        SpeakerGlyph(Modifier.size(SPEAKER_GLYPH), AyaThemeTokens.colors.inkSoft)
    }
}

/** The whole player in a dialog (questions about a story, the figure gallery). Closing it stops the narration. */
@Composable
fun StoryDialog(
    story: StoryUi,
    onClose: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var timeline by remember(story.storyId) { mutableStateOf(StoryTimeline.start(story.panels.size)) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .widthIn(max = DIALOG_MAX)
                    .padding(AyaSpacing.md)
                    .background(colors.paper, AyaRadius.lg)
                    .verticalScroll(rememberScrollState())
                    .padding(AyaSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = AyaSpacing.touch)) {
                    Text(stringResource(R.string.story_close), color = colors.accentDeep)
                }
            }
            StoryPlayer(story = story, timeline = timeline, onTimeline = { timeline = it }, controls = true, onDone = onClose)
        }
    }
}

/** «Lihat cerita lagi»: above a question about a story; opens the story in a dialog. */
@Composable
fun WatchAgainButton(
    story: StoryUi,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    var open by rememberSaveable(story.storyId) { mutableStateOf(false) }
    Row(
        modifier =
            modifier
                .heightIn(min = AyaSpacing.touch)
                .clip(AyaRadius.md)
                .border(WATCH_EDGE, colors.accent.copy(alpha = 0.6f), AyaRadius.md)
                .clickable(role = Role.Button) { open = true }
                .padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        story.emblemOrScene?.let { ArtImage(it, contentDescription = null, modifier = Modifier.size(WATCH_EMBLEM)) }
        Text(stringResource(R.string.story_watch_again), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
    }
    if (open) StoryDialog(story, onClose = { open = false })
}

private const val PANEL_FADE_MS = AyaMotion.STANDARD_MS
private val DOT_PITCH = 18.dp
private val DOT_ROW = 24.dp
private val DOT_RADIUS = 4.dp
private val DOT_RING = 1.4.dp
private const val CURRENT_DOT = 1.4f
private const val DOT_WOBBLE = 0.06f
private val SPEAKER_GLYPH = 24.dp
private val DIALOG_MAX = 640.dp
private val WATCH_EMBLEM = 32.dp
private val WATCH_EDGE = 1.4.dp

// ---- previews -------------------------------------------------------------------------------------------------

/** A Kartini panel as written in MODULES_LEVELS_STORIES.md section 2 (draft art keys; missing ones draw dashed frames). */
internal val PreviewStory: StoryUi =
    StoryUi(
        storyId = "ST-KARTINI",
        title = "Kartini dan surat-suratnya",
        figure = "Raden Ajeng Kartini (1879–1904)",
        source = "Kartini, Habis Gelap Terbitlah Terang (1911)",
        emblem = "hist_kartini_letters",
        panels =
            listOf(
                StoryPanelUi(
                    scene = "hist_bg_room_lamp",
                    caption = "Kartini suka membaca sampai larut malam.",
                    narration = "id/sej_kartini_01",
                    layers =
                        listOf(
                            StoryLayerUi("hist_sil_woman_kebaya", 0.08, 0.30, 0.30, motion = Motion(MotionType.FADE_IN, ms = 600)),
                            StoryLayerUi("hist_oil_lamp", 0.62, 0.22, 0.16, motion = Motion(MotionType.GLOW, ms = 2400, loop = true)),
                            StoryLayerUi(
                                "hist_kartini_letters",
                                0.40,
                                0.62,
                                0.26,
                                motion = Motion(MotionType.SLIDE_IN, ms = 600, delayMs = 300),
                            ),
                        ),
                    zoom = Motion(MotionType.ZOOM, ms = 5000, scaleFrom = 1.0, scaleTo = 1.06),
                ),
                StoryPanelUi(
                    scene = "hist_bg_classroom_old",
                    caption = "Ia menulis surat tentang sekolah untuk anak perempuan.",
                    narration = "id/sej_kartini_02",
                    layers = listOf(StoryLayerUi("hist_quill", 0.55, 0.40, 0.18, motion = Motion(MotionType.SWAY, ms = 2400, loop = true))),
                ),
                StoryPanelUi(
                    scene = "hist_bg_village_java",
                    caption = "Surat-suratnya dibukukan dan dibaca banyak orang.",
                    narration = null,
                ),
            ),
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun StoryPlayerPreview() {
    AyaTheme {
        PaperBackground {
            Column(modifier = Modifier.padding(AyaSpacing.md)) {
                StoryPlayer(PreviewStory, StoryTimeline.start(3).next(), onTimeline = {}, controls = true, reduceMotion = true)
            }
        }
    }
}

@Preview(name = "watch again · id", showBackground = true, locale = "id")
@Composable
private fun WatchAgainPreview() {
    AyaTheme { PaperBackground { WatchAgainButton(PreviewStory, modifier = Modifier.padding(AyaSpacing.md)) } }
}
