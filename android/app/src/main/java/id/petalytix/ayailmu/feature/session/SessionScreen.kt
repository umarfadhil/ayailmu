package id.petalytix.ayailmu.feature.session

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.AyaFigure
import id.petalytix.ayailmu.core.design.art.AyaPose
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.feature.session.interact.TargetLine
import id.petalytix.ayailmu.feature.session.story.PreviewStory
import id.petalytix.ayailmu.feature.session.story.StoryNavRow
import id.petalytix.ayailmu.feature.session.story.StoryTimeline
import id.petalytix.ayailmu.feature.session.story.WatchAgainButton
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun SessionRoute(
    onExit: () -> Unit,
    onConsent: () -> Unit,
    viewModel: SessionViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var confirmLeave by remember { mutableStateOf(false) }
    val running = state is SessionUiState.Running
    BackHandler(enabled = running) { confirmLeave = true }
    SessionScreen(
        state = state,
        onEvent = viewModel::onEvent,
        onClose = { if (running) confirmLeave = true else onExit() },
        onExit = onExit,
        onConsent = onConsent,
    )
    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text(stringResource(R.string.session_close_title)) },
            // Interim summary: what is already saved, so leaving early never feels like losing work.
            text = { Text(stringResource(R.string.session_close_body, (state as? SessionUiState.Running)?.answered ?: 0)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmLeave = false
                    onExit()
                }) { Text(stringResource(R.string.session_close_yes)) }
            },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text(stringResource(R.string.session_close_no)) } },
        )
    }
}

/** Stateless session screen (CR-KT-3). Every step type has one renderer below; the engine decides the order. */
@Composable
fun SessionScreen(
    state: SessionUiState,
    onEvent: (SessionEvent) -> Unit,
    onClose: () -> Unit,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
    onConsent: () -> Unit = {},
) {
    Column(modifier = modifier.fillMaxSize().safeDrawingPadding()) {
        when (state) {
            // Loading has a picture too (MODULES_LEVELS_STORIES.md section 8): Aya thinking, no spinner, no bare text.
            SessionUiState.Loading -> CenteredMessage(AyaPose.THINK.key, stringResource(R.string.session_loading), null, null)
            SessionUiState.Failed -> CenteredMessage("state_error", stringResource(R.string.session_failed), null, onExit)
            SessionUiState.NothingToday ->
                CenteredMessage(AyaPose.SLEEP.key, stringResource(R.string.session_nothing_title), stringResource(R.string.session_nothing_body), onExit)
            SessionUiState.NeedsConsent ->
                CenteredMessage(
                    AyaPose.THINK.key,
                    stringResource(R.string.session_consent_title),
                    stringResource(R.string.session_consent_body),
                    onExit,
                    primary = stringResource(R.string.session_consent_open) to onConsent,
                )
            is SessionUiState.Done -> SummaryView(state.summary, onExit)
            is SessionUiState.Running -> RunningView(state, onEvent, onClose)
        }
    }
}

/** A calm screen: one picture (draft art), a title, a line, and the way back. Never a guilt message. */
@Composable
private fun CenteredMessage(
    picture: String?,
    title: String,
    body: String?,
    onExit: (() -> Unit)?,
    primary: Pair<String, () -> Unit>? = null,
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md, Alignment.CenterVertically),
    ) {
        if (picture != null) {
            PictureMessage(picture, title, body)
        } else {
            Text(title, style = MaterialTheme.typography.headlineMedium, color = AyaThemeTokens.colors.ink, modifier = Modifier.headingSemantics())
            if (body != null) Text(body, style = MaterialTheme.typography.bodyLarge, color = AyaThemeTokens.colors.inkSoft)
        }
        primary?.let { (label, action) -> AyaButton(text = label, onClick = action, modifier = Modifier.fillMaxWidth()) }
        if (onExit != null) {
            if (primary == null) {
                AyaButton(text = stringResource(R.string.session_back_home), onClick = onExit, modifier = Modifier.fillMaxWidth())
            } else {
                AyaSecondaryButton(text = stringResource(R.string.session_back_home), onClick = onExit, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun ColumnScope.RunningView(
    s: SessionUiState.Running,
    onEvent: (SessionEvent) -> Unit,
    onClose: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    if (s.draft) {
        Text(
            text = stringResource(R.string.banner_developer_demo),
            style = MaterialTheme.typography.labelSmall,
            color = colors.paper,
            modifier = Modifier.fillMaxWidth().background(colors.slate).padding(horizontal = AyaSpacing.md, vertical = AyaSpacing.xs),
        )
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = AyaSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onClose) { Text(stringResource(R.string.session_close), color = colors.inkSoft) }
        SessionProgressBar(
            progress = (s.position - 1).toFloat() / s.total.coerceAtLeast(1),
            contentDescription = stringResource(R.string.session_progress_cd, s.position, s.total),
            modifier = Modifier.weight(1f).padding(end = AyaSpacing.md),
        )
    }
    // One draft per position: a repeated focus question gets a fresh, empty answer.
    key(s.position) {
        val draft = remember { AnswerDraft() }
        val inputEnabled = s.phase == SessionState.Phase.STEP && !s.busy
        Column(
            modifier = Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
        ) {
            when (val step = s.step) {
                is StepUi.Screen -> LessonView(step, s)
                is StepUi.Question -> QuestionView(step, s, draft, inputEnabled, onEvent)
            }
        }
        BottomBar(s, draft, onEvent)
    }
}

// ---- lesson screens --------------------------------------------------------------------------------

@Composable
private fun LessonView(
    step: StepUi.Screen,
    s: SessionUiState.Running,
) {
    val colors = AyaThemeTokens.colors
    Text(stringResource(R.string.session_lesson_label), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
    Text(step.title, style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
    if (s.syntheticArabic) SyntheticLabel()
    step.body.forEachIndexed { i, p ->
        if (i == step.clueIndex) {
            PaperCard(edge = colors.ochre) { Text(p, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
        } else {
            Text(p, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        }
    }
    if (step.examples.isNotEmpty()) {
        // TargetLine: Arabic keeps TargetText; Han and Hangul get their language's text locale (CR-I18N-3).
        val ts = TargetStyle(rtl = s.targetRtl, scale = s.targetScale, synthetic = s.syntheticArabic, lang = s.targetLang)
        PaperCard {
            step.examples.forEach { ex ->
                ex.target?.let { TargetLine(it, ts, modifier = Modifier.fillMaxWidth()) }
                Text(ex.gloss, style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            }
        }
    }
}

// ---- questions -------------------------------------------------------------------------------------

@Composable
private fun ColumnScope.QuestionView(
    q: StepUi.Question,
    s: SessionUiState.Running,
    draft: AnswerDraft,
    enabled: Boolean,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    roleLabel(q)?.let { Text(stringResource(it), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep) }
    // A question about a story: the story is one tap away (MODULES_LEVELS_STORIES.md section 2).
    if (q.kind != RenderKind.STORY) q.story?.let { WatchAgainButton(it) }
    QuestionBlock(
        q = q,
        draft = draft,
        enabled = enabled,
        outcome = s.feedback?.outcome,
        ts = TargetStyle(rtl = s.targetRtl, scale = s.targetScale, synthetic = s.syntheticArabic, lang = s.targetLang),
        onSubmit = { onEvent(SessionEvent.Answer(it)) },
    )
    ReportRow(s, onEvent)
}

/** «Laporkan soal»: small and out of the way; once used it just says thank you. */
@Composable
private fun ReportRow(
    s: SessionUiState.Running,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var open by remember { mutableStateOf(false) }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        when {
            s.reported -> Text(stringResource(R.string.report_done), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            s.reportFailed -> {
                Text(
                    stringResource(R.string.report_failed),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.notYet,
                    modifier = Modifier.weight(1f, fill = false),
                )
                TextButton(onClick = { open = true }) { Text(stringResource(R.string.report_retry), color = colors.accentDeep) }
            }
            else -> TextButton(onClick = { open = true }, enabled = !s.reporting) { Text(stringResource(R.string.report_open), color = colors.inkSoft) }
        }
    }
    if (open) {
        ReportDialog(
            child = s.childProfile,
            onSend = { reason, text ->
                open = false
                onEvent(SessionEvent.Report(reason, text))
            },
            onDismiss = { open = false },
        )
    }
}

@Composable
private fun ReportDialog(
    child: Boolean,
    onSend: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var reason by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.report_title)) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                Text(stringResource(R.string.report_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                Reports.REASONS.forEach { r ->
                    OptionCard(
                        state = if (r == reason) ChoiceState.SELECTED else ChoiceState.IDLE,
                        compact = true,
                        onClick = { reason = r },
                    ) { Text(stringResource(reasonLabel(r)), style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
                }
                // Child profiles pick a reason only: no free text from children (CR-DAT-2).
                if (!child) {
                    AyaTextField(
                        value = text,
                        onValueChange = { text = it.take(Reports.MAX_TEXT) },
                        label = stringResource(R.string.report_text_label),
                        supporting = stringResource(R.string.report_text_count, text.length, Reports.MAX_TEXT),
                        singleLine = false,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(enabled = reason != null, onClick = { reason?.let { onSend(it, if (child) "" else text) } }) {
                Text(stringResource(R.string.report_send))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.dev_cancel)) } },
    )
}

private fun reasonLabel(reason: String): Int =
    when (reason) {
        "typo" -> R.string.report_reason_typo
        "wrong_answer" -> R.string.report_reason_wrong_answer
        "confusing" -> R.string.report_reason_confusing
        "picture" -> R.string.report_reason_picture
        else -> R.string.report_reason_other
    }

private fun roleLabel(q: StepUi.Question): Int? =
    when {
        q.kind == RenderKind.GEM -> null // the gem card carries its own label
        q.role == Step.Role.REVIEW -> R.string.session_review_label
        q.role == Step.Role.REMED || q.role == Step.Role.FOCUS -> R.string.session_followup_label
        else -> null
    }

// ---- actions and feedback --------------------------------------------------------------------------

@Composable
private fun BottomBar(
    s: SessionUiState.Running,
    draft: AnswerDraft,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val sound = LocalSoundFx.current
    Column(
        modifier = Modifier.fillMaxWidth().background(colors.paper).padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.md),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        if (s.saveError) Text(stringResource(R.string.session_save_error), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
        val step = s.step
        val feedback = s.feedback
        when {
            s.phase == SessionState.Phase.FEEDBACK && feedback != null -> {
                FeedbackCard(feedback.outcome, feedback.messages)
                AyaButton(text = stringResource(R.string.action_continue), enabled = !s.busy, onClick = { onEvent(SessionEvent.Continue) }, modifier = Modifier.fillMaxWidth())
            }
            step is StepUi.Screen ->
                AyaButton(
                    text = stringResource(R.string.action_continue),
                    enabled = !s.busy,
                    onClick = {
                        // A lesson screen turns like a page (INTERACTIONS_AUDIO.md §3.2).
                        sound.play(Sfx.PAGE)
                        onEvent(SessionEvent.Continue)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            step is StepUi.Question && step.kind == RenderKind.STORY -> StoryBar(s, step, draft, onEvent)
            step is StepUi.Question && (step.kind == RenderKind.GEM || step.kind == RenderKind.INFO) ->
                AyaButton(
                    text = stringResource(R.string.action_continue),
                    enabled = !s.busy,
                    onClick = { draft.toResponse(step)?.let { onEvent(SessionEvent.Answer(it)) } },
                    modifier = Modifier.fillMaxWidth(),
                )
            step is StepUi.Question -> {
                val response = draft.toResponse(step)
                if (step.kind != RenderKind.UNSUPPORTED) {
                    AyaButton(
                        text = stringResource(R.string.session_check),
                        enabled = !s.busy && response != null,
                        onClick = { response?.let { onEvent(SessionEvent.Answer(it)) } },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                // "I don't know yet" is always allowed and never punished (Trial_App_Spec §5).
                AyaSecondaryButton(text = stringResource(R.string.session_dont_know), enabled = !s.busy, onClick = { onEvent(SessionEvent.DontKnow) }, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * STORY: «Kembali» and «Lanjut» turn the panels (a page-turn sound each time); on the last panel «Lanjut» answers
 * the story item as seen, like an info card. Adults, and anyone meeting the story again, may skip it.
 */
@Composable
private fun StoryBar(
    s: SessionUiState.Running,
    step: StepUi.Question,
    draft: AnswerDraft,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val sound = LocalSoundFx.current
    val timeline = draft.storyTimeline(step)
    val response = draft.toResponse(step)
    val turn: (StoryTimeline) -> Unit = { next ->
        if (StoryTimeline.turnsPage(timeline, next)) sound.play(Sfx.PAGE)
        draft.story = next
    }
    StoryNavRow(
        timeline = timeline,
        forwardLabel = stringResource(if (timeline.isLast) R.string.action_continue else R.string.story_next),
        forwardEnabled = !s.busy && (!timeline.isLast || response != null),
        onBack = { turn(timeline.back()) },
        onForward = {
            if (!timeline.isLast) {
                turn(timeline.next())
            } else {
                response?.let { onEvent(SessionEvent.Answer(it)) }
            }
        },
    )
    if (!timeline.isLast && StoryTimeline.offersSkip(adult = !s.childProfile, seenBefore = s.storySeenBefore)) {
        TextButton(
            enabled = !s.busy,
            onClick = {
                draft.story = timeline.skip()
                draft.toResponse(step)?.let { onEvent(SessionEvent.Answer(it)) }
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = AyaSpacing.touch),
        ) { Text(stringResource(R.string.story_skip), color = colors.inkSoft) }
    }
}

// ---- summary ---------------------------------------------------------------------------------------

/** Counts only: no percentages, grades or mastery claims (Trial_App_Spec §6; CODE_RULES §Healthy habit loop). */
@Composable
private fun SummaryView(
    summary: Session.Summary,
    onExit: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val locale = LocalConfiguration.current.locales[0]
    // Once per summary: rememberSaveable keeps a rotation or a return to the app from playing it again.
    val sound = LocalSoundFx.current
    var chimed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!chimed) {
            chimed = true
            sound.play(Sfx.SESSION_DONE)
        }
    }
    val nextReview =
        runCatching {
            LocalDate.parse(summary.nextReviewDate).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        }.getOrDefault(summary.nextReviewDate)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            AyaFigure(pose = AyaPose.HAPPY, contentDescription = null, size = 88.dp)
            Text(
                stringResource(R.string.summary_title),
                style = MaterialTheme.typography.displaySmall,
                color = colors.ink,
                modifier = Modifier.weight(1f).headingSemantics(),
            )
        }
        PaperCard {
            SummaryLine(stringResource(R.string.summary_answered, summary.answered), colors.ink)
            // The correct and not-yet counts carry the same drawn marks as the feedback card (section 8).
            SummaryLine(stringResource(R.string.summary_correct, summary.correct), colors.ink, glyph = "glyph_correct")
            SummaryLine(stringResource(R.string.summary_not_yet, summary.wrong), colors.ink, glyph = "glyph_not_yet")
            if (summary.pending > 0) SummaryLine(stringResource(R.string.summary_pending, summary.pending), colors.ink)
            if (summary.dontKnow > 0) SummaryLine(stringResource(R.string.summary_dont_know, summary.dontKnow), colors.ink)
            if (summary.gems > 0) SummaryLine(stringResource(R.string.summary_gems, summary.gems), colors.ink, glyph = "gem")
            SummaryLine(stringResource(R.string.summary_minutes, summary.minutes), colors.inkSoft)
            SummaryLine(stringResource(R.string.summary_next_review, nextReview), colors.inkSoft)
        }
        Text(stringResource(R.string.summary_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        Spacer(Modifier.height(AyaSpacing.sm))
        AyaButton(text = stringResource(R.string.session_back_home), onClick = onExit, modifier = Modifier.fillMaxWidth())
    }
}

/** One line of the summary card, with its drawn mark when it has one (the glyph is decoration; the text says it all). */
@Composable
private fun SummaryLine(
    text: String,
    color: Color,
    glyph: String? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        if (glyph != null) ArtImage(glyph, contentDescription = null, modifier = Modifier.size(SUMMARY_GLYPH))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = color)
    }
}

private val SUMMARY_GLYPH = 22.dp

// ---- previews --------------------------------------------------------------------------------------

private val previewChoice =
    SessionUiState.Running(
        step =
            StepUi.Question(
                itemId = "MAT-K-P-01-010",
                kind = RenderKind.CHOICE,
                role = Step.Role.PRACTICE,
                prompt = "Mana yang lebih besar?",
                target = null,
                help = emptyList(),
                options = listOf(OptionUi("a", "17", null, null), OptionUi("b", "71", null, null)),
            ),
        phase = SessionState.Phase.STEP,
        feedback = null,
        position = 3,
        total = 10,
        draft = true,
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun SessionChoicePreview() {
    AyaTheme { PaperBackground { SessionScreen(state = previewChoice, onEvent = {}, onClose = {}, onExit = {}) } }
}

@Preview(name = "feedback · id", showBackground = true, locale = "id")
@Composable
private fun SessionFeedbackPreview() {
    AyaTheme {
        PaperBackground {
            SessionScreen(
                state =
                    previewChoice.copy(
                        step =
                            StepUi.Question(
                                itemId = "DEMO-P01",
                                kind = RenderKind.PARAPHRASE,
                                role = Step.Role.PRACTICE,
                                prompt = "Apa arti kalimat ini?",
                                target = "هِيَ مُؤْمِنَةٌ",
                                help = emptyList(),
                            ),
                        phase = SessionState.Phase.FEEDBACK,
                        feedback = FeedbackView("DEMO-P01", Outcome.PENDING, listOf("Jawaban Anda kami simpan untuk dicek.")),
                    ),
                onEvent = {},
                onClose = {},
                onExit = {},
            )
        }
    }
}

@Preview(name = "story · id", showBackground = true, locale = "id")
@Preview(name = "story · en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SessionStoryPreview() {
    AyaTheme {
        PaperBackground {
            SessionScreen(
                state =
                    previewChoice.copy(
                        step =
                            StepUi.Question(
                                itemId = "SEJ-K-P-01-001",
                                kind = RenderKind.STORY,
                                role = Step.Role.PRACTICE,
                                prompt = "Tonton ceritanya.",
                                target = null,
                                help = emptyList(),
                                story = PreviewStory,
                            ),
                    ),
                onEvent = {},
                onClose = {},
                onExit = {},
            )
        }
    }
}

@Preview(name = "summary · en", showBackground = true, locale = "en")
@Composable
private fun SessionSummaryPreview() {
    AyaTheme {
        PaperBackground {
            SessionScreen(
                state = SessionUiState.Done(Session.Summary(9, 6, 2, 0, 1, emptyList(), 1, 0, 1, 8, "2026-10-18", emptyList())),
                onEvent = {},
                onClose = {},
                onExit = {},
            )
        }
    }
}
