package id.petalytix.ayailmu.feature.units

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.Scoring
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.AccessSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.random.Random

/** Everything the Units screen shows for one track. */
data class UnitsData(
    val trackTitle: String,
    val subject: Subject,
    val rows: List<UnitRow>,
    /** The pack that opens the locked units; null when the track is fully open. */
    val lockedBy: Product?,
)

/** One unit's questions for the preview (one question) or the challenge (up to five), loaded once. */
data class UnitPlaySetup(
    val profile: Profile,
    val unit: String,
    val unitTitle: String?,
    val sticker: String?,
    val content: GatedContent,
    val rules: RuleConfig,
    val targetLang: String?,
    val items: List<Item>,
    val lockedBy: Product?,
)

/** What the Units screens need from the data layer; interfaces so the ViewModels are tested with fakes. */
fun interface UnitsDataSource {
    suspend fun units(track: String): UnitsData?
}

interface UnitPlayDataSource {
    /** One question of [unit] (locked or not); never saved. */
    suspend fun preview(
        track: String,
        unit: String,
    ): UnitPlaySetup?

    /** Null unless the challenge is open now (unit unlocked, practice done, challenge not finished yet). */
    suspend fun challenge(
        track: String,
        unit: String,
    ): UnitPlaySetup?

    suspend fun complete(
        profileId: String,
        track: String,
        unit: String,
    )
}

class DefaultUnitsDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val access: AccessSource,
        private val challenges: ChallengeRepository,
    ) : UnitsDataSource,
        UnitPlayDataSource {
        override suspend fun units(track: String): UnitsData? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            val rows =
                UnitPicks.rows(
                    units = loaded.pack.units,
                    content = SessionContent.playable(loaded.content),
                    history = answers.history(profile.id, track),
                    audience = profile.audience,
                    lang = profile.lang,
                    allows = trackAccess::allows,
                    completed = completed(profile.id, track),
                )
            return UnitsData(
                trackTitle = loaded.pack.meta.title.resolve(profile.lang),
                subject = loaded.pack.meta.subject,
                rows = rows,
                lockedBy = if (trackAccess.locked) trackAccess.product else null,
            )
        }

        override suspend fun preview(
            track: String,
            unit: String,
        ): UnitPlaySetup? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            // The whole track, locked units included: the preview is the free look at what a pack adds.
            val all = SessionContent.playable(loaded.content)
            val item = UnitPicks.previewItem(all, unit, profile.audience) ?: return null
            return setup(profile, loaded, all, unit, listOf(item), if (trackAccess.allows(unit)) null else trackAccess.product)
        }

        override suspend fun challenge(
            track: String,
            unit: String,
        ): UnitPlaySetup? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            val playable = SessionContent.playable(loaded.content, trackAccess::allows)
            val history = answers.history(profile.id, track)
            val row =
                UnitPicks
                    .rows(loaded.pack.units, playable, history, profile.audience, profile.lang, trackAccess::allows, completed(profile.id, track))
                    .firstOrNull { it.unit == unit }
            if (row == null || !row.challengeReady) return null
            val items = UnitPicks.challengeItems(playable, unit, profile.audience, history, Random.Default)
            return setup(profile, loaded, playable, unit, items, null).takeIf { items.isNotEmpty() }
        }

        override suspend fun complete(
            profileId: String,
            track: String,
            unit: String,
        ) {
            challenges.complete(profileId, track, unit)
        }

        private suspend fun completed(
            profileId: String,
            track: String,
        ): Set<String> = challenges.forProfile(profileId).filter { it.track == track }.map { it.unit }.toSet()

        private fun setup(
            profile: Profile,
            loaded: LoadedTrack,
            content: GatedContent,
            unit: String,
            items: List<Item>,
            lockedBy: Product?,
        ): UnitPlaySetup {
            val info = loaded.pack.units.firstOrNull { it.unit == unit }
            return UnitPlaySetup(
                profile = profile,
                unit = unit,
                unitTitle = info?.title?.resolve(profile.lang)?.takeIf { it.isNotBlank() },
                sticker = info?.sticker,
                content = content,
                rules = loaded.rules,
                targetLang = loaded.pack.meta.targetLang,
                items = items,
                lockedBy = lockedBy,
            )
        }
    }

sealed interface UnitsUiState {
    data object Loading : UnitsUiState

    data object Failed : UnitsUiState

    data class Ready(
        val data: UnitsData,
    ) : UnitsUiState
}

/** The units of one track (route argument `track`), with what is open, what is done and what comes next. */
@HiltViewModel
class UnitsViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: UnitsDataSource,
    ) : ViewModel() {
        val track: String = savedStateHandle.get<String>("track").orEmpty()
        private val _state = MutableStateFlow<UnitsUiState>(UnitsUiState.Loading)
        val state: StateFlow<UnitsUiState> = _state.asStateFlow()

        init {
            refresh()
        }

        /** Recompute (e.g. back from a challenge or a purchase). */
        fun refresh() {
            viewModelScope.launch {
                val d =
                    try {
                        data.units(track)
                    } catch (e: Exception) {
                        null
                    }
                _state.value = if (d == null) UnitsUiState.Failed else UnitsUiState.Ready(d)
            }
        }
    }

/** The question on screen, with its feedback once answered. */
data class PlayQuestion(
    val question: StepUi.Question,
    val ts: TargetStyle,
    val feedback: FeedbackView? = null,
)

sealed interface UnitPreviewUiState {
    data object Loading : UnitPreviewUiState

    data object None : UnitPreviewUiState

    data class Ready(
        val unit: String,
        val unitTitle: String?,
        val play: PlayQuestion,
        /** The pack this unit belongs to, when it is locked for this learner. */
        val lockedBy: Product?,
    ) : UnitPreviewUiState
}

/**
 * Scores one answer the same way a session does, in memory only (nothing is written, CR-ENG-9). Any scoring
 * failure (a malformed item, a response of the wrong shape) returns null: the screen stays, nothing crashes.
 */
internal fun scoreInMemory(
    setup: UnitPlaySetup,
    item: Item,
    response: Response,
): FeedbackView? {
    val lang = setup.profile.lang
    return try {
        val score = Scoring.scoreItem(item, response, setup.rules, lang)
        FeedbackView(item.itemId, score.outcome, Session.feedbackMessages(item, score.feedbackIds, setup.content.feedback, lang))
    } catch (e: Exception) {
        null
    }
}

internal fun UnitPlaySetup.play(item: Item): PlayQuestion =
    PlayQuestion(
        question = StepMapper.question(item, Step.Role.PRACTICE, content, profile.lang, targetLang),
        ts = TargetStyle(rtl = targetLang == "ar", scale = profile.arabicScale, synthetic = targetLang == "ar", lang = targetLang),
    )

/** «Coba satu soal»: one question from a unit, typically a locked one (MONETIZATION_SCHEME: show, never hide). */
@HiltViewModel
class UnitPreviewViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: UnitPlayDataSource,
    ) : ViewModel() {
        private val track: String = savedStateHandle.get<String>("track").orEmpty()
        private val unit: String = savedStateHandle.get<String>("unit").orEmpty()
        private val _state = MutableStateFlow<UnitPreviewUiState>(UnitPreviewUiState.Loading)
        val state: StateFlow<UnitPreviewUiState> = _state.asStateFlow()
        private var setup: UnitPlaySetup? = null

        init {
            viewModelScope.launch {
                val s =
                    try {
                        data.preview(track, unit)
                    } catch (e: Exception) {
                        null
                    }
                setup = s
                val item = s?.items?.firstOrNull()
                _state.value =
                    if (s == null || item == null) {
                        UnitPreviewUiState.None
                    } else {
                        UnitPreviewUiState.Ready(unit = s.unit, unitTitle = s.unitTitle, play = s.play(item), lockedBy = s.lockedBy)
                    }
            }
        }

        fun answer(response: Response) {
            val s = setup ?: return
            val ready = _state.value as? UnitPreviewUiState.Ready ?: return
            if (ready.play.feedback != null) return
            val item = s.items.firstOrNull() ?: return
            val feedback = scoreInMemory(s, item, response) ?: return
            _state.value = ready.copy(play = ready.play.copy(feedback = feedback))
        }
    }

sealed interface ChallengeUiState {
    data object Loading : ChallengeUiState

    /** Not open (unit locked, practice not finished, or already done). */
    data object NotReady : ChallengeUiState

    data class Running(
        val unitTitle: String?,
        val unit: String,
        val play: PlayQuestion,
        val position: Int,
        val total: Int,
    ) : ChallengeUiState

    data class Done(
        val unit: String,
        val unitTitle: String?,
        val sticker: String?,
        val saveFailed: Boolean = false,
        /** The finished challenge is recorded, so its sticker is earned (the screen plays the sticker sound once). */
        val saved: Boolean = false,
    ) : ChallengeUiState
}

/**
 * Unit challenge (P6): up to five questions of the unit the learner has already met, offered once the unit's
 * practice is finished. Practice only: scored in memory, no answer events, no pass mark. Reaching the end
 * records the finished challenge, which is what earns the unit's sticker.
 */
@HiltViewModel
class UnitChallengeViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: UnitPlayDataSource,
    ) : ViewModel() {
        private val track: String = savedStateHandle.get<String>("track").orEmpty()
        private val unit: String = savedStateHandle.get<String>("unit").orEmpty()
        private val _state = MutableStateFlow<ChallengeUiState>(ChallengeUiState.Loading)
        val state: StateFlow<ChallengeUiState> = _state.asStateFlow()
        private var setup: UnitPlaySetup? = null
        private var index = 0

        init {
            viewModelScope.launch {
                val s =
                    try {
                        data.challenge(track, unit)
                    } catch (e: Exception) {
                        null
                    }
                if (s == null || s.items.isEmpty()) {
                    _state.value = ChallengeUiState.NotReady
                    return@launch
                }
                setup = s
                show()
            }
        }

        private fun show() {
            val s = setup ?: return
            _state.value = ChallengeUiState.Running(s.unitTitle, s.unit, s.play(s.items[index]), position = index + 1, total = s.items.size)
        }

        fun answer(response: Response) {
            val s = setup ?: return
            val running = _state.value as? ChallengeUiState.Running ?: return
            if (running.play.feedback != null) return
            val feedback = scoreInMemory(s, s.items[index], response) ?: return
            _state.value = running.copy(play = running.play.copy(feedback = feedback))
        }

        /** After the feedback: the next question, or the end (which records the finished challenge). */
        fun next() {
            val s = setup ?: return
            val running = _state.value as? ChallengeUiState.Running ?: return
            if (running.play.feedback == null) return
            index++
            if (index < s.items.size) {
                show()
                return
            }
            _state.value = ChallengeUiState.Done(s.unit, s.unitTitle, s.sticker)
            viewModelScope.launch {
                try {
                    data.complete(s.profile.id, track, s.unit)
                    _state.update { (it as? ChallengeUiState.Done)?.copy(saved = true) ?: it }
                } catch (e: Exception) {
                    _state.update { (it as? ChallengeUiState.Done)?.copy(saveFailed = true) ?: it }
                }
            }
        }
    }
