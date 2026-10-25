package id.petalytix.ayailmu.feature.settings

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.export.ExportBuilder
import id.petalytix.ayailmu.core.data.export.ExportFiles
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.AppConfigRepository
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.DataResetter
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.repo.SurveyRepository
import id.petalytix.ayailmu.core.data.settings.DailyPuzzleStore
import id.petalytix.ayailmu.core.data.settings.ProfileChoiceStore
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import id.petalytix.ayailmu.core.data.settings.SoundSettingsStore
import id.petalytix.ayailmu.core.data.settings.TrialStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.home.Avatars
import id.petalytix.ayailmu.feature.home.SurveyCard
import id.petalytix.ayailmu.feature.trial.SurveyKind
import id.petalytix.ayailmu.feature.trial.SurveyRules
import id.petalytix.ayailmu.feature.trial.TesterCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject

/** Everything the settings screen shows for the active profile. */
data class SettingsData(
    val profile: Profile,
    /** Session lengths the profile's tracks allow (CR-HAB-1); "automatic" = each track's default. */
    val sessionOptions: List<Int>,
    /** Only shown when a track with Arabic is on this profile's shelf. */
    val showArabicSize: Boolean,
    val reminder: ReminderSetting,
    val appVersion: String,
    /** P7: a closed-test tester code was entered on this phone (every unit open). */
    val testerUnlock: Boolean = false,
    /** P7: the trial survey this profile can fill in now (ignores "Nanti saja" on Home). */
    val survey: SurveyCard? = null,
    /** Child profiles on this phone; an adult can delete one (with all its answers) without "delete all". */
    val children: List<Profile> = emptyList(),
    /** «Efek suara» (follow-up 11): device-level, any profile may switch it. */
    val soundEffects: Boolean = true,
    /** Follow-up 12: this profile's picture (a `pic_*` animal); any profile may change its own. */
    val avatar: String = Avatars.defaultFor(profile.id),
) {
    /** Reminder, export and deleting are adult-only: a child profile can see them but not change them (CR-HAB-5). */
    val isAdult: Boolean get() = profile.kind == ProfileKind.ADULT
}

/** Deleting the only adult would leave child profiles with nobody who can manage them (CR-DAT-5). */
class LastAdultException : IllegalStateException("the last adult profile cannot be deleted while child profiles exist")

interface SettingsDataSource {
    fun observe(): Flow<SettingsData?>

    suspend fun setLanguage(lang: Lang)

    suspend fun setSessionMinutes(minutes: Int?)

    suspend fun setArabicScale(scale: Float)

    suspend fun setReminder(value: ReminderSetting)

    /** «Efek suara» on or off for this phone; allowed from any profile (it changes nothing about learning data). */
    suspend fun setSoundEffects(on: Boolean)

    suspend fun withdrawConsent()

    suspend fun export(): List<Uri>

    suspend fun deleteProfile()

    suspend fun deleteAll()

    /** True when [code] is a valid tester code (its SHA-256 is in `trial.tester_code_hashes`); adults only. */
    suspend fun enterTesterCode(code: String): Boolean = false

    suspend fun removeTester() {}

    /** Deletes one child (Anak) profile and everything stored for it; adults only. */
    suspend fun deleteChild(id: String) {}

    /** The active profile's picture (one of [Avatars.KEYS]); any profile may pick its own. */
    suspend fun setAvatar(key: String) {}
}

class DefaultSettingsDataSource
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val reminders: ReminderStore,
        private val resetter: DataResetter,
        private val build: AppBuildInfo,
        private val clock: Clock,
        private val puzzles: DailyPuzzleStore,
        private val config: AppConfigRepository,
        private val surveys: SurveyRepository,
        private val challenges: ChallengeRepository,
        private val trialStore: TrialStore,
        private val sound: SoundSettingsStore,
        private val choices: ProfileChoiceStore,
    ) : SettingsDataSource {
        // The profile's saved surveys are observed too, so the survey entry goes away once it is filled in.
        @OptIn(ExperimentalCoroutinesApi::class)
        override fun observe(): Flow<SettingsData?> =
            combine(
                profiles.observeActive(),
                combine(reminders.reminder, sound.soundEffects, choices.avatars) { r, on, avatars -> Device(r, on, avatars) },
                trialStore.testerUnlock,
                profiles.observeActive().flatMapLatest { p -> if (p == null) flowOf(emptyList()) else surveys.observe(p.id) },
                profiles.observeProfiles(),
            ) { profile, device, tester, _, everyone ->
                profile ?: return@combine null
                val all = runCatching { content.tracks() }.getOrDefault(emptyList())
                val mine = all.filter { profile.lang in it.pack.meta.instructionLangs && profile.audience in it.pack.meta.audiences }
                val options = (mine.ifEmpty { all }).flatMap { it.rules.sessionMinutesOptions }.distinct().sorted()
                SettingsData(
                    profile = profile,
                    sessionOptions = options,
                    showArabicSize = mine.any { it.pack.meta.targetLang == "ar" },
                    reminder = device.reminder,
                    appVersion = build.appVersion,
                    testerUnlock = testerActive(tester),
                    survey = runCatching { survey(profile) }.getOrNull(),
                    children = everyone.filter { it.kind == ProfileKind.ANAK },
                    soundEffects = device.soundEffects,
                    avatar = Avatars.of(profile.id, device.avatars[profile.id]),
                )
            }

        /** The device-level settings the screen shows next to the profile's own. */
        private class Device(
            val reminder: ReminderSetting,
            val soundEffects: Boolean,
            val avatars: Map<String, String>,
        )

        private suspend fun survey(profile: Profile): SurveyCard? {
            val trial = config.trial()
            val done = surveys.forProfile(profile.id).filter { it.track == trial.track }.mapNotNull { SurveyKind.of(it.kind) }.toSet()
            val kind = SurveyRules.forProfile(profile, trial, answers.history(profile.id, trial.track), done, today()) ?: return null
            return SurveyCard(trial.track, kind)
        }

        private suspend fun active(): Profile = checkNotNull(profiles.activeProfile()) { "no active profile" }

        private suspend fun requireAdult(): Profile = active().also { require(it.kind == ProfileKind.ADULT) { "adult profile required" } }

        override suspend fun setLanguage(lang: Lang) {
            val p = active()
            profiles.setLanguage(p.id, lang)
            // The reminder speaks the language of the adult who set it.
            if (p.kind == ProfileKind.ADULT) {
                val r = reminders.reminder.first()
                if (r.enabled) reminders.set(r.copy(lang = lang.tag))
            }
        }

        override suspend fun setSessionMinutes(minutes: Int?) = profiles.setSessionMinutes(active().id, minutes)

        override suspend fun setArabicScale(scale: Float) = profiles.setArabicScale(active().id, scale)

        override suspend fun setReminder(value: ReminderSetting) {
            val p = requireAdult()
            reminders.set(value.copy(lang = p.lang.tag))
        }

        override suspend fun setSoundEffects(on: Boolean) = sound.setSoundEffects(on)

        override suspend fun withdrawConsent() = profiles.withdrawConsent(active().id)

        override suspend fun export(): List<Uri> {
            requireAdult()
            val now = clock.now()
            val bundle =
                ExportBuilder.build(
                    profiles = profiles.all(),
                    events = answers.allEvents(),
                    reports = answers.allReports(),
                    exportedAt = now.toString(),
                    appVersion = build.appVersion,
                    surveys = surveys.all(),
                    challenges = challenges.all(),
                )
            val stamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").withZone(clock.zone).format(now)
            return ExportFiles.write(context, bundle, stamp)
        }

        override suspend fun deleteProfile() {
            val me = requireAdult()
            val all = profiles.all()
            if (all.none { it.kind == ProfileKind.ADULT && it.id != me.id } && all.any { it.kind == ProfileKind.ANAK }) throw LastAdultException()
            profiles.delete(me.id)
            puzzles.forget(me.id)
            trialStore.forget(me.id)
            choices.forget(me.id)
            // Old export files may still hold this profile's answers.
            withContext(Dispatchers.IO) { ExportFiles.clear(context) }
            // Only adults may manage the reminder: with no adult left, it goes back to off.
            if (profiles.all().none { it.kind == ProfileKind.ADULT }) reminders.set(ReminderSetting())
        }

        override suspend fun deleteAll() {
            requireAdult()
            resetter.deleteAll()
        }

        override suspend fun enterTesterCode(code: String): Boolean {
            requireAdult()
            val trial = config.trial()
            if (!trial.testerOpen(today()) || !TesterCode.matches(code, trial.testerCodeHashes)) return false
            trialStore.setTesterUnlock(true)
            return true
        }

        private fun today(): LocalDate = LocalDate.parse(Dates.localDate(clock.now().toEpochMilli(), clock.zone))

        /** The stored switch, shown as on only while this build still honours tester codes. */
        private suspend fun testerActive(stored: Boolean): Boolean = stored && runCatching { config.trial().testerOpen(today()) }.getOrDefault(false)

        override suspend fun removeTester() {
            requireAdult()
            trialStore.setTesterUnlock(false)
        }

        override suspend fun deleteChild(id: String) {
            requireAdult()
            val child = profiles.all().firstOrNull { it.id == id }
            require(child != null && child.kind == ProfileKind.ANAK) { "only a child profile can be deleted here" }
            profiles.delete(id)
            puzzles.forget(id)
            trialStore.forget(id)
            choices.forget(id)
            // Old export files may still hold this child's answers.
            withContext(Dispatchers.IO) { ExportFiles.clear(context) }
        }

        override suspend fun setAvatar(key: String) {
            require(key in Avatars.KEYS) { "unknown avatar" }
            choices.setAvatar(active().id, key)
        }
    }

data class SettingsUiState(
    val loading: Boolean = true,
    val data: SettingsData? = null,
    val busy: Boolean = false,
    val notice: SettingsNotice? = null,
)

enum class SettingsNotice { EXPORT_FAILED, ACTION_FAILED, NOTIFICATIONS_BLOCKED, LAST_ADULT, TESTER_ON, TESTER_WRONG, TESTER_OFF }

class ShareRequest
    internal constructor(
        val uris: List<Uri>,
        internal val profileId: String,
        internal val generation: Long,
    )

sealed interface SettingsEvent {
    data class Language(
        val lang: Lang,
    ) : SettingsEvent

    data class SessionMinutes(
        val minutes: Int?,
    ) : SettingsEvent

    data class ArabicScale(
        val scale: Float,
    ) : SettingsEvent

    /** [permitted] is false when Android refused the notification permission (13+). */
    data class ReminderEnabled(
        val enabled: Boolean,
        val permitted: Boolean = true,
    ) : SettingsEvent

    data class ReminderTime(
        val hour: Int,
        val minute: Int,
    ) : SettingsEvent

    /** «Efek suara» switched (follow-up 11). */
    data class SoundEffects(
        val on: Boolean,
    ) : SettingsEvent

    data object WithdrawConsent : SettingsEvent

    data object Export : SettingsEvent

    data object DeleteProfile : SettingsEvent

    data object DeleteAll : SettingsEvent

    data class DeleteChild(
        val id: String,
    ) : SettingsEvent

    /** P7 closed test: a tester code from Petalytix opens every unit on this phone. */
    data class EnterTesterCode(
        val code: String,
    ) : SettingsEvent

    data object RemoveTester : SettingsEvent

    /** Follow-up 12: the profile picked another picture. */
    data class Avatar(
        val key: String,
    ) : SettingsEvent

    data object NoticeShown : SettingsEvent
}

@HiltViewModel
class SettingsViewModel
    @Inject
    constructor(
        private val data: SettingsDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow(SettingsUiState())
        val state: StateFlow<SettingsUiState> = _state.asStateFlow()

        private val shares = Channel<ShareRequest>(Channel.BUFFERED)
        private var ownerGeneration = 0L
        private var exportOwner: ExportOwner? = null

        private data class ExportOwner(val profileId: String, val generation: Long)

        /** One-shot share requests for the export files. */
        val shareRequests: Flow<ShareRequest> = shares.receiveAsFlow()

        init {
            viewModelScope.launch {
                data
                    .observe()
                    .catch {
                        ownerGeneration++
                        exportOwner = null
                        _state.update { s -> s.copy(loading = false, data = null) }
                    }
                    .collect { d ->
                        val profileId = d?.takeIf { it.isAdult }?.profile?.id
                        if (profileId != exportOwner?.profileId) {
                            ownerGeneration++
                            exportOwner = profileId?.let { ExportOwner(it, ownerGeneration) }
                        }
                        _state.update { it.copy(loading = false, data = d) }
                    }
            }
        }

        fun onEvent(event: SettingsEvent) {
            val reminder = _state.value.data?.reminder ?: ReminderSetting()
            when (event) {
                is SettingsEvent.Language -> launchAction { data.setLanguage(event.lang) }
                is SettingsEvent.SessionMinutes -> launchAction { data.setSessionMinutes(event.minutes) }
                is SettingsEvent.ArabicScale -> launchAction { data.setArabicScale(event.scale) }
                is SettingsEvent.ReminderEnabled ->
                    if (event.enabled && !event.permitted) {
                        _state.update { it.copy(notice = SettingsNotice.NOTIFICATIONS_BLOCKED) }
                    } else {
                        launchAction { data.setReminder(reminder.copy(enabled = event.enabled)) }
                    }
                is SettingsEvent.ReminderTime -> launchAction { data.setReminder(reminder.copy(hour = event.hour, minute = event.minute)) }
                is SettingsEvent.SoundEffects -> launchAction { data.setSoundEffects(event.on) }
                SettingsEvent.WithdrawConsent -> launchAction { data.withdrawConsent() }
                SettingsEvent.Export -> {
                    val owner = exportOwner
                    launchAction(onError = SettingsNotice.EXPORT_FAILED) {
                        checkNotNull(owner) { "no active profile" }
                        val uris = data.export()
                        if (owner == exportOwner) shares.send(ShareRequest(uris, owner.profileId, owner.generation))
                    }
                }
                SettingsEvent.DeleteProfile -> launchAction { data.deleteProfile() }
                SettingsEvent.DeleteAll -> launchAction { data.deleteAll() }
                is SettingsEvent.DeleteChild -> launchAction { data.deleteChild(event.id) }
                is SettingsEvent.Avatar -> launchAction { data.setAvatar(event.key) }
                is SettingsEvent.EnterTesterCode ->
                    launchAction {
                        val ok = data.enterTesterCode(event.code)
                        _state.update { it.copy(notice = if (ok) SettingsNotice.TESTER_ON else SettingsNotice.TESTER_WRONG) }
                    }
                SettingsEvent.RemoveTester ->
                    launchAction {
                        data.removeTester()
                        _state.update { it.copy(notice = SettingsNotice.TESTER_OFF) }
                    }
                SettingsEvent.NoticeShown -> _state.update { it.copy(notice = null) }
            }
        }

        /** Re-check at consumption: a request may have waited in the channel across profile switches. */
        fun validShareUris(request: ShareRequest): List<Uri>? =
            request.uris.takeIf { request.profileId == exportOwner?.profileId && request.generation == exportOwner?.generation }

        fun onShareFailed() {
            _state.update { it.copy(notice = SettingsNotice.EXPORT_FAILED) }
        }

        private fun launchAction(
            onError: SettingsNotice = SettingsNotice.ACTION_FAILED,
            block: suspend () -> Unit,
        ) {
            if (_state.value.busy) return
            _state.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    block()
                } catch (e: LastAdultException) {
                    _state.update { it.copy(notice = SettingsNotice.LAST_ADULT) }
                } catch (e: Exception) {
                    _state.update { it.copy(notice = onError) }
                } finally {
                    _state.update { it.copy(busy = false) }
                }
            }
        }
    }
