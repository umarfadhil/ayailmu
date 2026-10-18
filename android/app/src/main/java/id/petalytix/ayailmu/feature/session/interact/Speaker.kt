package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.TargetText
import id.petalytix.ayailmu.core.design.sound.LocalVoice
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

// Listening and reading aids (INTERACTIONS_AUDIO.md sections 2 and 3.1): speaker buttons, the big listen button of
// audio_match, the romanization line and target-language text set in the right locale. Voice clips play only on a
// tap, plus once automatically when a listening question appears; a clip missing from the phone hides its button.

/**
 * Target-language text. Arabic (or a caller that names no language) keeps TargetText with its bundled font and
 * direction. Every other language is set in the sans face with its text locale, so Han characters take their
 * Japanese or Simplified Chinese forms and Hangul uses a Korean font (CR-I18N-3).
 */
@Composable
internal fun TargetLine(
    text: String,
    ts: TargetStyle,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    textAlign: TextAlign = TextAlign.Start,
) {
    if (TargetScript.usesArabicStyle(ts.lang)) {
        TargetText(text, modifier = modifier, rtl = ts.rtl, scale = ts.scale, small = small, textAlign = textAlign)
        return
    }
    val base = MaterialTheme.typography.headlineMedium
    val factor = ts.scale.coerceIn(MIN_SCALE, MAX_SCALE) * (if (small) SMALL_FACTOR else 1f)
    val locale = TargetScript.localeTag(ts.lang)?.let { LocaleList(Locale(it)) }
    val style =
        base.copy(
            fontWeight = FontWeight.Normal,
            fontSize = base.fontSize * factor,
            lineHeight = base.lineHeight * factor * CJK_LINE,
            localeList = locale,
        )
    Text(text = text, style = style, color = AyaThemeTokens.colors.ink, textAlign = textAlign, modifier = modifier)
}

/** Reading aid under target text (pinyin, romaji, Revised Romanization): small, soft ink. */
@Composable
internal fun RomanizationLine(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = AyaThemeTokens.colors.inkSoft, modifier = modifier)
}

/**
 * A small drawn speaker that plays [clip] ("hear it"). Hidden when the clip is not on this phone. Inside an
 * option card it is its own button: tapping it plays the word without choosing the card.
 */
@Composable
internal fun SpeakerButton(
    clip: String?,
    label: String?,
    modifier: Modifier = Modifier,
) {
    val voice = LocalVoice.current
    if (clip == null || !voice.has(clip)) return
    val description =
        if (label != null) stringResource(R.string.listen_speaker_word_cd, label) else stringResource(R.string.listen_speaker_cd)
    Box(
        modifier =
            modifier
                .size(AyaSpacing.touch)
                .clip(CircleShape)
                .clickable(role = Role.Button) { voice.play(clip) }
                .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        SpeakerGlyph(Modifier.size(SPEAKER_GLYPH), AyaThemeTokens.colors.inkSoft)
    }
}

/**
 * audio_match: a big listen button above the options. The clip plays once when the question appears and again
 * on every tap; it stops when the question goes away. Without the clip on the phone the button is hidden and the
 * answer is recorded as "audio unavailable" (the session normally leaves such items out).
 */
@Composable
internal fun ListenButton(
    q: StepUi.Question,
    draft: AnswerDraft,
    modifier: Modifier = Modifier,
) {
    val voice = LocalVoice.current
    val clip = q.audio
    val available = clip != null && voice.has(clip)
    LaunchedEffect(q.itemId, available) {
        draft.voiceMissing = !available
        if (available && clip != null) voice.play(clip)
    }
    // Keyed by the player too: the app swaps SilentVoice for the real one once the clip index is read, and the
    // clip must be stopped on the player that is playing it.
    DisposableEffect(q.itemId, voice) { onDispose { voice.stop() } }
    if (!available || clip == null) return
    val colors = AyaThemeTokens.colors
    // The button's own words ("Dengar lagi") are its spoken label; the picture is decoration.
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = LISTEN_HEIGHT)
                .background(colors.paper, AyaRadius.lg)
                .border(LISTEN_EDGE, colors.accent, AyaRadius.lg)
                .clip(AyaRadius.lg)
                .clickable(role = Role.Button) { voice.play(clip) }
                .padding(AyaSpacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs),
    ) {
        ArtImage(
            key = LISTEN_ART,
            contentDescription = null,
            modifier = Modifier.size(LISTEN_GLYPH),
            placeholder = { SpeakerGlyph(Modifier.size(LISTEN_GLYPH), colors.accentDeep) },
        )
        Text(stringResource(R.string.listen_again), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
    }
}

/** A drawn speaker: a heavier body and cone, two thin sound arcs, slightly open corners (ART_DIRECTION 2.2). */
@Composable
internal fun SpeakerGlyph(
    modifier: Modifier,
    color: Color,
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val heavy = (w * 0.09f).coerceAtLeast(1.5f)
        val thin = heavy * 0.6f
        val body =
            Path().apply {
                moveTo(w * 0.12f, h * 0.38f)
                lineTo(w * 0.30f, h * 0.37f)
                lineTo(w * 0.52f, h * 0.17f)
                lineTo(w * 0.53f, h * 0.83f)
                lineTo(w * 0.31f, h * 0.63f)
                lineTo(w * 0.12f, h * 0.62f)
                close()
            }
        drawPath(body, color, style = Stroke(width = heavy, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawArc(
            color = color,
            startAngle = -48f,
            sweepAngle = 94f,
            useCenter = false,
            topLeft = Offset(w * 0.46f, h * 0.30f),
            size = Size(w * 0.26f, h * 0.40f),
            style = Stroke(width = thin, cap = StrokeCap.Round),
        )
        drawArc(
            color = color,
            startAngle = -52f,
            sweepAngle = 100f,
            useCenter = false,
            topLeft = Offset(w * 0.46f, h * 0.17f),
            size = Size(w * 0.44f, h * 0.66f),
            style = Stroke(width = thin, cap = StrokeCap.Round),
        )
    }
}

private const val LISTEN_ART = "glyph_listen"
private const val MIN_SCALE = 0.8f
private const val MAX_SCALE = 2.0f
private const val SMALL_FACTOR = 0.82f

/** Han and Hangul need a little more line height than Latin text at the same size. */
private const val CJK_LINE = 1.2f
private val SPEAKER_GLYPH = 24.dp
private val LISTEN_GLYPH = 72.dp
private val LISTEN_HEIGHT = 120.dp
private val LISTEN_EDGE = 2.dp
