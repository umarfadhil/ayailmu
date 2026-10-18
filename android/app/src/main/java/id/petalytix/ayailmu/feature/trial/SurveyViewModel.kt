package id.petalytix.ayailmu.feature.trial

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.repo.SurveyRepository
import id.petalytix.ayailmu.core.data.settings.TrialStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the survey screen needs from the data layer; an interface so the ViewModel is tested with a fake. */
interface SurveyDataSource {
    suspend fun profile(): Profile?

    /** Kinds this profile already answered (or skipped) on [track]. */
    suspend fun done(
        profileId: String,
        track: String,
    ): Set<SurveyKind>

    suspend fun save(
        profileId: String,
        track: String,
        kind: SurveyKind,
        answers: Map<String, List<String>>,
    )

    suspend fun setSessionMinutes(
        profileId: String,
        minutes: Int,
    )

    /** "Nanti saja" on a day-7 or end survey: Home's card stays hidden for the rest of today. */
    suspend fun snooze(profileId: String)
}

class DefaultSurveyDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val surveys: SurveyRepository,
        private val build: AppBuildInfo,
        private val trialStore: TrialStore,
        private val clock: Clock,
    ) : SurveyDataSource {
        override suspend fun profile(): Profile? = profiles.activeProfile()

        override suspend fun done(
            profileId: String,
            track: String,
        ): Set<SurveyKind> = surveys.forProfile(profileId).filter { it.track == track }.mapNotNull { SurveyKind.of(it.kind) }.toSet()

        override suspend fun save(
            profileId: String,
            track: String,
            kind: SurveyKind,
            answers: Map<String, List<String>>,
        ) {
            surveys.save(profileId, track, kind.code, answers, build.appVersion)
        }

        override suspend fun setSessionMinutes(
            profileId: String,
            minutes: Int,
        ) = profiles.setSessionMinutes(profileId, minutes)

        override suspend fun snooze(profileId: String) {
            trialStore.snoozeSurvey(profileId, Dates.localDate(clock.now().toEpochMilli(), clock.zone))
        }
    }

data class SurveyUiState(
    val kind: SurveyKind = SurveyKind.DAY7,
    val loading: Boolean = true,
    val answers: Map<String, List<String>> = emptyMap(),
    val busy: Boolean = false,
    val failed: Boolean = false,
    /** Saved (or already answered before): the screen moves on. */
    val done: Boolean = false,
)

sealed interface SurveyEvent {
    data class Choose(
        val questionId: String,
        val optionId: String,
    ) : SurveyEvent

    data class Type(
        val questionId: String,
        val text: String,
    ) : SurveyEvent

    data object Submit : SurveyEvent

    /**
     * "Lewati" / "Nanti saja": background stores an empty answer (never asked again); a day-7 or end survey is
     * snoozed for today, like Home's "Nanti saja", and asked again another day.
     */
    data object Skip : SurveyEvent
}

/**
 * Trial questionnaires (P7). Route arguments: `kind` (background/day7/end) and `track`. Background comes right
 * after consent and before the first session; it is never blocking ("Lewati" moves on and is not asked again).
 */
@HiltViewModel
class SurveyViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: SurveyDataSource,
    ) : ViewModel() {
        private val track: String = savedStateHandle.get<String>("track").orEmpty()
        private val kind: SurveyKind = SurveyKind.of(savedStateHandle.get<String>("kind").orEmpty()) ?: SurveyKind.DAY7
        private val _state = MutableStateFlow(SurveyUiState(kind = kind))
        val state: StateFlow<SurveyUiState> = _state.asStateFlow()
        private var profile: Profile? = null

        /** The answers are stored; a second Submit (after a later step failed) must not store them again. */
        private var saved = false

        init {
            viewModelScope.launch {
                val p =
                    try {
                        data.profile()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        null
                    }
                profile = p
                val already =
                    try {
                        p != null && kind in data.done(p.id, track)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        false
                    }
                // No profile, or this form was answered before (e.g. consent given again): just move on.
                _state.update { it.copy(loading = false, done = p == null || already) }
            }
        }

        fun onEvent(event: SurveyEvent) {
            val question = (event as? SurveyEvent.Choose)?.questionId ?: (event as? SurveyEvent.Type)?.questionId
            val q = question?.let { id -> SurveyForms.of(kind).firstOrNull { it.id == id } }
            when (event) {
                is SurveyEvent.Choose ->
                    if (q != null) {
                        _state.update { s ->
                            val now = s.answers[q.id].orEmpty()
                            val next =
                                when (q.type) {
                                    QuestionType.SINGLE -> if (event.optionId in now) emptyList() else listOf(event.optionId)
                                    QuestionType.MULTI -> if (event.optionId in now) now - event.optionId else now + event.optionId
                                    QuestionType.TEXT -> now
                                }
                            s.copy(answers = s.answers + (q.id to next))
                        }
                    }
                is SurveyEvent.Type ->
                    if (q != null && q.type == QuestionType.TEXT) {
                        _state.update { s -> s.copy(answers = s.answers + (q.id to listOf(event.text.take(SurveyForms.MAX_TEXT)))) }
                    }
                SurveyEvent.Submit -> save(SurveyForms.clean(kind, _state.value.answers))
                SurveyEvent.Skip -> if (kind == SurveyKind.BACKGROUND) save(emptyMap()) else snooze()
            }
        }

        private fun snooze() {
            val p = profile
            if (p == null || _state.value.busy) {
                _state.update { it.copy(done = true) }
                return
            }
            _state.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    data.snooze(p.id)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Not worth a message: at worst Home shows the card again today.
                }
                _state.update { it.copy(busy = false, done = true) }
            }
        }

        private fun save(answers: Map<String, List<String>>) {
            val p = profile ?: return
            if (_state.value.busy) return
            if (saved) {
                _state.update { it.copy(done = true) }
                return
            }
            _state.update { it.copy(busy = true, failed = false) }
            viewModelScope.launch {
                try {
                    data.save(p.id, track, kind, answers)
                    saved = true
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.update { it.copy(busy = false, failed = true) }
                    return@launch
                }
                // E-B4 sets the default daily length (Trial_App_Spec §6). A failure here is not worth a retry of the
                // whole form: the answers are stored, and the learner can set the length in Settings.
                if (kind == SurveyKind.BACKGROUND) {
                    SurveyForms.sessionMinutes(answers)?.let { minutes ->
                        try {
                            data.setSessionMinutes(p.id, minutes)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Unit
                        }
                    }
                }
                _state.update { it.copy(busy = false, done = true) }
            }
        }
    }
