package id.petalytix.ayailmu.feature.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.collection.Collections
import id.petalytix.ayailmu.feature.collection.GardenScene
import id.petalytix.ayailmu.feature.collection.StickerUi
import id.petalytix.ayailmu.feature.modules.ArtBadge
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import id.petalytix.ayailmu.feature.modules.artKey
import id.petalytix.ayailmu.feature.modules.levelName
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.speedround.SpeedRound
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.AccessSource
import id.petalytix.ayailmu.feature.store.coverKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProgressData(
    val title: String,
    val summary: ProgressSummary,
    /** Adults on casual tracks with enough answered questions may start a speed round (P6). */
    val speedRound: Boolean = false,
    /** Casual tracks with stickers: the «Kebun Ilmu» garden (P6); empty otherwise. */
    val garden: List<StickerUi> = emptyList(),
    /** Follow-up 12: the module and level, drawn as the module cover and the level badge beside the title. */
    val subject: Subject? = null,
    val level: Level? = null,
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
        private val access: AccessSource,
        private val challenges: ChallengeRepository,
    ) : ProgressDataSource {
        override suspend fun load(track: String): ProgressData? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            // Counted over the units this learner can open, so "x of y" grows when a pack is bought.
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            val playable = SessionContent.playable(loaded.content, trackAccess::allows)
            val history = answers.history(profile.id, track)
            val summary = ProgressCalculator.compute(history, loaded.rules, playable)
            return ProgressData(
                title = loaded.pack.meta.title.resolve(profile.lang),
                summary = summary,
                speedRound = SpeedRound.offered(profile, loaded.rules.mode, playable, history),
                garden =
                    if (loaded.rules.mode == TrackMode.CASUAL) {
                        val done = challenges.forProfile(profile.id).filter { it.track == track }.map { it.unit }.toSet()
                        Collections.stickers(loaded.pack.units, profile.lang, done)
                    } else {
                        emptyList()
                    },
                subject = loaded.pack.meta.subject,
                level = loaded.pack.meta.level,
            )
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

        private val track = savedStateHandle.get<String>("track").orEmpty()

        init {
            refresh()
        }

        /** Loads again (back from Units or a unit challenge); what is on screen stays while it loads. */
        fun refresh() {
            viewModelScope.launch {
                val next =
                    try {
                        data.load(track)?.let { ProgressUiState.Ready(it) } ?: ProgressUiState.Failed
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        ProgressUiState.Failed
                    }
                // A failed reload keeps the progress already shown.
                if (next is ProgressUiState.Ready || _state.value !is ProgressUiState.Ready) _state.value = next
            }
        }
    }

/** Where Progress can send the learner. */
data class ProgressNav(
    val back: () -> Unit = {},
    val speedRound: () -> Unit = {},
    val gems: () -> Unit = {},
    val stickers: () -> Unit = {},
    val units: () -> Unit = {},
)

@Composable
fun ProgressRoute(
    nav: ProgressNav,
    viewModel: ProgressViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Back from Units or a challenge: reload, so finished units and stickers show (as Home and Units do).
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        if (entered) viewModel.refresh() else entered = true
    }
    ProgressScreen(state = state, nav = nav)
}

@Composable
fun ProgressScreen(
    state: ProgressUiState,
    nav: ProgressNav,
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
            ProgressUiState.Failed -> PictureMessage("state_error", stringResource(R.string.progress_failed), null)
            is ProgressUiState.Ready -> ProgressBody(state.data, nav)
        }
        AyaSecondaryButton(text = stringResource(R.string.action_back), onClick = nav.back, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun ColumnScope.ProgressBody(
    d: ProgressData,
    nav: ProgressNav,
) {
    val colors = AyaThemeTokens.colors
    val s = d.summary
    val line = MaterialTheme.typography.bodyLarge
    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
        d.subject?.let { ArtWithFallback(it.coverKey(), contentDescription = null, modifier = Modifier.width(COVER)) }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
            Text(d.title, style = MaterialTheme.typography.titleLarge, color = colors.inkSoft)
            d.level?.let { level ->
                val name = stringResource(levelName(level))
                ArtBadge(art = level.artKey(), label = name, description = stringResource(R.string.module_cd_level, name))
            }
        }
    }
    if (d.garden.isNotEmpty()) {
        PaperCard {
            Text(stringResource(R.string.garden_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
            GardenScene(d.garden)
            Text(stringResource(R.string.garden_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        }
    }
    AyaSecondaryButton(text = stringResource(R.string.units_title), onClick = nav.units, modifier = Modifier.fillMaxWidth())
    if (!s.hasAnyActivity) {
        PictureMessage("state_seedling", stringResource(R.string.progress_empty_title), stringResource(R.string.progress_empty))
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
    AyaSecondaryButton(text = stringResource(R.string.progress_open_gems), onClick = nav.gems, modifier = Modifier.fillMaxWidth())
    AyaSecondaryButton(text = stringResource(R.string.progress_open_stickers), onClick = nav.stickers, modifier = Modifier.fillMaxWidth())
    if (d.speedRound) {
        PaperCard(edge = colors.slate) {
            Text(stringResource(R.string.speed_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
            Text(stringResource(R.string.progress_speed_body), style = line, color = colors.ink)
            AyaButton(text = stringResource(R.string.progress_speed_start), onClick = nav.speedRound, modifier = Modifier.fillMaxWidth())
        }
    }
}

private val COVER = 72.dp

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
    AyaTheme {
        PaperBackground {
            ProgressScreen(
                state =
                    ProgressUiState.Ready(
                        ProgressData("Bahasa Arab — Unit A", previewSummary, subject = Subject.BAHASA, level = Level.PEMULA),
                    ),
                nav = ProgressNav(),
            )
        }
    }
}
