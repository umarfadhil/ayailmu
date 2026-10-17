package id.petalytix.ayailmu.feature.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.session.SessionContent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProgressData(
    val title: String,
    val summary: ProgressSummary,
)

/** Loads one track's progress for the active profile; null when there is no profile or no such track. */
fun interface ProgressDataSource {
    suspend fun load(track: String): ProgressData?
}

class DefaultProgressDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
    ) : ProgressDataSource {
        override suspend fun load(track: String): ProgressData? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val summary = ProgressCalculator.compute(answers.history(profile.id, track), loaded.rules, SessionContent.playable(loaded.content))
            return ProgressData(loaded.pack.meta.title.resolve(profile.lang), summary)
        }
    }

sealed interface ProgressUiState {
    data object Loading : ProgressUiState

    data object Failed : ProgressUiState

    data class Ready(
        val data: ProgressData,
    ) : ProgressUiState
}

@HiltViewModel
class ProgressViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: ProgressDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow<ProgressUiState>(ProgressUiState.Loading)
        val state: StateFlow<ProgressUiState> = _state.asStateFlow()

        init {
            val track = savedStateHandle.get<String>("track").orEmpty()
            viewModelScope.launch {
                _state.value =
                    try {
                        data.load(track)?.let { ProgressUiState.Ready(it) } ?: ProgressUiState.Failed
                    } catch (e: Exception) {
                        ProgressUiState.Failed
                    }
            }
        }
    }

@Composable
fun ProgressRoute(
    onBack: () -> Unit,
    viewModel: ProgressViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ProgressScreen(state = state, onBack = onBack)
}

@Composable
fun ProgressScreen(
    state: ProgressUiState,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        Text(stringResource(R.string.progress_title), style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        when (state) {
            ProgressUiState.Loading -> Box(Modifier.fillMaxWidth())
            ProgressUiState.Failed -> Text(stringResource(R.string.progress_failed), style = MaterialTheme.typography.bodyLarge, color = colors.notYet)
            is ProgressUiState.Ready -> ProgressBody(state.data)
        }
        AyaSecondaryButton(text = stringResource(R.string.action_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun ProgressBody(d: ProgressData) {
    val colors = AyaThemeTokens.colors
    val s = d.summary
    val line = MaterialTheme.typography.bodyLarge
    Text(d.title, style = MaterialTheme.typography.titleLarge, color = colors.inkSoft)
    if (!s.hasAnyActivity) {
        PaperCard { Text(stringResource(R.string.progress_empty), style = line, color = colors.ink) }
        return
    }
    if (s.mode == TrackMode.EVIDENCE) {
        // Three honest lines, never one combined number (CR-HAB-4).
        ProgressLine(stringResource(R.string.progress_learned_title), stringResource(R.string.progress_count_skills, s.learned.done, s.learned.of))
        ProgressLine(
            stringResource(R.string.progress_remembered_title),
            if (s.remembered.of == 0) {
                stringResource(R.string.progress_remembered_none)
            } else {
                stringResource(R.string.progress_count_checks, s.remembered.done, s.remembered.of)
            },
        )
        ProgressLine(
            stringResource(R.string.progress_new_title),
            if (s.newSentences.of == 0) {
                stringResource(R.string.progress_new_none)
            } else {
                stringResource(R.string.progress_count_sentences, s.newSentences.done, s.newSentences.of)
            },
        )
    } else {
        // Casual tracks may show a single mastery bar (CR-HAB-4).
        val cd = stringResource(R.string.progress_count_skills, s.learned.done, s.learned.of)
        PaperCard {
            Text(stringResource(R.string.progress_learned_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
            SessionProgressBar(progress = if (s.learned.of == 0) 0f else s.learned.done.toFloat() / s.learned.of, contentDescription = cd)
            Text(cd, style = line, color = colors.ink)
        }
    }
    PaperCard {
        if (s.words.of > 0) Text(stringResource(R.string.progress_words, s.words.done, s.words.of), style = line, color = colors.ink)
        Text(stringResource(R.string.progress_practicing, s.practicing), style = line, color = colors.ink)
        if (s.needsFollowUp > 0) Text(stringResource(R.string.progress_follow_up, s.needsFollowUp), style = line, color = colors.ink)
        if (s.waitingForCheck > 0) Text(stringResource(R.string.progress_waiting, s.waitingForCheck), style = line, color = colors.ink)
        Text(stringResource(R.string.progress_gems, s.gems), style = line, color = colors.ink)
        Text(stringResource(R.string.progress_days, s.daysPracticed), style = line, color = colors.inkSoft)
    }
    Text(stringResource(R.string.progress_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
}

@Composable
private fun ProgressLine(
    title: String,
    value: String,
) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        Text(title, style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(value, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
    }
}

private val previewSummary =
    ProgressSummary(
        mode = TrackMode.EVIDENCE,
        learned = Count(3, 9),
        remembered = Count(2, 3),
        newSentences = Count(0, 0),
        words = Count(4, 12),
        practicing = 5,
        needsFollowUp = 1,
        waitingForCheck = 2,
        gems = 1,
        daysPracticed = 6,
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun ProgressPreview() {
    AyaTheme { PaperBackground { ProgressScreen(state = ProgressUiState.Ready(ProgressData("Bahasa Arab — Unit A", previewSummary)), onBack = {}) } }
}
