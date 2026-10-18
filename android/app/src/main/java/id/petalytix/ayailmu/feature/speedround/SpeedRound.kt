package id.petalytix.ayailmu.feature.speedround

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.Scoring
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.AccessSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.random.Random

/**
 * Speed round (P6): an opt-in practice mode for adults, offered from Progress on casual tracks. It replays up
 * to [SIZE] questions the learner has already answered (choice and number questions only) against one soft
 * time bar with no digits. Nothing is saved: no answer events, no evidence, no score history (CR-ENG-9).
 * Info cards and stories (follow-up 12) are never part of it: they are seen, not answered.
 */
object SpeedRound {
    const val SIZE = 10
    const val MIN_ITEMS = 4
    const val ROUND_MS = 150_000L
    private val POOLS = setOf(Pool.PRACT, Pool.REMED)

    fun eligible(item: Item): Boolean {
        val kind = StepMapper.kindOf(item)
        return item.pool in POOLS && item.readingId == null && !item.isStory && (kind == RenderKind.CHOICE || kind == RenderKind.NUMBER)
    }

    fun pick(
        content: GatedContent,
        history: List<AnswerEvent>,
        random: Random,
    ): List<Item> {
        val seen = history.map { it.itemId }.toSet()
        return content.items.filter { it.itemId in seen && eligible(it) }.shuffled(random).take(SIZE)
    }

    /** Offered only to adults on casual tracks, once there is enough to replay. */
    fun offered(
        profile: Profile,
        mode: TrackMode,
        content: GatedContent,
        history: List<AnswerEvent>,
    ): Boolean {
        if (profile.kind != ProfileKind.ADULT || mode != TrackMode.CASUAL) return false
        val seen = history.map { it.itemId }.toSet()
        return content.items.count { it.itemId in seen && eligible(it) } >= MIN_ITEMS
    }
}

data class SpeedSetup(
    val profile: Profile,
    val content: GatedContent,
    val rules: RuleConfig,
    val targetLang: String?,
    val items: List<Item>,
)

fun interface SpeedRoundDataSource {
    suspend fun setup(track: String): SpeedSetup?
}

class DefaultSpeedRoundDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val access: AccessSource,
    ) : SpeedRoundDataSource {
        override suspend fun setup(track: String): SpeedSetup? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            val playable = SessionContent.playable(loaded.content, trackAccess::allows)
            val history = answers.history(profile.id, track)
            if (!SpeedRound.offered(profile, loaded.rules.mode, playable, history)) return null
            return SpeedSetup(profile, playable, loaded.rules, loaded.pack.meta.targetLang, SpeedRound.pick(playable, history, Random.Default))
        }
    }

sealed interface SpeedUiState {
    data object Loading : SpeedUiState

    /** Not offered (child profile, evidence track, too few answered questions). */
    data object NotAvailable : SpeedUiState

    data class Running(
        val question: StepUi.Question,
        val ts: TargetStyle,
        val position: Int,
        val total: Int,
        /** 1 at the start, 0 when time is up. Drawn as a bar, never as digits. */
        val timeLeft: Float,
        /** The outcome of the question on screen, shown briefly before the next one. */
        val outcome: Outcome? = null,
    ) : SpeedUiState

    data class Done(
        val answered: Int,
        val correct: Int,
        val timeUp: Boolean,
    ) : SpeedUiState
}

@HiltViewModel
class SpeedRoundViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: SpeedRoundDataSource,
        private val clock: Clock,
    ) : ViewModel() {
        private val track: String = savedStateHandle.get<String>("track").orEmpty()
        private val _state = MutableStateFlow<SpeedUiState>(SpeedUiState.Loading)
        val state: StateFlow<SpeedUiState> = _state.asStateFlow()

        private var setup: SpeedSetup? = null
        private var index = 0
        private var answered = 0
        private var correct = 0
        private var startedAt = 0L
        private var timer: Job? = null

        init {
            viewModelScope.launch {
                val s =
                    try {
                        data.setup(track)
                    } catch (e: Exception) {
                        null
                    }
                if (s == null || s.items.isEmpty()) {
                    _state.value = SpeedUiState.NotAvailable
                    return@launch
                }
                setup = s
                startedAt = clock.now().toEpochMilli()
                show()
                timer =
                    viewModelScope.launch {
                        while (isActive) {
                            delay(TICK_MS)
                            val left = 1f - (clock.now().toEpochMilli() - startedAt).toFloat() / SpeedRound.ROUND_MS
                            if (left <= 0f) {
                                finish(timeUp = true)
                                break
                            }
                            _state.update { (it as? SpeedUiState.Running)?.copy(timeLeft = left) ?: it }
                        }
                    }
            }
        }

        private fun show() {
            val s = setup ?: return
            val item = s.items[index]
            _state.value =
                SpeedUiState.Running(
                    question = StepMapper.question(item, Step.Role.PRACTICE, s.content, s.profile.lang, s.targetLang),
                    ts =
                        TargetStyle(
                            rtl = s.targetLang == "ar",
                            scale = s.profile.arabicScale,
                            synthetic = s.targetLang == "ar",
                            lang = s.targetLang,
                        ),
                    position = index + 1,
                    total = s.items.size,
                    timeLeft = ((_state.value as? SpeedUiState.Running)?.timeLeft) ?: 1f,
                )
        }

        fun answer(response: Response) {
            val s = setup ?: return
            val running = _state.value as? SpeedUiState.Running ?: return
            if (running.outcome != null) return
            val outcome =
                try {
                    Scoring.scoreItem(s.items[index], response, s.rules, s.profile.lang).outcome
                } catch (e: IllegalArgumentException) {
                    return
                }
            answered++
            if (outcome == Outcome.CORRECT) correct++
            _state.value = running.copy(outcome = outcome)
            viewModelScope.launch {
                delay(REVEAL_MS)
                if (_state.value !is SpeedUiState.Running) return@launch
                index++
                if (index >= s.items.size) finish(timeUp = false) else show()
            }
        }

        fun skip() = answer(Response.dontKnow())

        private fun finish(timeUp: Boolean) {
            if (_state.value is SpeedUiState.Done) return
            timer?.cancel()
            _state.value = SpeedUiState.Done(answered = answered, correct = correct, timeUp = timeUp)
        }

        private companion object {
            const val TICK_MS = 500L
            const val REVEAL_MS = 700L
        }
    }
