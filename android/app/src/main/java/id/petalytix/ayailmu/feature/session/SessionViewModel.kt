package id.petalytix.ayailmu.feature.session

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
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
import id.petalytix.ayailmu.feature.session.story.StorySeen
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.AccessSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Everything a session needs, loaded once when the screen opens. */
data class SessionSetup(
    val profile: Profile,
    /** Gated content already reduced to renderable items in unlocked units ([SessionContent.playable]). */
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

    /** «Laporkan soal» (Trial_App_Spec §7): stored on the phone with the item's content version, exported. */
    suspend fun report(
        profileId: String,
        itemId: String,
        contentVersion: String,
        reason: String,
        text: String,
    ) {}
}

class DefaultSessionDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val access: AccessSource,
    ) : SessionDataSource {
        override suspend fun setup(track: String): SessionSetup? {
            val profile = profiles.activeProfile() ?: return null
            val loaded = content.track(track) ?: return null
            // Only units this learner has unlocked (free units, or the pack / all-access), CR-BIL-2.
            val trackAccess = AccessPolicy.forTrack(loaded, access.current())
            val playable = SessionContent.playable(loaded.content, trackAccess::allows)
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

        override suspend fun report(
            profileId: String,
            itemId: String,
            contentVersion: String,
            reason: String,
            text: String,
        ) {
            answers.addReport(profileId, itemId, contentVersion, reason, text)
        }
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
        /** Arabic course: example sentences are made up for practice; the screen says so (Trial_App_Spec §3). */
        val syntheticArabic: Boolean = false,
        /** Child profile: the report dialog offers reasons only, no free text. */
        val childProfile: Boolean = false,
        /** The question on screen was reported (saved); if it was not answered yet, its answer carries report_flag. */
        val reported: Boolean = false,
        /** A report is being saved. */
        val reporting: Boolean = false,
        val reportFailed: Boolean = false,
        /** Target language of a language track ("ko", "ja", "zh", "en", "ar"); null for other subjects. Drives fonts and voice. */
        val targetLang: String? = null,
        /** The story on screen was seen before (an answer event exists): «Lewati cerita» is offered to children too. */
        val storySeenBefore: Boolean = false,
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

    /** «Laporkan soal» for the question on screen: one of [Reports.REASONS], optional text (adults only). */
    data class Report(
        val reason: String,
        val text: String = "",
    ) : SessionEvent
}

/** Report reasons (stable ids, exported) and the free-text limit. */
object Reports {
    val REASONS = listOf("typo", "wrong_answer", "confusing", "picture", "other")
    const val MAX_TEXT = 300

    /** What is stored: a known reason, and text only for adults, trimmed to [MAX_TEXT]. */
    fun clean(
        reason: String,
        text: String,
        child: Boolean,
    ): Pair<String, String>? {
        if (reason !in REASONS) return null
        return reason to if (child) "" else text.trim().take(MAX_TEXT)
    }
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

        /** Items reported (and saved) in this session: the row says thank you instead of offering the button. */
        private val reportedItems = mutableSetOf<String>()

        /**
         * Reported before they were answered: the answer, once saved, carries report_flag (the export can then
         * exclude it), and the item leaves this set. A report made after answering flags nothing.
         */
        private val flagNextAnswer = mutableSetOf<String>()

        init {
            viewModelScope.launch { guard { load() } }
        }

        /**
         * Any failure while loading or mapping a step lands on the "Failed" screen instead of closing the app.
         * [LinkageError] is caught too: a class that failed to initialise (the Android-only regex crash, CR-KT-9)
         * surfaces as ExceptionInInitializerError / NoClassDefFoundError, which `catch (e: Exception)` misses.
         */
        private inline fun guard(block: () -> Unit) {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = SessionUiState.Failed
            } catch (e: LinkageError) {
                _state.value = SessionUiState.Failed
            }
        }

        private suspend fun load() {
            val s = data.setup(track)
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
                is SessionEvent.Report -> report(event.reason, event.text)
            }
        }

        private fun report(
            reason: String,
            text: String,
        ) {
            val s = setup ?: return
            val running = _state.value as? SessionUiState.Running ?: return
            val q = running.step as? StepUi.Question ?: return
            val item = s.content.itemOrNull(q.itemId) ?: return
            val (r, t) = Reports.clean(reason, text, running.childProfile) ?: return
            if (running.reporting || running.reported) return
            _state.value = running.copy(reporting = true, reportFailed = false)
            viewModelScope.launch {
                try {
                    data.report(s.profile.id, q.itemId, item.contentVersion, r, t)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.update { (it as? SessionUiState.Running)?.copy(reporting = false, reportFailed = true) ?: it }
                    return@launch
                }
                // Flag the answer only when it is still to come: not shown with feedback, and not being saved now.
                val now = _state.value as? SessionUiState.Running
                val sameQuestion = now != null && (now.step as? StepUi.Question)?.itemId == q.itemId
                if (sameQuestion && now?.feedback == null && now?.busy == false) flagNextAnswer += q.itemId
                reportedItems += q.itemId
                _state.update { st ->
                    val run = st as? SessionUiState.Running ?: return@update st
                    run.copy(reporting = false, reported = run.reported || sameQuestion)
                }
            }
        }

        private fun submit(response: Response) {
            val c = controller ?: return
            val itemId = ((_state.value as? SessionUiState.Running)?.step as? StepUi.Question)?.itemId
            val flagged = itemId != null && itemId in flagNextAnswer
            if (!markBusy()) return
            viewModelScope.launch {
                val result = c.submit(response, timeOnItemMs = clock.now().toEpochMilli() - shownAtMs, reportFlag = flagged)
                // One report flags one answer: a later meeting with the same item in this session is not flagged.
                if (flagged && result == SaveResult.SAVED) flagNextAnswer -= itemId.orEmpty()
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
                SaveResult.SAVED -> guard { publish() }
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
                    syntheticArabic = s.targetLang == "ar",
                    childProfile = s.profile.kind == ProfileKind.ANAK,
                    reported = (step as? StepUi.Question)?.itemId?.let { it in reportedItems } == true,
                    targetLang = s.targetLang,
                    storySeenBefore = storySeenBefore(step, s),
                )
        }

        /** A story the learner has seen before may be skipped, by children too (SessionScreen's story bar). */
        private fun storySeenBefore(
            step: StepUi,
            s: SessionSetup,
        ): Boolean {
            val q = step as? StepUi.Question ?: return false
            return q.kind == RenderKind.STORY && StorySeen.before(q.itemId, s.history)
        }

        private companion object {
            val RTL_LANGS = setOf("ar", "fa", "ur", "he")
        }
    }
