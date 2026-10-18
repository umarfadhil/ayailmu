package id.petalytix.ayailmu.feature.speedround

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.AyaPose
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.session.QuestionBlock
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

@Composable
fun SpeedRoundRoute(
    onBack: () -> Unit,
    viewModel: SpeedRoundViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SpeedRoundScreen(state = state, onAnswer = viewModel::answer, onSkip = viewModel::skip, onBack = onBack)
}

/** Practice only: one soft time bar, no digits, no saving, leave any time. */
@Composable
fun SpeedRoundScreen(
    state: SpeedUiState,
    onAnswer: (Response) -> Unit,
    onSkip: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(R.string.speed_leave), color = colors.accentDeep) }
        Text(stringResource(R.string.speed_title), style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        when (state) {
            SpeedUiState.Loading -> Unit
            SpeedUiState.NotAvailable ->
                PictureMessage("state_seedling", stringResource(R.string.speed_not_available_title), stringResource(R.string.speed_not_available_body))
            is SpeedUiState.Running -> RunningRound(state, onAnswer, onSkip)
            is SpeedUiState.Done -> {
                PictureMessage(
                    AyaPose.HAPPY.key,
                    stringResource(if (state.timeUp) R.string.speed_time_up else R.string.speed_done),
                    stringResource(R.string.speed_result, state.answered, state.correct),
                )
                Text(stringResource(R.string.speed_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                AyaButton(text = stringResource(R.string.action_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun ColumnScope.RunningRound(
    s: SpeedUiState.Running,
    onAnswer: (Response) -> Unit,
    onSkip: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    // Words, never digits: the bar's own range info (read out as a percentage) is replaced for screen readers.
    val left = s.timeLeft.coerceIn(0f, 1f)
    val label = stringResource(R.string.speed_time_cd)
    val words =
        stringResource(
            when {
                left > 2f / 3f -> R.string.speed_time_plenty
                left > 1f / 3f -> R.string.speed_time_half
                else -> R.string.speed_time_little
            },
        )
    Box(
        modifier =
            Modifier.clearAndSetSemantics {
                contentDescription = label
                stateDescription = words
            },
    ) {
        SessionProgressBar(progress = left, contentDescription = label)
    }
    Text(stringResource(R.string.speed_position, s.position, s.total), style = MaterialTheme.typography.labelLarge, color = colors.inkSoft)
    key(s.position) {
        val draft = remember { AnswerDraft() }
        // A tap on a choice is the answer: no extra "Check" in a speed round. Built by AnswerDraft like every answer
        // (CR-ENG-12), so a listening item carries its audio status.
        LaunchedEffect(draft.choice) {
            val tapped = s.question.kind == RenderKind.CHOICE && draft.choice != null && s.outcome == null
            if (tapped) draft.toResponse(s.question)?.let(onAnswer)
        }
        QuestionBlock(q = s.question, draft = draft, enabled = s.outcome == null, outcome = s.outcome, ts = s.ts, onSubmit = onAnswer)
        if (s.question.kind != RenderKind.CHOICE) {
            val response = draft.toResponse(s.question)
            AyaButton(
                text = stringResource(R.string.session_check),
                enabled = s.outcome == null && response != null,
                onClick = { response?.let(onAnswer) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        AyaSecondaryButton(text = stringResource(R.string.speed_skip), enabled = s.outcome == null, onClick = onSkip, modifier = Modifier.fillMaxWidth())
    }
    PaperCard { Text(stringResource(R.string.speed_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft) }
}

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SpeedRoundPreview() {
    AyaTheme {
        PaperBackground {
            SpeedRoundScreen(
                state =
                    SpeedUiState.Running(
                        question =
                            StepUi.Question(
                                itemId = "MAT-A-P-01-002",
                                kind = RenderKind.CHOICE,
                                role = Step.Role.PRACTICE,
                                prompt = "Mana yang lebih besar?",
                                target = null,
                                help = emptyList(),
                                options = listOf(OptionUi("a", "0,5", null, null), OptionUi("b", "0,45", null, null)),
                            ),
                        ts = TargetStyle(),
                        position = 3,
                        total = 10,
                        timeLeft = 0.6f,
                    ),
                onAnswer = {},
                onSkip = {},
                onBack = {},
            )
        }
    }
}
