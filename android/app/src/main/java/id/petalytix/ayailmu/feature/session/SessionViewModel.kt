package id.petalytix.ayailmu.feature.session

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.IdGenerator
import id.petalytix.ayailmu.core.engine.RngFactory
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.SaveResult
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionController
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.SessionStore
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.consent.Consent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Everything a session needs, loaded once when the screen opens. */
data class SessionSetup(
    val profile: Profile,
    /** Gated content already reduced to v1-renderable items ([SessionContent.playable]). */
    val content: GatedContent,
    val rules: RuleConfig,
    /** Target language of a language track ("ar"); null for math, science, social & arts. */
    val targetLang: String?,
    val history: List<AnswerEvent>,
    /** Validated unfinished session for this track, if any (not yet checked for "same day"). */
    val saved: SessionState?,
    val store: SessionStore,
    /** Evidence track without current consent: no session, no data (Trial_App_Spec §4). */
    val needsConsent: Boolean = false,
)

/** What the session needs from the data layer; an interface so the whole loop is unit-tested on the real engine. */
interface SessionDataSource {
    /** Null when there is no active profile or the track does not exist. */
    suspend fun setup(track: String): SessionSetup?

    /** The session ended: drop its snapshot so the next one starts fresh. */
    suspend fun finish(
        profileId: String,
        track: String,
    )
}

class DefaultSessionDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
    ) : SessionDataSource {
        override suspend fun setup(track: String): SessionSetup? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            val playable = SessionContent.playable(loaded.content)
            return SessionSetup(
                profile = profile,
                content = playable,
                rules = loaded.rules,
                targetLang = loaded.pack.meta.targetLang,
                history = answers.history(profile.id, track),
                saved = answers.resumable(profile.id, playable),
                store = answers.storeFor(profile.id),
                needsConsent = Consent.required(loaded.pack.meta.mode, profile),
            )
        }

        override suspend fun finish(
            profileId: String,
            track: String,
        ) = answers.clearSnapshot(profileId, track)
    }

sealed interface SessionUiState {
    data object Loading : SessionUiState

    data object Failed : SessionUiState

    /** Nothing new and nothing due today. Not an error, and never a guilt message. */
    data object NothingToday : SessionUiState

    /** The evidence track needs the learner's consent first. */
    data object NeedsConsent : SessionUiState

    data class Running(
        val step: StepUi,
        val phase: SessionState.Phase,
        val feedback: FeedbackView?,
        /** 1-based position of the current step and the planned number of steps (follow-ups may add more). */
        val position: Int,
        val total: Int,
        /** Scored answers so far (the interim count shown when leaving early). */
        val answered: Int = 0,
        val busy: Boolean = false,
        val saveError: Boolean = false,
        val draft: Boolean = false,
        val targetScale: Float = 1f,
        val targetRtl: Boolean = true,
    ) : SessionUiState

    data class Done(
        val summary: Session.Summary,
    ) : SessionUiState
}

sealed interface SessionEvent {
    data class Answer(
        val response: Response,
    ) : SessionEvent

    data object DontKnow : SessionEvent

    /** Leaves a lesson screen or the feedback panel. */
    data object Continue : SessionEvent
}

/**
 * One daily session for one track (Trial_App_Spec §4–6). The engine decides everything; this ViewModel only
 * loads, resumes, forwards answers to [SessionController] (which saves before the UI moves on) and maps the
 * engine state to [StepUi]. A failed save keeps the learner on the same item with a retry message.
 */
@HiltViewModel
class SessionViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: SessionDataSource,
        private val clock: Clock,
        private val rng: RngFactory,
        private val ids: IdGenerator,
        private val build: AppBuildInfo,
    ) : ViewModel() {
        /** Type-safe navigation stores route properties under their names (AyaRoute.Session.track). */
        private val track: String = savedStateHandle.get<String>("track").orEmpty()

        private val _state = MutableStateFlow<SessionUiState>(SessionUiState.Loading)
        val state: StateFlow<SessionUiState> = _state.asStateFlow()

        private var setup: SessionSetup? = null
        private var controller: SessionController? = null
        private var shownIndex = -1
        private var shownAtMs = 0L

        init {
            viewModelScope.launch { load() }
        }

        private suspend fun load() {
            val s =
                try {
                    data.setup(track)
                } catch (e: Exception) {
                    null
                }
            if (s == null) {
                _state.value = SessionUiState.Failed
                return
            }
            if (s.needsConsent) {
                _state.value = SessionUiState.NeedsConsent
                return
            }
            setup = s
            val now = clock.now().toEpochMilli()
            val today = Dates.localDate(now, clock.zone)
            val resumed = s.saved?.takeIf { SessionContent.canResume(it, s.profile.id, today) }
            val initial =
                resumed ?: Session.start(
                    StartArgs(
                        content = s.content,
                        rules = s.rules,
                        history = s.history,
                        learnerId = s.profile.id,
                        lang = s.profile.lang,
                        audience = s.profile.audience,
                        nowEpochMs = now,
                        zone = clock.zone,
                        budgetMinutes = SessionContent.budgetMinutes(s.profile.sessionMinutes, s.rules),
                        screensSeen = s.profile.screensSeen,
                        appVersion = build.appVersion,
                        random = rng.forSession(s.profile.id, s.history.map { it.sessionId }.distinct().size),
                        ids = ids,
                    ),
                )
            if (initial.phase == SessionState.Phase.DONE) {
                _state.value = SessionUiState.NothingToday
                return
            }
            if (resumed == null) {
                try {
                    s.store.saveSnapshot(initial)
                } catch (e: Exception) {
                    _state.value = SessionUiState.Failed
                    return
                }
            }
            controller = SessionController(s.store, s.content, s.rules, initial, s.history, s.profile.screensSeen, clock, ids)
            publish()
        }

        fun onEvent(event: SessionEvent) {
            when (event) {
                is SessionEvent.Answer -> submit(event.response)
                SessionEvent.DontKnow -> submit(Response.dontKnow())
                SessionEvent.Continue -> advance()
            }
        }

        private fun submit(response: Response) {
            val c = controller ?: return
            if (!markBusy()) return
            viewModelScope.launch {
                val result = c.submit(response, timeOnItemMs = clock.now().toEpochMilli() - shownAtMs)
                settle(result)
            }
        }

        private fun advance() {
            val c = controller ?: return
            if (!markBusy()) return
            viewModelScope.launch { settle(c.next()) }
        }

        /** Returns false (and does nothing) when a write is already in flight: one tap, one answer. */
        private fun markBusy(): Boolean {
            val running = _state.value as? SessionUiState.Running ?: return false
            if (running.busy) return false
            _state.value = running.copy(busy = true, saveError = false)
            return true
        }

        private suspend fun settle(result: SaveResult) {
            when (result) {
                SaveResult.SAVED -> publish()
                SaveResult.FAILED -> _state.update { (it as? SessionUiState.Running)?.copy(busy = false, saveError = true) ?: it }
                SaveResult.IGNORED -> _state.update { (it as? SessionUiState.Running)?.copy(busy = false) ?: it }
            }
        }

        private suspend fun publish() {
            val s = setup ?: return
            val c = controller ?: return
            val st = c.state
            if (st.phase == SessionState.Phase.DONE) {
                runCatching { data.finish(s.profile.id, track) }
                _state.value = SessionUiState.Done(Session.summarize(st, s.rules, clock.now().toEpochMilli()))
                return
            }
            val step = StepMapper.map(st, s.content, s.profile.lang, s.targetLang)
            if (step == null) {
                _state.value = SessionUiState.Failed
                return
            }
            if (st.index != shownIndex) {
                shownIndex = st.index
                shownAtMs = clock.now().toEpochMilli()
            }
            _state.value =
                SessionUiState.Running(
                    step = step,
                    phase = st.phase,
                    feedback = st.feedback,
                    position = st.index + 1,
                    total = st.queue.size,
                    answered = st.results.count { it.outcome != Outcome.NOT_ASSESSED },
                    draft = build.developerDemo && s.content.unreviewed,
                    targetScale = s.profile.arabicScale,
                    targetRtl = (s.targetLang ?: "") in RTL_LANGS,
                )
        }

        private companion object {
            val RTL_LANGS = setOf("ar", "fa", "ur", "he")
        }
    }
