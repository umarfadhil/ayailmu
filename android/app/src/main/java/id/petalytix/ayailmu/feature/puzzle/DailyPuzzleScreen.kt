package id.petalytix.ayailmu.feature.puzzle

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.AyaFigure
import id.petalytix.ayailmu.core.design.art.AyaPose
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.FeedbackCard
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.session.QuestionBlock
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle

@Composable
fun DailyPuzzleRoute(
    onBack: () -> Unit,
    viewModel: DailyPuzzleViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    DailyPuzzleScreen(state = state, onAnswer = viewModel::answer, onBack = onBack)
}

/** One puzzle, no timer, no streak: answer, see why, come back tomorrow. "Show me" is always allowed. */
@Composable
fun DailyPuzzleScreen(
    state: PuzzleUiState,
    onAnswer: (Response) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        when (state) {
            PuzzleUiState.Loading -> Unit
            PuzzleUiState.None -> PictureMessage("state_seedling", stringResource(R.string.puzzle_none_title), stringResource(R.string.puzzle_none_body))
            is PuzzleUiState.Ready -> ReadyPuzzle(state, onAnswer, onBack)
        }
    }
}

@Composable
private fun ColumnScope.ReadyPuzzle(
    s: PuzzleUiState.Ready,
    onAnswer: (Response) -> Unit,
    onBack: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
        AyaFigure(pose = AyaPose.THINK, contentDescription = null, size = 72.dp)
        Column(modifier = Modifier.weight(1f)) {
            Text(stringResource(R.string.puzzle_title), style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
            Text(s.subjectTitle, style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        }
    }
    val draft = remember(s.question.itemId) { AnswerDraft() }
    val feedback = s.feedback
    QuestionBlock(
        q = s.question,
        draft = draft,
        enabled = feedback == null,
        outcome = feedback?.outcome,
        ts = s.ts,
        onSubmit = onAnswer,
    )
    if (feedback == null) {
        val response = draft.toResponse(s.question)
        AyaButton(
            text = stringResource(R.string.session_check),
            enabled = response != null,
            onClick = { response?.let(onAnswer) },
            modifier = Modifier.fillMaxWidth(),
        )
        AyaSecondaryButton(text = stringResource(R.string.puzzle_show_answer), onClick = { onAnswer(Response.dontKnow()) }, modifier = Modifier.fillMaxWidth())
    } else {
        if (s.alreadyDone) {
            Text(stringResource(R.string.puzzle_done_today), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
            s.modelAnswer?.let { PaperCard(edge = colors.ochre) { Text(stringResource(R.string.puzzle_answer, it), style = MaterialTheme.typography.bodyLarge, color = colors.ink) } }
        } else {
            FeedbackCard(feedback.outcome, feedback.messages)
            if (s.saveFailed) Text(stringResource(R.string.puzzle_save_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
        }
        Text(stringResource(R.string.puzzle_tomorrow), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        AyaButton(text = stringResource(R.string.session_back_home), onClick = onBack, modifier = Modifier.fillMaxWidth())
    }
}

private val previewPuzzle =
    PuzzleUiState.Ready(
        subjectTitle = "Matematika — Pemula (Anak)",
        question =
            StepUi.Question(
                itemId = "MAT-K-P-DP-01",
                kind = RenderKind.CHOICE,
                role = Step.Role.PRACTICE,
                prompt = "Teka-teki: aku bilangan apa?",
                target = null,
                help = emptyList(),
                options = listOf(OptionUi("a", "36", null, null), OptionUi("b", "63", null, null)),
            ),
        ts = TargetStyle(),
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun DailyPuzzlePreview() {
    AyaTheme { PaperBackground { DailyPuzzleScreen(state = previewPuzzle, onAnswer = {}, onBack = {}) } }
}

@Preview(name = "answered · id", showBackground = true, locale = "id")
@Composable
private fun DailyPuzzleAnsweredPreview() {
    AyaTheme {
        PaperBackground {
            DailyPuzzleScreen(
                state = previewPuzzle.copy(feedback = FeedbackView("MAT-K-P-DP-01", Outcome.CORRECT, listOf("Betul! 36"))),
                onAnswer = {},
                onBack = {},
            )
        }
    }
}
