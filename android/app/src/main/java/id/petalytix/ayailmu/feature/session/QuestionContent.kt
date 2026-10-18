package id.petalytix.ayailmu.feature.session

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.content.Gestures
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.ArtRegistry
import id.petalytix.ayailmu.core.design.art.AyaFigure
import id.petalytix.ayailmu.core.design.art.AyaPose
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.components.rememberReduceMotion
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.LocalVoice
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaMotion
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.interact.ConnectPairsBody
import id.petalytix.ayailmu.feature.session.interact.DropBoardBody
import id.petalytix.ayailmu.feature.session.interact.ListenButton
import id.petalytix.ayailmu.feature.session.interact.RomanizationLine
import id.petalytix.ayailmu.feature.session.interact.SequenceDragBody
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import id.petalytix.ayailmu.feature.session.interact.SpeakerButton
import id.petalytix.ayailmu.feature.session.interact.TargetLine
import id.petalytix.ayailmu.feature.session.interact.TraceBody
import id.petalytix.ayailmu.feature.session.story.StoryPlayer
import java.text.NumberFormat
import java.util.Locale

// Question renderers shared by the daily session, the daily puzzle and the speed round. One renderer per
// RenderKind (CR-ENG-5). Pictures are catalog keys drawn by ArtImage; every picture is DRAFT art until the
// illustrator's set replaces it under the same key (ART_DIRECTION section 7).

/** How target-language text is drawn (Arabic: right to left, at the learner's chosen size). */
data class TargetStyle(
    val rtl: Boolean = true,
    val scale: Float = 1f,
    /** Arabic course: readings carry «Kalimat latihan buatan — bukan ayat Al-Qur'an» (Trial_App_Spec §3). */
    val synthetic: Boolean = false,
    /**
     * The track's target language ("en", "ko", "ja", "zh", "ar"). Sets the text locale so Han characters take their
     * Japanese or Simplified Chinese forms (TargetLine); null or "ar" keeps the Arabic TargetText.
     */
    val lang: String? = null,
)

/** The question itself: prompt, reading, target text, help lines, picture and the answer area. */
@Composable
internal fun ColumnScope.QuestionBlock(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    outcome: Outcome?,
    ts: TargetStyle,
    onSubmit: (Response) -> Unit = {},
) {
    val colors = AyaThemeTokens.colors
    if (q.prompt.isNotEmpty()) Text(q.prompt, style = MaterialTheme.typography.titleLarge, color = colors.ink)
    q.reading?.let { r ->
        PaperCard {
            if (ts.synthetic) SyntheticLabel()
            r.title?.let { Text(it, style = MaterialTheme.typography.titleLarge, color = colors.ink) }
            r.target?.let { TargetLine(it, ts, modifier = Modifier.fillMaxWidth()) }
            r.body.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
        }
    }
    // A fill_blank sentence that the drag renderer draws with its places inside the gaps is not repeated here.
    val inline = SlotBoard.inlineParts(q) != null
    val inlineBlank = if (inline && !q.blankInTarget) q.blankLine else null
    if (!(inline && q.blankInTarget)) q.target?.let { TargetBlock(it, q, ts) }
    q.help.forEachIndexed { i, h ->
        if (i == inlineBlank && h.word == null) return@forEachIndexed
        Column {
            h.word?.let { TargetLine(it, ts, modifier = Modifier.fillMaxWidth(), small = true) }
            if (i != inlineBlank) {
                Text(h.meaning, style = MaterialTheme.typography.bodyLarge, color = if (h.word != null) colors.inkSoft else colors.ink)
            }
        }
    }
    // The tap renderer draws its own picture with the tap areas on top.
    if (q.kind != RenderKind.HOTSPOT) q.image?.let { QuestionPicture(it) }
    if (q.listen) ListenButton(q, draft)
    // A clip with no target text on screen (e.g. "build the word you see and hear"): a speaker under the picture.
    // Traces draw their own speaker; listening questions have the big listen button.
    if (!q.listen && q.target == null && q.kind != RenderKind.TRACE) {
        q.audio?.let { clip ->
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { SpeakerButton(clip, label = null) }
        }
    }
    when (q.kind) {
        RenderKind.CHOICE -> ChoiceBody(q, draft, enabled, outcome, ts)
        RenderKind.HOTSPOT -> HotspotBody(q, draft, enabled, outcome)
        RenderKind.TYPED -> TypedBody(draft, enabled, onDone = { draft.toResponse(q)?.let(onSubmit) })
        RenderKind.PARAPHRASE -> ParaphraseBody(draft, enabled)
        RenderKind.NUMBER -> NumberBody(q, draft, enabled)
        RenderKind.SLIDER -> SliderBody(q, draft, enabled)
        // INTERACTIONS_AUDIO.md 2.1: the gesture picks the interaction; tap-then-tap works in every one of them.
        RenderKind.SEQUENCE ->
            if (q.gesture == Gestures.DRAG) SequenceDragBody(q, draft, enabled, ts) else SequenceBody(q, draft, enabled, ts)
        RenderKind.PAIRS ->
            when (q.gesture) {
                Gestures.CONNECT -> ConnectPairsBody(q, draft, enabled, ts)
                Gestures.DRAG -> DropBoardBody(q, draft, enabled, oneToOne = true, ts)
                else -> PairsBody(q, draft, enabled, oneToOne = true, ts)
            }
        RenderKind.BUCKETS ->
            if (q.gesture == Gestures.TAP) {
                PairsBody(q, draft, enabled, oneToOne = false, ts)
            } else {
                DropBoardBody(q, draft, enabled, oneToOne = false, ts)
            }
        RenderKind.MEMORY -> MemoryBody(q, draft, enabled, ts)
        RenderKind.TRACE -> TraceBody(q, draft, enabled, ts, onSubmit)
        RenderKind.GEM ->
            PaperCard(edge = colors.ochre) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                    ArtImage("gem", contentDescription = null, modifier = Modifier.size(GLYPH))
                    Text(stringResource(R.string.session_gem_label), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
                }
                q.cardText?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
            }
        RenderKind.INFO -> q.cardText?.let { PaperCard { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) } }
        // The animated story (follow-up 12); its panel buttons live in the session's bottom bar, which also answers it.
        RenderKind.STORY ->
            q.story?.let { story -> StoryPlayer(story = story, timeline = draft.storyTimeline(q), onTimeline = { draft.story = it }) }
                ?: Text(stringResource(R.string.session_unsupported), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        RenderKind.UNSUPPORTED -> Text(stringResource(R.string.session_unsupported), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    }
}

/** The target text with its reading aid and, when the item has a clip, a speaker beside it. */
@Composable
private fun TargetBlock(
    text: String,
    q: StepUi.Question,
    ts: TargetStyle,
) {
    val clip = q.audio?.takeIf { !q.listen && LocalVoice.current.has(it) }
    if (clip == null && q.romanization == null) {
        TargetLine(text, ts, modifier = Modifier.fillMaxWidth())
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Column(modifier = Modifier.weight(1f)) {
            TargetLine(text, ts, modifier = Modifier.fillMaxWidth())
            q.romanization?.let { RomanizationLine(it) }
        }
        SpeakerButton(clip, label = text)
    }
}

/** The picture that goes with a question (count the mangoes, read the clock). */
@Composable
private fun QuestionPicture(key: String) {
    // Height cap only: the picture keeps its own aspect ratio and the Box centres it (no overflow).
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        ArtImage(
            key = key,
            contentDescription = stringResource(R.string.session_question_picture_cd),
            modifier = Modifier.heightIn(max = PICTURE_MAX),
            placeholder = { ImagePlaceholder(it) },
        )
    }
}

internal fun choiceState(
    chosen: Boolean,
    outcome: Outcome?,
): ChoiceState =
    when {
        outcome == null -> if (chosen) ChoiceState.SELECTED else ChoiceState.IDLE
        !chosen -> ChoiceState.DIMMED
        outcome == Outcome.CORRECT -> ChoiceState.CORRECT
        outcome == Outcome.WRONG -> ChoiceState.WRONG
        else -> ChoiceState.SELECTED
    }

/** Option face: a picture (its text becomes the spoken label, so it never gives the answer away), target text or text. */
@Composable
internal fun OptionContent(
    o: OptionUi,
    ts: TargetStyle,
    pictureHeight: Dp = OPTION_PICTURE,
    fallbackLabel: String? = null,
) {
    val colors = AyaThemeTokens.colors
    when {
        o.image != null ->
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                ArtImage(
                    key = o.image,
                    contentDescription = o.text ?: fallbackLabel,
                    modifier = Modifier.heightIn(max = pictureHeight),
                    placeholder = { ImagePlaceholder(it) },
                )
            }
        o.target != null ->
            Column {
                TargetLine(o.target, ts, small = true)
                o.romanization?.let { RomanizationLine(it) }
            }
        o.text != null -> Text(o.text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
    }
}

/**
 * [OptionContent] plus the card's speaker ("hear it") when it has a clip on this phone. A picture card never gets a
 * speaker: its word is what the learner has to find, so saying it would give the answer away (like printing its
 * label). [speaker] false hides it on every card (listening questions: each option could be compared to the clip).
 */
@Composable
internal fun OptionFace(
    o: OptionUi,
    ts: TargetStyle,
    pictureHeight: Dp = OPTION_PICTURE,
    fallbackLabel: String? = null,
    speaker: Boolean = true,
) {
    val clip = o.audio?.takeIf { speaker && o.image == null && LocalVoice.current.has(it) }
    if (clip == null) {
        OptionContent(o, ts, pictureHeight, fallbackLabel)
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.weight(1f, fill = false)) { OptionContent(o, ts, pictureHeight, fallbackLabel) }
        SpeakerButton(clip, label = o.text ?: o.target ?: fallbackLabel)
    }
}

/** A key with no drawing yet: a labelled dashed frame, clearly a draft (never a crash, never a blank). */
@Composable
internal fun ImagePlaceholder(key: String) {
    val colors = AyaThemeTokens.colors
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 72.dp)
                .padding(vertical = AyaSpacing.xs)
                .drawBehind {
                    drawRoundRect(
                        color = colors.inkSoft,
                        cornerRadius = CornerRadius(8.dp.toPx()),
                        style = Stroke(width = 1.4.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 7f))),
                    )
                },
        contentAlignment = Alignment.Center,
    ) {
        Text(stringResource(R.string.session_image_placeholder, key), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft, modifier = Modifier.padding(AyaSpacing.sm))
    }
}

@Composable
private fun ChoiceBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    outcome: Outcome?,
    ts: TargetStyle,
) {
    if (q.options.isNotEmpty() && q.options.all { it.image != null }) {
        // Picture options sit two to a row so each picture stays big enough to tell apart.
        q.options.chunked(2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                pair.forEachIndexed { i, o ->
                    OptionCard(
                        state = choiceState(draft.choice == o.id, outcome),
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                        onClick = { draft.choice = o.id },
                    ) {
                        val label = stringResource(R.string.session_picture_option_cd, row * 2 + i + 1)
                        OptionFace(o, ts, fallbackLabel = label, speaker = !q.listen)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        return
    }
    q.options.forEach { o ->
        OptionCard(state = choiceState(draft.choice == o.id, outcome), enabled = enabled, onClick = { draft.choice = o.id }) {
            OptionFace(o, ts, speaker = !q.listen)
        }
    }
}

/**
 * Tap the right part of a picture. Each tap area is a labelled radio button for screen readers. Areas smaller
 * than the 48 dp touch minimum get a bigger invisible target around them (CR-A11Y-1); where targets overlap,
 * the smaller area is on top, so the precise one wins.
 */
@Composable
private fun HotspotBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    outcome: Outcome?,
) {
    val colors = AyaThemeTokens.colors
    val key = q.image ?: return
    Text(stringResource(R.string.session_hotspot_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().aspectRatio(ArtRegistry.aspect(key))) {
        val pw = maxWidth
        val ph = maxHeight
        ArtImage(key = key, contentDescription = null, modifier = Modifier.fillMaxSize(), placeholder = { ImagePlaceholder(it) })
        q.options
            .filter { it.region != null }
            .sortedByDescending { o -> o.region?.let { it.w * it.h } ?: 0f }
            .forEach { o ->
                val r = o.region!!
                val rw = pw * r.w
                val rh = ph * r.h
                val tw = maxOf(rw, AyaSpacing.touch).coerceAtMost(pw)
                val th = maxOf(rh, AyaSpacing.touch).coerceAtMost(ph)
                val tx = (pw * r.x - (tw - rw) / 2).coerceIn(0.dp, pw - tw)
                val ty = (ph * r.y - (th - rh) / 2).coerceIn(0.dp, ph - th)
                // Where the drawn area sits inside the (possibly larger) touch target.
                val ix = pw * r.x - tx
                val iy = ph * r.y - ty
                val state = choiceState(draft.choice == o.id, outcome)
                val (edge, weight, dashed) =
                    when (state) {
                        ChoiceState.IDLE -> Triple(colors.inkSoft.copy(alpha = 0.55f), 1.4.dp, true)
                        ChoiceState.DIMMED -> Triple(colors.inkSoft.copy(alpha = 0.25f), 1.2.dp, true)
                        ChoiceState.SELECTED -> Triple(colors.accent, 3.dp, false)
                        ChoiceState.CORRECT -> Triple(colors.correct, 3.dp, false)
                        ChoiceState.WRONG -> Triple(colors.notYet, 3.dp, false)
                    }
                val label = o.text ?: o.id
                Box(
                    modifier =
                        Modifier
                            .offset(x = tx, y = ty)
                            .size(width = tw, height = th)
                            .drawBehind {
                                drawRoundRect(
                                    color = edge,
                                    topLeft = Offset(ix.toPx(), iy.toPx()),
                                    size = Size(rw.toPx(), rh.toPx()),
                                    cornerRadius = CornerRadius(6.dp.toPx()),
                                    style =
                                        Stroke(
                                            width = weight.toPx(),
                                            pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(8f, 8f)) else null,
                                        ),
                                )
                            }.selectable(selected = draft.choice == o.id, enabled = enabled, role = Role.RadioButton, onClick = { draft.choice = o.id })
                            .semantics { contentDescription = label },
                )
            }
    }
}

@Composable
private fun TypedBody(
    draft: AnswerDraft,
    enabled: Boolean,
    onDone: () -> Unit,
) {
    AyaTextField(
        value = draft.text,
        onValueChange = { draft.text = it },
        label = stringResource(R.string.session_type_answer),
        enabled = enabled,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
    )
}

@Composable
private fun ParaphraseBody(
    draft: AnswerDraft,
    enabled: Boolean,
) {
    val colors = AyaThemeTokens.colors
    AyaTextField(
        value = draft.text,
        onValueChange = { draft.text = it },
        label = stringResource(R.string.session_type_answer),
        enabled = enabled,
        singleLine = false,
    )
    Text(stringResource(R.string.session_who_question), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
    listOf(
        Response.refTag(Referent.LAKI_LAKI) to R.string.session_who_male,
        Response.refTag(Referent.PEREMPUAN) to R.string.session_who_female,
        Response.REF_DONT_KNOW to R.string.session_who_unknown,
    ).forEach { (tag, label) ->
        OptionCard(
            state = if (draft.ref == tag) ChoiceState.SELECTED else ChoiceState.IDLE,
            enabled = enabled,
            compact = true,
            onClick = { draft.ref = tag },
        ) { Text(stringResource(label), style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
    }
}

@Composable
private fun NumberBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
) {
    AyaTextField(
        value = draft.text,
        onValueChange = { v -> draft.text = v.filter { it.isDigit() || it == ',' || it == '.' || it == '-' }.take(MAX_NUMBER_CHARS) },
        label = stringResource(R.string.session_number_label),
        supporting = q.unitLabel?.let { stringResource(R.string.session_unit, it) },
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
    )
}

/** Numbers as the instruction language writes them: "8.760" and "2,5" in Indonesian, "8,760" and "2.5" in English. */
internal fun formatNumber(
    value: Double,
    lang: Lang,
): String = NumberFormat.getNumberInstance(Locale.forLanguageTag(lang.tag)).apply { maximumFractionDigits = 2 }.format(value)

/**
 * Estimate on a slider. "Check" stays off until the learner has moved it (an untouched default is never sent).
 * Less and More buttons move one step for fine control and for anyone who finds dragging hard.
 */
@Composable
private fun SliderBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
) {
    val colors = AyaThemeTokens.colors
    val spec = q.slider ?: return
    val value = draft.sliderValue
    val shown = value ?: spec.snap((spec.min + spec.max) / 2)
    val shownText = formatNumber(shown, q.lang) + (q.unitLabel?.let { " $it" } ?: "")
    Text(
        text = if (value == null) stringResource(R.string.session_slider_hint) else stringResource(R.string.session_slider_value, shownText),
        style = if (value == null) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleLarge,
        color = if (value == null) colors.inkSoft else colors.ink,
    )
    Slider(
        value = shown.toFloat(),
        onValueChange = { draft.sliderValue = spec.snap(it.toDouble()) },
        valueRange = spec.min.toFloat()..spec.max.toFloat(),
        enabled = enabled,
        colors =
            SliderDefaults.colors(
                thumbColor = colors.accent,
                activeTrackColor = colors.accent,
                inactiveTrackColor = colors.inkSoft.copy(alpha = 0.3f),
            ),
        modifier = Modifier.fillMaxWidth().semantics { stateDescription = shownText },
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Text(formatNumber(spec.min, q.lang), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
        Spacer(Modifier.weight(1f))
        Text(formatNumber(spec.max, q.lang), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        AyaSecondaryButton(
            text = stringResource(R.string.session_slider_less),
            enabled = enabled && shown > spec.min,
            onClick = { draft.sliderValue = spec.snap(shown - spec.step) },
            modifier = Modifier.weight(1f),
        )
        AyaSecondaryButton(
            text = stringResource(R.string.session_slider_more),
            enabled = enabled && shown < spec.max,
            onClick = { draft.sliderValue = spec.snap(shown + spec.step) },
            modifier = Modifier.weight(1f),
        )
    }
}

private const val MAX_NUMBER_CHARS = 16

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SequenceBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val byId = q.options.associateBy { it.id }
    val rtlTiles = ts.rtl && q.options.any { it.target != null }
    Text(stringResource(R.string.session_sequence_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    PaperCard {
        if (draft.placed.isEmpty()) {
            Text(stringResource(R.string.session_sequence_empty), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        } else {
            CompositionLocalProvider(LocalLayoutDirection provides if (rtlTiles) LayoutDirection.Rtl else LocalLayoutDirection.current) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                    draft.placed.forEach { id ->
                        byId[id]?.let { o ->
                            OptionCard(state = ChoiceState.SELECTED, enabled = enabled, compact = true, fillWidth = false, onClick = { draft.place(id, q.slots) }) {
                                OptionContent(o, ts)
                            }
                        }
                    }
                }
            }
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        q.options.filter { it.id !in draft.placed }.forEach { o ->
            OptionCard(
                state = ChoiceState.IDLE,
                enabled = enabled && draft.placed.size < q.slots,
                compact = true,
                fillWidth = false,
                onClick = { draft.place(o.id, q.slots) },
            ) { OptionContent(o, ts) }
        }
    }
}

@Composable
private fun PairsBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    oneToOne: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val rightById = q.right.associateBy { it.id }
    Text(
        stringResource(if (oneToOne) R.string.session_pairs_hint else R.string.session_buckets_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = colors.inkSoft,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            q.left.forEach { o ->
                val paired = draft.pairs[o.id]?.let { rightById[it] }
                OptionCard(
                    state =
                        when {
                            draft.activeLeft == o.id -> ChoiceState.SELECTED
                            paired != null -> ChoiceState.DIMMED
                            else -> ChoiceState.IDLE
                        },
                    enabled = enabled,
                    compact = true,
                    onClick = { draft.tapLeft(o.id) },
                ) {
                    Column {
                        OptionContent(o, ts, pictureHeight = SMALL_PICTURE)
                        paired?.let { PairedWith(it, ts) }
                    }
                }
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            q.right.forEach { o ->
                val used = oneToOne && draft.pairs.containsValue(o.id)
                OptionCard(
                    state = if (used) ChoiceState.DIMMED else ChoiceState.IDLE,
                    enabled = enabled && draft.activeLeft != null,
                    compact = true,
                    onClick = { draft.tapRight(o.id, oneToOne) },
                ) { OptionContent(o, ts, pictureHeight = SMALL_PICTURE) }
            }
        }
    }
}

/**
 * Tap mode: the partner a card is joined to, as a small drawn arrow and the partner's own picture or word (section 8:
 * a picture partner is shown, never named; a plain option id is never shown).
 */
@Composable
private fun PairedWith(
    partner: OptionUi,
    ts: TargetStyle,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
        ArtImage("glyph_arrow_right", contentDescription = null, modifier = Modifier.size(PAIRED_GLYPH))
        when {
            partner.image != null ->
                ArtImage(
                    key = partner.image,
                    contentDescription = partner.text,
                    modifier = Modifier.heightIn(max = PAIRED_PICTURE),
                    placeholder = { ImagePlaceholder(it) },
                )
            partner.target != null -> TargetLine(partner.target, ts, small = true)
            partner.text != null ->
                Text(partner.text, style = MaterialTheme.typography.labelSmall, color = AyaThemeTokens.colors.accentDeep)
        }
    }
}

/**
 * Memory flip (practice only). Face-down cards are plain paper with a slate wash; a found pair keeps a heavy
 * sage edge. Nothing times out: a pair that does not match stays visible until the next tap.
 */
@Composable
private fun MemoryBody(
    q: StepUi.Question,
    draft: AnswerDraft,
    enabled: Boolean,
    ts: TargetStyle,
) {
    val colors = AyaThemeTokens.colors
    val cards = q.cards
    if (cards.isEmpty()) return
    val columns = if (cards.size % 3 == 0 && cards.size <= 12) 3 else 4
    val found = draft.pairs.size
    val total = cards.size / 2
    Text(stringResource(R.string.session_memory_hint), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    Text(stringResource(R.string.session_memory_found, found, total), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
    cards.chunked(columns).forEachIndexed { row, line ->
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            line.forEachIndexed { i, card ->
                val number = row * columns + i + 1
                val isFound = draft.isFound(card)
                val up = isFound || card.cardId in draft.faceUp
                val label = card.option.text ?: card.option.target ?: card.option.id
                val description =
                    when {
                        isFound -> stringResource(R.string.session_memory_card_found, label)
                        up -> label
                        else -> stringResource(R.string.session_memory_card_down, number)
                    }
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .aspectRatio(CARD_ASPECT)
                            .alpha(if (isFound) 0.8f else 1f)
                            .background(if (up) colors.paper else colors.slate.copy(alpha = 0.22f), AyaRadius.md)
                            .border(if (isFound) 2.6.dp else 1.2.dp, if (isFound) colors.correct else colors.inkSoft.copy(alpha = 0.55f), AyaRadius.md)
                            .selectable(selected = up, enabled = enabled && !isFound, role = Role.Button, onClick = { draft.flip(card, cards) })
                            .semantics { contentDescription = description }
                            .padding(AyaSpacing.xs),
                    contentAlignment = Alignment.Center,
                ) {
                    if (up) OptionContent(card.option, ts, pictureHeight = SMALL_PICTURE)
                }
            }
            repeat(columns - line.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

/**
 * After "Check": Aya, a small drawn glyph and the feedback lines. Calm, never a celebration storm. Plays
 * sfx_correct or sfx_not_yet once per shown feedback; correct settles the card and its glyph into place, not yet
 * sways it gently sideways (at most 360 ms, never a shake or a red flash). Still when animations are off.
 */
@Composable
internal fun FeedbackCard(
    outcome: Outcome,
    messages: List<String>,
) {
    val colors = AyaThemeTokens.colors
    val sfx = LocalSoundFx.current
    val reduceMotion = rememberReduceMotion()
    // 1 = lifted a little (correct, before it settles); the sway is in dp, side to side.
    val lift = remember { Animatable(if (outcome == Outcome.CORRECT && !reduceMotion) 1f else 0f) }
    val sway = remember { Animatable(0f) }
    LaunchedEffect(outcome, messages) {
        when (outcome) {
            Outcome.CORRECT -> sfx.play(Sfx.CORRECT)
            Outcome.WRONG -> sfx.play(Sfx.NOT_YET)
            else -> Unit
        }
        if (reduceMotion) return@LaunchedEffect
        when (outcome) {
            Outcome.CORRECT -> lift.animateTo(0f, tween(AyaMotion.STANDARD_MS, easing = AyaMotion.Settle))
            Outcome.WRONG -> {
                sway.animateTo(SWAY_DP, tween(SWAY_STEP_MS, easing = AyaMotion.Ease))
                sway.animateTo(-SWAY_DP * 0.6f, tween(SWAY_STEP_MS, easing = AyaMotion.Ease))
                sway.animateTo(0f, tween(SWAY_STEP_MS, easing = AyaMotion.Ease))
            }
            else -> Unit
        }
    }
    val (title, tone) =
        when (outcome) {
            Outcome.CORRECT -> R.string.session_outcome_correct to colors.correct
            Outcome.WRONG -> R.string.session_outcome_wrong to colors.notYet
            Outcome.PENDING -> R.string.session_outcome_pending to colors.slate
            Outcome.DONT_KNOW -> R.string.session_outcome_dont_know to colors.inkSoft
            Outcome.NOT_ASSESSED -> R.string.session_outcome_seen to colors.accentDeep
        }
    val pose =
        when (outcome) {
            Outcome.CORRECT -> AyaPose.HAPPY
            Outcome.WRONG, Outcome.DONT_KNOW -> AyaPose.THINK
            Outcome.PENDING, Outcome.NOT_ASSESSED -> AyaPose.IDLE
        }
    val glyph =
        when (outcome) {
            Outcome.CORRECT -> "glyph_correct"
            Outcome.WRONG, Outcome.DONT_KNOW -> "glyph_not_yet"
            Outcome.PENDING, Outcome.NOT_ASSESSED -> "glyph_saved"
        }
    PaperCard(
        edge = tone,
        modifier =
            Modifier.graphicsLayer {
                translationY = lift.value * SETTLE_LIFT.toPx()
                translationX = sway.value.dp.toPx()
            },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalAlignment = Alignment.Top) {
            AyaFigure(pose = pose, contentDescription = null, size = FEEDBACK_AYA)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                    ArtImage(
                        glyph,
                        contentDescription = null,
                        modifier =
                            Modifier.size(GLYPH).graphicsLayer {
                                val scale = 1f - GLYPH_SETTLE * lift.value
                                scaleX = scale
                                scaleY = scale
                            },
                    )
                    Text(stringResource(title), style = MaterialTheme.typography.titleLarge, color = tone)
                }
                messages.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
            }
        }
    }
}

/** Said wherever made-up Arabic practice text is shown, so no one mistakes it for scripture. */
@Composable
internal fun SyntheticLabel() {
    Text(stringResource(R.string.synthetic_label), style = MaterialTheme.typography.labelMedium, color = AyaThemeTokens.colors.inkSoft)
}

/** A calm full-screen message with one picture (Aya asleep, the knot of thread, a seed in a pot). */
@Composable
internal fun ColumnScope.PictureMessage(
    picture: String,
    title: String,
    body: String?,
) {
    val colors = AyaThemeTokens.colors
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        ArtImage(picture, contentDescription = null, modifier = Modifier.width(MESSAGE_PICTURE))
    }
    Text(title, style = MaterialTheme.typography.headlineMedium, color = colors.ink, textAlign = TextAlign.Start, modifier = Modifier.fillMaxWidth().headingSemantics())
    if (body != null) Text(body, style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
}

private val GLYPH = 28.dp
private val SETTLE_LIFT = 6.dp
private const val GLYPH_SETTLE = 0.2f
private const val SWAY_DP = 6f
private const val SWAY_STEP_MS = 120
private val FEEDBACK_AYA = 56.dp
private val PICTURE_MAX = 220.dp
private val OPTION_PICTURE = 120.dp
private val SMALL_PICTURE = 64.dp
private val PAIRED_GLYPH = 18.dp
private val PAIRED_PICTURE = 36.dp
private val MESSAGE_PICTURE = 160.dp
private const val CARD_ASPECT = 0.85f
