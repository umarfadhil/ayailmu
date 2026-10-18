package id.petalytix.ayailmu.feature.puzzle

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.DailyPuzzleStore
import id.petalytix.ayailmu.core.data.settings.PuzzleMark
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.Scoring
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.home.fits
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/** A daily puzzle and the track it comes from. */
data class PuzzleCandidate(
    val track: String,
    val item: Item,
)

/**
 * Home's daily puzzle (P6): one a day per profile, from the subjects on that profile's shelf. Practice only:
 * scored for the moment, never saved as an answer event, never evidence (ItemType.DAILY_PUZZLE). The pick
 * walks through every puzzle in turn (by date), starting at a different place for each profile.
 */
object DailyPuzzle {
    fun candidates(
        tracks: List<LoadedTrack>,
        profile: Profile,
    ): List<PuzzleCandidate> =
        tracks
            .filter { it.fits(profile) }
            .flatMap { t ->
                SessionContent
                    .dailyPuzzles(t.content)
                    .filter { it.audience == null || it.audience == profile.audience }
                    .map { PuzzleCandidate(t.track, it) }
            }

    fun pick(
        candidates: List<PuzzleCandidate>,
        date: String,
        profileId: String,
    ): PuzzleCandidate? {
        if (candidates.isEmpty()) return null
        val sorted = candidates.sortedWith(compareBy<PuzzleCandidate>({ it.track }, { it.item.itemId }))
        val day = runCatching { LocalDate.parse(date).toEpochDay() }.getOrDefault(0L)
        val start = Math.floorMod(profileId.hashCode().toLong(), sorted.size.toLong())
        return sorted[Math.floorMod(day + start, sorted.size.toLong()).toInt()]
    }

    /** What is saved: only the day, the item and the outcome word (nothing typed). */
    fun outcomeWord(o: Outcome): String =
        when (o) {
            Outcome.CORRECT -> "correct"
            Outcome.WRONG -> "wrong"
            else -> "dont_know"
        }
}

/** Everything the puzzle screen needs, loaded once. */
data class PuzzleSetup(
    val profile: Profile,
    val track: String,
    val subjectTitle: String,
    val content: GatedContent,
    val rules: RuleConfig,
    val targetLang: String?,
    val item: Item,
    val today: String,
    /** Today's mark, when this puzzle was already answered today. */
    val doneToday: PuzzleMark?,
)

interface DailyPuzzleDataSource {
    suspend fun load(): PuzzleSetup?

    suspend fun save(
        profileId: String,
        mark: PuzzleMark,
    )
}

class DefaultDailyPuzzleDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val puzzles: DailyPuzzleStore,
        private val clock: Clock,
    ) : DailyPuzzleDataSource {
        override suspend fun load(): PuzzleSetup? {
            val profile = profiles.activeProfile() ?: return null
            val tracks = content.tracks()
            val today = Dates.localDate(clock.now().toEpochMilli(), clock.zone)
            val pick = DailyPuzzle.pick(DailyPuzzle.candidates(tracks, profile), today, profile.id) ?: return null
            val track = tracks.firstOrNull { it.track == pick.track } ?: return null
            val mark = puzzles.marks.first()[profile.id]?.takeIf { it.date == today && it.itemId == pick.item.itemId }
            return PuzzleSetup(
                profile = profile,
                track = track.track,
                subjectTitle = track.pack.meta.title.resolve(profile.lang),
                content = track.content,
                rules = track.rules,
                targetLang = track.pack.meta.targetLang,
                item = pick.item,
                today = today,
                doneToday = mark,
            )
        }

        override suspend fun save(
            profileId: String,
            mark: PuzzleMark,
        ) = puzzles.mark(profileId, mark)
    }

sealed interface PuzzleUiState {
    data object Loading : PuzzleUiState

    /** No puzzle for this profile today (none in its subjects, or none approved yet in prod). */
    data object None : PuzzleUiState

    data class Ready(
        val subjectTitle: String,
        val question: StepUi.Question,
        val ts: TargetStyle,
        /** Set after "Check" (or when today's puzzle was already answered). */
        val feedback: FeedbackView? = null,
        val alreadyDone: Boolean = false,
        val modelAnswer: String? = null,
        val saveFailed: Boolean = false,
    ) : PuzzleUiState
}

@HiltViewModel
class DailyPuzzleViewModel
    @Inject
    constructor(
        private val data: DailyPuzzleDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow<PuzzleUiState>(PuzzleUiState.Loading)
        val state: StateFlow<PuzzleUiState> = _state.asStateFlow()
        private var setup: PuzzleSetup? = null

        init {
            viewModelScope.launch {
                val s =
                    try {
                        data.load()
                    } catch (e: Exception) {
                        null
                    }
                setup = s
                _state.value =
                    if (s == null) {
                        PuzzleUiState.None
                    } else {
                        val lang = s.profile.lang
                        val done = s.doneToday
                        PuzzleUiState.Ready(
                            subjectTitle = s.subjectTitle,
                            question = StepMapper.question(s.item, Step.Role.PRACTICE, s.content, lang, s.targetLang),
                            ts =
                                TargetStyle(
                                    rtl = s.targetLang == "ar",
                                    scale = s.profile.arabicScale,
                                    synthetic = s.targetLang == "ar",
                                    lang = s.targetLang,
                                ),
                            feedback = done?.let { FeedbackView(s.item.itemId, outcomeOf(it.outcome), emptyList()) },
                            alreadyDone = done != null,
                            modelAnswer = s.item.modelAnswer?.resolve(lang),
                        )
                    }
            }
        }

        /** Scores in memory (the same rules as a session), shows feedback, then marks today as done. */
        fun answer(response: Response) {
            val s = setup ?: return
            val ready = _state.value as? PuzzleUiState.Ready ?: return
            if (ready.feedback != null) return
            val lang = s.profile.lang
            val (outcome, messages) =
                try {
                    val score = Scoring.scoreItem(s.item, response, s.rules, lang)
                    score.outcome to Session.feedbackMessages(s.item, score.feedbackIds, s.content.feedback, lang)
                } catch (e: Exception) {
                    return // a malformed puzzle stays unanswered instead of closing the app
                }
            _state.value = ready.copy(feedback = FeedbackView(s.item.itemId, outcome, messages))
            viewModelScope.launch {
                try {
                    data.save(s.profile.id, PuzzleMark(date = s.today, itemId = s.item.itemId, outcome = DailyPuzzle.outcomeWord(outcome)))
                } catch (e: Exception) {
                    _state.update { (it as? PuzzleUiState.Ready)?.copy(saveFailed = true) ?: it }
                }
            }
        }

        private fun outcomeOf(word: String): Outcome =
            when (word) {
                "correct" -> Outcome.CORRECT
                "wrong" -> Outcome.WRONG
                else -> Outcome.DONT_KNOW
            }
    }
