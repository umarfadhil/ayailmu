package id.petalytix.ayailmu.feature.session

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.TargetText
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
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
            SessionUiState.Loading -> CenteredMessage(stringResource(R.string.session_loading), null, null)
            SessionUiState.Failed -> CenteredMessage(stringResource(R.string.session_failed), null, onExit)
            SessionUiState.NothingToday ->
                CenteredMessage(stringResource(R.string.session_nothing_title), stringResource(R.string.session_nothing_body), onExit)
            SessionUiState.NeedsConsent ->
                CenteredMessage(
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

@Composable
private fun CenteredMessage(
    title: String,
    body: String?,
    onExit: (() -> Unit)?,
    primary: Pair<String, () -> Unit>? = null,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = Modifier.fillMaxSize().padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md, Alignment.CenterVertically),
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        if (body != null) Text(body, style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
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
    step.body.forEachIndexed { i, p ->
        if (i == step.clueIndex) {
            PaperCard(edge = colors.ochre) { Text(p, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
        } else {
            Text(p, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        }
    }
    if (step.examples.isNotEmpty()) {
        PaperCard {
            step.examples.forEach { ex ->
                ex.target?.let { TargetText(it, modifier = Modifier.fillMaxWidth(), rtl = s.targetRtl, scale = s.targetScale) }
                Text(ex.gloss, style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            }
        }
    }
}

// ---- questions -------------------------------------------------------------------------------------

@Composable
private fun QuestionView(
    q: StepUi.Question,
    s: SessionUiState.Running,
    draft: AnswerDraft,
    enabled: Boolean,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    roleLabel(q)?.let { Text(stringResource(it), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep) }
    if (q.prompt.isNotEmpty()) Text(q.prompt, style = MaterialTheme.typography.titleLarge, color = colors.ink)
    q.reading?.let { r ->
        PaperCard {
            r.title?.let { Text(it, style = MaterialTheme.typography.titleLarge, color = colors.ink) }
            r.target?.let { TargetText(it, modifier = Modifier.fillMaxWidth(), rtl = s.targetRtl, scale = s.targetScale) }
            r.body.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
        }
    }
    q.target?.let { TargetText(it, modifier = Modifier.fillMaxWidth(), rtl = s.targetRtl, scale = s.targetScale) }
    q.help.forEach { h ->
        Column {
            h.word?.let { TargetText(it, modifier = Modifier.fillMaxWidth(), rtl = s.targetRtl, scale = s.targetScale, small = true) }
            Text(h.meaning, style = MaterialTheme.typography.bodyLarge, color = if (h.word != null) colors.inkSoft else colors.ink)
        }
    }
    val outcome = s.feedback?.outcome
    when (q.kind) {
        RenderKind.CHOICE -> ChoiceBody(q, s, draft, enabled, outcome)
        RenderKind.TYPED -> TypedBody(draft, enabled, onDone = { draft.toResponse(q)?.let { onEvent(SessionEvent.Answer(it)) } })
        RenderKind.PARAPHRASE -> ParaphraseBody(draft, enabled)
        RenderKind.NUMBER -> NumberBody(q, draft, enabled)
        RenderKind.SEQUENCE -> SequenceBody(q, s, draft, enabled)
        RenderKind.PAIRS -> PairsBody(q, s, draft, enabled, oneToOne = true)
        RenderKind.BUCKETS -> PairsBody(q, s, draft, enabled, oneToOne = false)
        RenderKind.GEM ->
            PaperCard(edge = colors.ochre) {
                Text(stringResource(R.string.session_gem_label), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
                q.cardText?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
            }
        RenderKind.INFO -> q.cardText?.let { PaperCard { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) } }
        RenderKind.UNSUPPORTED -> Text(stringResource(R.string.session_unsupported), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    }
}

private fun roleLabel(q: StepUi.Question): Int? =
    when {
        q.kind == RenderKind.GEM -> null // the gem card carries its own label
        q.role == Step.Role.REVIEW -> R.string.session_review_label
        q.role == Step.Role.REMED || q.role == Step.Role.FOCUS -> R.string.session_followup_label
        else -> null
    }

@Composable
private fun OptionContent(
    o: OptionUi,
    s: SessionUiState.Running,
) {
    val colors = AyaThemeTokens.colors
    when {
        o.target != null -> TargetText(o.target, rtl = s.targetRtl, scale = s.targetScale, small = true)
        o.text != null -> Text(o.text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        o.image != null -> ImagePlaceholder(o.image)
    }
}

/** Until the hand-drawn set lands (P4) a picture option is a labelled dashed frame, clearly a draft. */
@Composable
private fun ImagePlaceholder(path: String) {
    val colors = AyaThemeTokens.colors
    val name = path.substringAfterLast('/').substringBeforeLast('.')
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
        Text(stringResource(R.string.session_image_placeholder, name), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft, modifier = Modifier.padding(AyaSpacing.sm))
    }
}

@Composable
private fun ChoiceBody(
    q: StepUi.Question,
    s: SessionUiState.Running,
    draft: AnswerDraft,
    enabled: Boolean,
    outcome: Outcome?,
) {
    q.options.forEach { o ->
        val chosen = draft.choice == o.id
        val state =
            when {
                outcome == null -> if (chosen) ChoiceState.SELECTED else ChoiceState.IDLE
                !chosen -> ChoiceState.DIMMED
                outcome == Outcome.CORRECT -> ChoiceState.CORRECT
                outcome == Outcome.WRONG -> ChoiceState.WRONG
                else -> ChoiceState.SELECTED
            }
        OptionCard(state = state, enabled = enabled, onClick = { draft.choice = o.id }) { OptionContent(o, s) }
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

private const val MAX_NUMBER_CHARS = 16

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SequenceBody(
    q: StepUi.Question,
    s: SessionUiState.Running,
    draft: AnswerDraft,
    enabled: Boolean,
) {
    val colors = AyaThemeTokens.colors
    val byId = q.options.associateBy { it.id }
    val rtlTiles = s.targetRtl && q.options.any { it.target != null }
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
                                OptionContent(o, s)
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
            ) { OptionContent(o, s) }
        }
    }
}

@Composable
private fun PairsBody(
    q: StepUi.Question,
    s: SessionUiState.Running,
    draft: AnswerDraft,
    enabled: Boolean,
    oneToOne: Boolean,
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
                        OptionContent(o, s)
                        paired?.let { Text("→ " + (it.text ?: it.target ?: it.id), style = MaterialTheme.typography.labelSmall, color = colors.accentDeep) }
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
                ) { OptionContent(o, s) }
            }
        }
    }
}

// ---- actions and feedback --------------------------------------------------------------------------

@Composable
private fun BottomBar(
    s: SessionUiState.Running,
    draft: AnswerDraft,
    onEvent: (SessionEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = Modifier.fillMaxWidth().background(colors.paper).padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.md),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
    ) {
        if (s.saveError) Text(stringResource(R.string.session_save_error), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
        val step = s.step
        val feedback = s.feedback
        when {
            s.phase == SessionState.Phase.FEEDBACK && feedback != null -> {
                FeedbackPanel(feedback)
                AyaButton(text = stringResource(R.string.action_continue), enabled = !s.busy, onClick = { onEvent(SessionEvent.Continue) }, modifier = Modifier.fillMaxWidth())
            }
            step is StepUi.Screen ->
                AyaButton(text = stringResource(R.string.action_continue), enabled = !s.busy, onClick = { onEvent(SessionEvent.Continue) }, modifier = Modifier.fillMaxWidth())
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

@Composable
private fun FeedbackPanel(f: FeedbackView) {
    val colors = AyaThemeTokens.colors
    val (title, tone) =
        when (f.outcome) {
            Outcome.CORRECT -> R.string.session_outcome_correct to colors.correct
            Outcome.WRONG -> R.string.session_outcome_wrong to colors.notYet
            Outcome.PENDING -> R.string.session_outcome_pending to colors.slate
            Outcome.DONT_KNOW -> R.string.session_outcome_dont_know to colors.inkSoft
            Outcome.NOT_ASSESSED -> R.string.session_outcome_seen to colors.accentDeep
        }
    PaperCard(edge = tone) {
        Text(stringResource(title), style = MaterialTheme.typography.titleLarge, color = tone)
        f.messages.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
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
    val nextReview =
        runCatching {
            LocalDate.parse(summary.nextReviewDate).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        }.getOrDefault(summary.nextReviewDate)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        Text(stringResource(R.string.summary_title), style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        PaperCard {
            val line = MaterialTheme.typography.bodyLarge
            Text(stringResource(R.string.summary_answered, summary.answered), style = line, color = colors.ink)
            Text(stringResource(R.string.summary_correct, summary.correct), style = line, color = colors.ink)
            Text(stringResource(R.string.summary_not_yet, summary.wrong), style = line, color = colors.ink)
            if (summary.pending > 0) Text(stringResource(R.string.summary_pending, summary.pending), style = line, color = colors.ink)
            if (summary.dontKnow > 0) Text(stringResource(R.string.summary_dont_know, summary.dontKnow), style = line, color = colors.ink)
            if (summary.gems > 0) Text(stringResource(R.string.summary_gems, summary.gems), style = line, color = colors.ink)
            Text(stringResource(R.string.summary_minutes, summary.minutes), style = line, color = colors.inkSoft)
            Text(stringResource(R.string.summary_next_review, nextReview), style = line, color = colors.inkSoft)
        }
        Text(stringResource(R.string.summary_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        Spacer(Modifier.height(AyaSpacing.sm))
        AyaButton(text = stringResource(R.string.session_back_home), onClick = onExit, modifier = Modifier.fillMaxWidth())
    }
}

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
