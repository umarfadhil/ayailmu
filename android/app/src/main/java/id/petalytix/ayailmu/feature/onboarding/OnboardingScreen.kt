package id.petalytix.ayailmu.feature.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.AppLocale
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.AyaFigure
import id.petalytix.ayailmu.core.design.art.AyaPose
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.home.AvatarPicker

/**
 * First-run onboarding and "add a profile" (same three steps: language, a neutral age screen, a nickname).
 * [onCancel] is null on first run: there is nowhere to go back to.
 */
@Composable
fun OnboardingRoute(
    onDone: () -> Unit,
    onCancel: (() -> Unit)?,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.done) { if (state.done) onDone() }
    // First run only: switch the app language as soon as one is tapped. The activity is recreated and this
    // ViewModel survives, so the learner stays on the same step. When adding a profile, the language changes
    // only once the new profile becomes active (MainActivity), so cancelling never leaves the app switched.
    LaunchedEffect(state.firstRun, state.langPicked, state.lang) {
        if (state.firstRun && state.langPicked) AppLocale.apply(state.lang)
    }
    BackHandler(enabled = state.step != OnboardingStep.LANGUAGE || onCancel != null) {
        if (state.step == OnboardingStep.LANGUAGE) onCancel?.invoke() else viewModel.onEvent(OnboardingEvent.Back)
    }
    OnboardingScreen(state = state, onEvent = viewModel::onEvent, onCancel = onCancel)
}

@Composable
fun OnboardingScreen(
    state: OnboardingUiState,
    onEvent: (OnboardingEvent) -> Unit,
    onCancel: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    if (state.loading) {
        Box(modifier.fillMaxSize())
        return
    }
    Column(modifier = modifier.fillMaxSize().safeDrawingPadding().padding(AyaSpacing.lg)) {
        Row(modifier = Modifier.fillMaxWidth().heightIn(min = AyaSpacing.touch), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.onb_step, state.stepNumber, OnboardingUiState.STEPS),
                style = MaterialTheme.typography.labelSmall,
                color = colors.inkSoft,
                modifier = Modifier.weight(1f),
            )
            val showBack = state.step != OnboardingStep.LANGUAGE || onCancel != null
            if (showBack) {
                TextButton(onClick = { if (state.step == OnboardingStep.LANGUAGE) onCancel?.invoke() else onEvent(OnboardingEvent.Back) }) {
                    Text(stringResource(R.string.action_back), color = colors.inkSoft)
                }
            }
        }
        Spacer(Modifier.height(AyaSpacing.sm))
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (state.step) {
                OnboardingStep.LANGUAGE -> LanguageStep(state, onEvent)
                OnboardingStep.AGE -> AgeStep(state, onEvent)
                OnboardingStep.GUARDIAN -> GuardianStep()
                OnboardingStep.NAME -> NameStep(state, onEvent)
            }
        }
        Spacer(Modifier.height(AyaSpacing.md))
        if (state.step != OnboardingStep.GUARDIAN) {
            AyaButton(
                text = stringResource(if (state.step == OnboardingStep.NAME) R.string.onb_create else R.string.action_continue),
                onClick = { onEvent(OnboardingEvent.Next) },
                enabled = state.canContinue,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            AyaButton(text = stringResource(R.string.action_back), onClick = { onEvent(OnboardingEvent.Back) }, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun LanguageStep(
    state: OnboardingUiState,
    onEvent: (OnboardingEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
        // Aya waves hello on first run only (draft character, ART_DIRECTION section 7).
        if (state.firstRun) AyaFigure(pose = AyaPose.WAVE, contentDescription = stringResource(R.string.cd_aya_mascot), size = 120.dp)
        Text(
            text = stringResource(if (state.firstRun) R.string.onb_welcome_title else R.string.onb_add_title),
            style = MaterialTheme.typography.headlineMedium,
            color = colors.ink,
            modifier = Modifier.headingSemantics(),
        )
        if (state.firstRun) {
            Text(stringResource(R.string.onb_welcome_body), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
        }
        Text(stringResource(R.string.onb_lang_question), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        listOf(Lang.ID to R.string.lang_name_id, Lang.EN to R.string.lang_name_en).forEach { (lang, name) ->
            OptionCard(
                state = if (state.lang == lang) ChoiceState.SELECTED else ChoiceState.IDLE,
                onClick = { onEvent(OnboardingEvent.PickLang(lang)) },
            ) {
                Text(stringResource(name), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
            }
        }
    }
}

@Composable
private fun AgeStep(
    state: OnboardingUiState,
    onEvent: (OnboardingEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    // Scroll near the middle of the list so no year looks suggested; still nothing is selected.
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = state.years.indexOf(state.birthYear).takeIf { it >= 0 } ?: 25)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Text(stringResource(R.string.onb_age_title), style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(stringResource(R.string.onb_age_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs),
        ) {
            items(state.years, key = { it }) { year ->
                OptionCard(
                    state = if (state.birthYear == year) ChoiceState.SELECTED else ChoiceState.IDLE,
                    onClick = { onEvent(OnboardingEvent.PickYear(year)) },
                    compact = true,
                ) {
                    Text(year.toString(), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                }
            }
        }
    }
}

@Composable
private fun GuardianStep() {
    val colors = AyaThemeTokens.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
        // A grown-up's picture first: the message is "ask a parent", before a child reads a word.
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
            ArtImage("pic_woman", contentDescription = null, modifier = Modifier.width(GUARDIAN_ART))
            ArtImage("pic_man", contentDescription = null, modifier = Modifier.width(GUARDIAN_ART))
        }
        PaperCard(edge = colors.ochre) {
            Text(stringResource(R.string.onb_guardian_title), style = MaterialTheme.typography.titleLarge, color = colors.ink)
            Text(stringResource(R.string.onb_guardian_body), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        }
    }
}

@Composable
private fun NameStep(
    state: OnboardingUiState,
    onEvent: (OnboardingEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
        Text(
            text = stringResource(if (state.willBeChild) R.string.onb_name_title_child else R.string.onb_name_title),
            style = MaterialTheme.typography.headlineMedium,
            color = colors.ink,
            modifier = Modifier.headingSemantics(),
        )
        if (state.willBeChild && state.creatorLabel != null) {
            Text(stringResource(R.string.onb_child_note, state.creatorLabel), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        }
        AyaTextField(
            value = state.name,
            onValueChange = { onEvent(OnboardingEvent.NameChanged(it)) },
            label = stringResource(R.string.onb_name_label),
            supporting = stringResource(R.string.onb_name_hint),
            enabled = !state.busy,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onEvent(OnboardingEvent.Next) }),
        )
        // Follow-up 12: a picture for the profile (shown on Home instead of a letter); optional, a default is chosen.
        Text(stringResource(R.string.avatar_pick_prompt), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        AvatarPicker(chosen = state.avatar, enabled = !state.busy, onPick = { onEvent(OnboardingEvent.PickAvatar(it)) })
        if (state.error) {
            Text(stringResource(R.string.onb_error), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
        }
    }
}

private val GUARDIAN_ART = 96.dp

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun OnboardingLanguagePreview() {
    AyaTheme {
        PaperBackground {
            OnboardingScreen(state = OnboardingUiState(loading = false, years = (2026 downTo 1926).toList()), onEvent = {}, onCancel = null)
        }
    }
}

@Preview(name = "age · id", showBackground = true, locale = "id")
@Composable
private fun OnboardingAgePreview() {
    AyaTheme {
        PaperBackground {
            OnboardingScreen(
                state = OnboardingUiState(loading = false, step = OnboardingStep.AGE, years = (2026 downTo 1926).toList()),
                onEvent = {},
                onCancel = {},
            )
        }
    }
}
