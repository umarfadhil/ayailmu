package id.petalytix.ayailmu.feature.trial

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens

@Composable
fun SurveyRoute(
    onDone: () -> Unit,
    viewModel: SurveyViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.done) { if (state.done) onDone() }
    SurveyScreen(state = state, onEvent = viewModel::onEvent)
}

/** Short, calm questionnaire. Nothing is required; the answers stay on this phone (exported only by the learner). */
@Composable
fun SurveyScreen(
    state: SurveyUiState,
    onEvent: (SurveyEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    val background = state.kind == SurveyKind.BACKGROUND
    Column(modifier = modifier.fillMaxSize().safeDrawingPadding()) {
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
        ) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                ArtImage("state_survey", contentDescription = null, modifier = Modifier.width(112.dp))
            }
            Text(
                stringResource(
                    when (state.kind) {
                        SurveyKind.BACKGROUND -> R.string.survey_bg_title
                        SurveyKind.DAY7 -> R.string.survey_day7_title
                        SurveyKind.END -> R.string.survey_end_title
                    },
                ),
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            Text(
                stringResource(if (background) R.string.survey_bg_intro else R.string.survey_trial_intro),
                style = MaterialTheme.typography.bodyLarge,
                color = colors.inkSoft,
            )
            if (!state.loading) SurveyForms.of(state.kind).forEach { q -> QuestionCard(q, state.answers[q.id].orEmpty(), state.busy, onEvent) }
            Text(stringResource(R.string.survey_saved_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            if (state.failed) Text(stringResource(R.string.survey_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
        }
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
        ) {
            AyaButton(
                text = stringResource(R.string.survey_submit),
                enabled = !state.busy && !state.loading,
                onClick = { onEvent(SurveyEvent.Submit) },
                modifier = Modifier.fillMaxWidth(),
            )
            AyaSecondaryButton(
                text = stringResource(if (background) R.string.survey_skip else R.string.survey_later),
                enabled = !state.busy,
                onClick = { onEvent(SurveyEvent.Skip) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionCard(
    q: SurveyQuestion,
    chosen: List<String>,
    busy: Boolean,
    onEvent: (SurveyEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        Text(stringResource(questionTitle(q.id)), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
        if (q.id == "clarity") Text(stringResource(R.string.survey_clarity_scale), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        when (q.type) {
            QuestionType.TEXT ->
                AyaTextField(
                    value = chosen.firstOrNull().orEmpty(),
                    onValueChange = { onEvent(SurveyEvent.Type(q.id, it)) },
                    label = stringResource(R.string.survey_text_label),
                    enabled = !busy,
                    singleLine = false,
                )
            QuestionType.SINGLE, QuestionType.MULTI ->
                FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                    q.options.forEach { o ->
                        OptionCard(
                            state = if (o in chosen) ChoiceState.SELECTED else ChoiceState.IDLE,
                            enabled = !busy,
                            compact = true,
                            fillWidth = false,
                            onClick = { onEvent(SurveyEvent.Choose(q.id, o)) },
                        ) { Text(optionLabel(q.id, o), style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
                    }
                }
        }
    }
}

private fun questionTitle(id: String): Int =
    when (id) {
        "e_b1" -> R.string.survey_q_e_b1
        "e_b2" -> R.string.survey_q_e_b2
        "e_b3" -> R.string.survey_q_e_b3
        "e_b4" -> R.string.survey_q_e_b4
        "clarity" -> R.string.survey_q_clarity
        "hardest" -> R.string.survey_q_hardest
        "continue" -> R.string.survey_q_continue
        "daily_minutes" -> R.string.survey_q_daily_minutes
        else -> R.string.survey_q_confusing
    }

/** Option wording: numbers are shown as numbers; everything else comes from strings.xml (id + en). */
@Composable
private fun optionLabel(
    questionId: String,
    optionId: String,
): String =
    when (questionId) {
        "clarity" -> optionId
        "e_b4" -> stringResource(R.string.settings_minutes, optionId.toIntOrNull() ?: 0)
        else -> OPTION_LABELS["$questionId/$optionId"]?.let { stringResource(it) } ?: optionId
    }

private val OPTION_LABELS: Map<String, Int> =
    mapOf(
        "e_b1/tpa" to R.string.survey_o_e_b1_tpa,
        "e_b1/iqra" to R.string.survey_o_e_b1_iqra,
        "e_b1/pesantren" to R.string.survey_o_e_b1_pesantren,
        "e_b1/madrasah" to R.string.survey_o_e_b1_madrasah,
        "e_b1/self" to R.string.survey_o_e_b1_self,
        "e_b1/other" to R.string.survey_o_e_b1_other,
        "e_b2/daily" to R.string.survey_o_e_b2_daily,
        "e_b2/weekly" to R.string.survey_o_e_b2_weekly,
        "e_b2/rarely" to R.string.survey_o_e_b2_rarely,
        "e_b2/almost_never" to R.string.survey_o_e_b2_almost_never,
        "e_b3/never" to R.string.survey_o_e_b3_never,
        "e_b3/a_little" to R.string.survey_o_e_b3_a_little,
        "e_b3/quite_a_lot" to R.string.survey_o_e_b3_quite_a_lot,
        "continue/yes" to R.string.survey_o_continue_yes,
        "continue/maybe" to R.string.survey_o_continue_maybe,
        "continue/no" to R.string.survey_o_continue_no,
        "daily_minutes/lt5" to R.string.survey_o_daily_lt5,
        "daily_minutes/5_10" to R.string.survey_o_daily_5_10,
        "daily_minutes/10_15" to R.string.survey_o_daily_10_15,
        "daily_minutes/15_20" to R.string.survey_o_daily_15_20,
        "daily_minutes/gt20" to R.string.survey_o_daily_gt20,
    )

@Preview(name = "background · id", showBackground = true, locale = "id")
@Preview(name = "day7 · en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SurveyPreview() {
    AyaTheme {
        PaperBackground {
            SurveyScreen(state = SurveyUiState(kind = SurveyKind.BACKGROUND, loading = false, answers = mapOf("e_b1" to listOf("tpa", "iqra"))), onEvent = {})
        }
    }
}
