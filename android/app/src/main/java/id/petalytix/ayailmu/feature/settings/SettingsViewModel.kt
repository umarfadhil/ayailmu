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
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.DataResetter
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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

    suspend fun withdrawConsent()

    suspend fun export(): List<Uri>

    suspend fun deleteProfile()

    suspend fun deleteAll()
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
    ) : SettingsDataSource {
        override fun observe(): Flow<SettingsData?> =
            combine(profiles.observeActive(), reminders.reminder) { profile, reminder ->
                profile ?: return@combine null
                val all = runCatching { content.tracks() }.getOrDefault(emptyList())
                val mine = all.filter { profile.lang in it.pack.meta.instructionLangs && profile.audience in it.pack.meta.audiences }
                val options = (mine.ifEmpty { all }).flatMap { it.rules.sessionMinutesOptions }.distinct().sorted()
                SettingsData(
                    profile = profile,
                    sessionOptions = options,
                    showArabicSize = mine.any { it.pack.meta.targetLang == "ar" },
                    reminder = reminder,
                    appVersion = build.appVersion,
                )
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
                )
            val stamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").withZone(clock.zone).format(now)
            return ExportFiles.write(context, bundle, stamp)
        }

        override suspend fun deleteProfile() {
            val me = requireAdult()
            val all = profiles.all()
            if (all.none { it.kind == ProfileKind.ADULT && it.id != me.id } && all.any { it.kind == ProfileKind.ANAK }) throw LastAdultException()
            profiles.delete(me.id)
            // Old export files may still hold this profile's answers.
            withContext(Dispatchers.IO) { ExportFiles.clear(context) }
            // Only adults may manage the reminder: with no adult left, it goes back to off.
            if (profiles.all().none { it.kind == ProfileKind.ADULT }) reminders.set(ReminderSetting())
        }

        override suspend fun deleteAll() {
            requireAdult()
            resetter.deleteAll()
        }
    }

data class SettingsUiState(
    val loading: Boolean = true,
    val data: SettingsData? = null,
    val busy: Boolean = false,
    val notice: SettingsNotice? = null,
)

enum class SettingsNotice { EXPORT_FAILED, ACTION_FAILED, NOTIFICATIONS_BLOCKED, LAST_ADULT }

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

    data object WithdrawConsent : SettingsEvent

    data object Export : SettingsEvent

    data object DeleteProfile : SettingsEvent

    data object DeleteAll : SettingsEvent

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

        private val shares = Channel<List<Uri>>(Channel.BUFFERED)

        /** One-shot share requests for the export files. */
        val shareRequests: Flow<List<Uri>> = shares.receiveAsFlow()

        init {
            viewModelScope.launch {
                data
                    .observe()
                    .catch { _state.update { s -> s.copy(loading = false, data = null) } }
                    .collect { d -> _state.update { it.copy(loading = false, data = d) } }
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
                SettingsEvent.WithdrawConsent -> launchAction { data.withdrawConsent() }
                SettingsEvent.Export -> launchAction(onError = SettingsNotice.EXPORT_FAILED) { shares.send(data.export()) }
                SettingsEvent.DeleteProfile -> launchAction { data.deleteProfile() }
                SettingsEvent.DeleteAll -> launchAction { data.deleteAll() }
                SettingsEvent.NoticeShown -> _state.update { it.copy(notice = null) }
            }
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
