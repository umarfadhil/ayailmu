package id.petalytix.ayailmu.core.data.settings

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.Serializer
import id.petalytix.ayailmu.core.content.ContentJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import java.io.InputStream
import java.io.OutputStream

/**
 * Device-level settings kept in a typed DataStore file (datastore/app_settings.json, included in Android
 * auto-backup, CR-DAT-6). Per-profile settings live on the profile row. The entitlement cache has its own
 * file in :core:billing (datastore/entitlements.json). New fields always have defaults, so older files decode.
 */
@Serializable
data class AppSettings(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    @SerialName("active_profile_id") val activeProfileId: String? = null,
    /** Added in P3b; files written before it decode with the default (reminder off). */
    val reminder: ReminderSetting = ReminderSetting(),
    /** P6: today's daily puzzle per profile id (only the latest day is kept). Practice only: no answer events. */
    @SerialName("daily_puzzles") val dailyPuzzles: Map<String, PuzzleMark> = emptyMap(),
    /** P5, developer demo build only: show the free tier (locks and store) instead of unlocking everything. */
    @SerialName("dev_free_tier") val devFreeTier: Boolean = false,
    /** P7: a valid closed-test tester code was entered on this device; every unit opens, in every build. */
    @SerialName("tester_unlock") val testerUnlock: Boolean = false,
    /** P7: "Nanti saja" on a trial survey card, per profile id: the card stays hidden on this date. */
    @SerialName("survey_snoozed") val surveySnoozed: Map<String, String> = emptyMap(),
    /**
     * Follow-up 11: «Efek suara» (INTERACTIONS_AUDIO.md §3.2). Device-level, on by default, any profile may change it.
     * Only the short effects: pronunciation clips play whenever the learner taps a speaker.
     */
    @SerialName("sound_effects") val soundEffects: Boolean = true,
    /**
     * Follow-up 12: per profile id, per module code (`Subject.code`: "BHS", "MAT", "NIL" …) the language and level the
     * profile picked on the module screen (MODULES_LEVELS_STORIES.md section 1). Files written before it decode empty.
     */
    @SerialName("module_choices") val moduleChoices: Map<String, Map<String, ModuleChoice>> = emptyMap(),
    /** Follow-up 12: per profile id, the picture avatar it picked (a `pic_*` animal key); missing = a default by id. */
    val avatars: Map<String, String> = emptyMap(),
)

/**
 * What a profile picked for one module. [language] is a Bahasa target language (`ar`, `en`, `ko`, `ja`, `zh`; null for
 * modules without languages) and [level] a `Level.code` ("P", "M", "H", "X"). Plain strings, so a value a later
 * version no longer knows is ignored by the app instead of making the whole settings file unreadable.
 */
@Serializable
data class ModuleChoice(
    val language: String? = null,
    val level: String? = null,
)

/** The daily puzzle a profile has answered, and how ("correct", "wrong", "dont_know"). */
@Serializable
data class PuzzleMark(
    val date: String,
    @SerialName("item_id") val itemId: String,
    val outcome: String,
)

/**
 * The one daily reminder (CR-HAB-5). Device-level, off by default, changed only from an Adult profile.
 * [lang] is the language the notification is written in (the adult's language when it was set).
 */
@Serializable
data class ReminderSetting(
    val enabled: Boolean = false,
    val hour: Int = 19,
    val minute: Int = 0,
    val lang: String = "id",
) {
    init {
        require(hour in 0..23 && minute in 0..59) { "reminder time out of range" }
    }
}

object AppSettingsSerializer : Serializer<AppSettings> {
    override val defaultValue: AppSettings = AppSettings()

    override suspend fun readFrom(input: InputStream): AppSettings =
        try {
            ContentJson.json.decodeFromString(AppSettings.serializer(), input.readBytes().decodeToString())
        } catch (e: SerializationException) {
            throw CorruptionException("Unreadable app settings", e)
        } catch (e: IllegalArgumentException) {
            throw CorruptionException("Unreadable app settings", e)
        }

    override suspend fun writeTo(
        t: AppSettings,
        output: OutputStream,
    ) {
        output.write(ContentJson.json.encodeToString(AppSettings.serializer(), t).encodeToByteArray())
    }
}

/** Which profile is active. An interface so repositories can be tested without a DataStore file. */
interface ActiveProfileStore {
    val activeId: Flow<String?>

    suspend fun setActive(id: String?)
}

class DataStoreActiveProfileStore(
    private val store: DataStore<AppSettings>,
) : ActiveProfileStore {
    override val activeId: Flow<String?> = store.data.map { it.activeProfileId }

    override suspend fun setActive(id: String?) {
        store.updateData { it.copy(activeProfileId = id) }
    }
}

/** The daily reminder setting. An interface so the scheduler and the settings screen are testable. */
interface ReminderStore {
    val reminder: Flow<ReminderSetting>

    suspend fun set(value: ReminderSetting)
}

class DataStoreReminderStore(
    private val store: DataStore<AppSettings>,
) : ReminderStore {
    override val reminder: Flow<ReminderSetting> = store.data.map { it.reminder }

    override suspend fun set(value: ReminderSetting) {
        store.updateData { it.copy(reminder = value) }
    }
}

class InMemoryReminderStore(initial: ReminderSetting = ReminderSetting()) : ReminderStore {
    private val state = MutableStateFlow(initial)
    override val reminder: Flow<ReminderSetting> = state.asStateFlow()

    override suspend fun set(value: ReminderSetting) {
        state.value = value
    }
}

/** In-memory version for tests and previews. */
class InMemoryActiveProfileStore(initial: String? = null) : ActiveProfileStore {
    private val state = MutableStateFlow(initial)
    override val activeId: Flow<String?> = state.asStateFlow()

    override suspend fun setActive(id: String?) {
        state.value = id
    }
}

/** Daily puzzle marks (P6). An interface so Home and the puzzle screen are tested without a DataStore file. */
interface DailyPuzzleStore {
    val marks: Flow<Map<String, PuzzleMark>>

    suspend fun mark(
        profileId: String,
        mark: PuzzleMark,
    )

    suspend fun forget(profileId: String)

    suspend fun clear()
}

class DataStoreDailyPuzzleStore(
    private val store: DataStore<AppSettings>,
) : DailyPuzzleStore {
    override val marks: Flow<Map<String, PuzzleMark>> = store.data.map { it.dailyPuzzles }

    override suspend fun mark(
        profileId: String,
        mark: PuzzleMark,
    ) {
        store.updateData { it.copy(dailyPuzzles = it.dailyPuzzles + (profileId to mark)) }
    }

    override suspend fun forget(profileId: String) {
        store.updateData { it.copy(dailyPuzzles = it.dailyPuzzles - profileId) }
    }

    override suspend fun clear() {
        store.updateData { it.copy(dailyPuzzles = emptyMap()) }
    }
}

class InMemoryDailyPuzzleStore : DailyPuzzleStore {
    private val state = MutableStateFlow<Map<String, PuzzleMark>>(emptyMap())
    override val marks: Flow<Map<String, PuzzleMark>> = state.asStateFlow()

    override suspend fun mark(
        profileId: String,
        mark: PuzzleMark,
    ) {
        state.value = state.value + (profileId to mark)
    }

    override suspend fun forget(profileId: String) {
        state.value = state.value - profileId
    }

    override suspend fun clear() {
        state.value = emptyMap()
    }
}

/** Developer-demo switches (never read by the prod flavor). */
interface DevOptionsStore {
    val freeTier: Flow<Boolean>

    suspend fun setFreeTier(on: Boolean)
}

class DataStoreDevOptionsStore(
    private val store: DataStore<AppSettings>,
) : DevOptionsStore {
    override val freeTier: Flow<Boolean> = store.data.map { it.devFreeTier }

    override suspend fun setFreeTier(on: Boolean) {
        store.updateData { it.copy(devFreeTier = on) }
    }
}

class InMemoryDevOptionsStore(
    initial: Boolean = false,
) : DevOptionsStore {
    private val state = MutableStateFlow(initial)
    override val freeTier: Flow<Boolean> = state.asStateFlow()

    override suspend fun setFreeTier(on: Boolean) {
        state.value = on
    }
}

/** P7 trial switches kept on the device: tester access and survey snoozes. */
interface TrialStore {
    val testerUnlock: Flow<Boolean>
    val surveySnoozed: Flow<Map<String, String>>

    suspend fun setTesterUnlock(on: Boolean)

    suspend fun snoozeSurvey(
        profileId: String,
        date: String,
    )

    /** A deleted profile: drop its snooze. */
    suspend fun forget(profileId: String)

    /** «Hapus semua data»: tester access off and every snooze gone, as on a fresh install. */
    suspend fun clear()
}

class DataStoreTrialStore(
    private val store: DataStore<AppSettings>,
) : TrialStore {
    override val testerUnlock: Flow<Boolean> = store.data.map { it.testerUnlock }
    override val surveySnoozed: Flow<Map<String, String>> = store.data.map { it.surveySnoozed }

    override suspend fun setTesterUnlock(on: Boolean) {
        store.updateData { it.copy(testerUnlock = on) }
    }

    override suspend fun snoozeSurvey(
        profileId: String,
        date: String,
    ) {
        store.updateData { it.copy(surveySnoozed = it.surveySnoozed + (profileId to date)) }
    }

    override suspend fun forget(profileId: String) {
        store.updateData { it.copy(surveySnoozed = it.surveySnoozed - profileId) }
    }

    override suspend fun clear() {
        store.updateData { it.copy(testerUnlock = false, surveySnoozed = emptyMap()) }
    }
}

class InMemoryTrialStore(
    tester: Boolean = false,
) : TrialStore {
    private val unlock = MutableStateFlow(tester)
    private val snoozed = MutableStateFlow<Map<String, String>>(emptyMap())
    override val testerUnlock: Flow<Boolean> = unlock.asStateFlow()
    override val surveySnoozed: Flow<Map<String, String>> = snoozed.asStateFlow()

    override suspend fun setTesterUnlock(on: Boolean) {
        unlock.value = on
    }

    override suspend fun snoozeSurvey(
        profileId: String,
        date: String,
    ) {
        snoozed.value = snoozed.value + (profileId to date)
    }

    override suspend fun forget(profileId: String) {
        snoozed.value = snoozed.value - profileId
    }

    override suspend fun clear() {
        unlock.value = false
        snoozed.value = emptyMap()
    }
}

/** «Efek suara» on this phone (follow-up 11). An interface so the settings screen and the app root are testable. */
interface SoundSettingsStore {
    val soundEffects: Flow<Boolean>

    suspend fun setSoundEffects(on: Boolean)
}

class DataStoreSoundSettingsStore(
    private val store: DataStore<AppSettings>,
) : SoundSettingsStore {
    override val soundEffects: Flow<Boolean> = store.data.map { it.soundEffects }

    override suspend fun setSoundEffects(on: Boolean) {
        store.updateData { it.copy(soundEffects = on) }
    }
}

class InMemorySoundSettingsStore(
    initial: Boolean = true,
) : SoundSettingsStore {
    private val state = MutableStateFlow(initial)
    override val soundEffects: Flow<Boolean> = state.asStateFlow()

    override suspend fun setSoundEffects(on: Boolean) {
        state.value = on
    }
}

/**
 * Follow-up 12: each profile's module choices (language and level per module) and its picture avatar. An interface
 * so Home, the module screen and Settings are tested without a DataStore file.
 */
interface ProfileChoiceStore {
    /** Profile id → module code → choice. */
    val choices: Flow<Map<String, Map<String, ModuleChoice>>>

    /** Profile id → avatar key. */
    val avatars: Flow<Map<String, String>>

    suspend fun choose(
        profileId: String,
        module: String,
        choice: ModuleChoice,
    )

    suspend fun setAvatar(
        profileId: String,
        avatar: String,
    )

    /** A deleted profile: drop its choices and its avatar. */
    suspend fun forget(profileId: String)

    /** «Hapus semua data»: every choice and avatar gone, as on a fresh install. */
    suspend fun clear()
}

class DataStoreProfileChoiceStore(
    private val store: DataStore<AppSettings>,
) : ProfileChoiceStore {
    override val choices: Flow<Map<String, Map<String, ModuleChoice>>> = store.data.map { it.moduleChoices }
    override val avatars: Flow<Map<String, String>> = store.data.map { it.avatars }

    override suspend fun choose(
        profileId: String,
        module: String,
        choice: ModuleChoice,
    ) {
        store.updateData { it.copy(moduleChoices = ProfileChoices.put(it.moduleChoices, profileId, module, choice)) }
    }

    override suspend fun setAvatar(
        profileId: String,
        avatar: String,
    ) {
        store.updateData { it.copy(avatars = it.avatars + (profileId to avatar)) }
    }

    override suspend fun forget(profileId: String) {
        store.updateData { it.copy(moduleChoices = it.moduleChoices - profileId, avatars = it.avatars - profileId) }
    }

    override suspend fun clear() {
        store.updateData { it.copy(moduleChoices = emptyMap(), avatars = emptyMap()) }
    }
}

class InMemoryProfileChoiceStore : ProfileChoiceStore {
    private val choiceState = MutableStateFlow<Map<String, Map<String, ModuleChoice>>>(emptyMap())
    private val avatarState = MutableStateFlow<Map<String, String>>(emptyMap())
    override val choices: Flow<Map<String, Map<String, ModuleChoice>>> = choiceState.asStateFlow()
    override val avatars: Flow<Map<String, String>> = avatarState.asStateFlow()

    override suspend fun choose(
        profileId: String,
        module: String,
        choice: ModuleChoice,
    ) {
        choiceState.value = ProfileChoices.put(choiceState.value, profileId, module, choice)
    }

    override suspend fun setAvatar(
        profileId: String,
        avatar: String,
    ) {
        avatarState.value = avatarState.value + (profileId to avatar)
    }

    override suspend fun forget(profileId: String) {
        choiceState.value = choiceState.value - profileId
        avatarState.value = avatarState.value - profileId
    }

    override suspend fun clear() {
        choiceState.value = emptyMap()
        avatarState.value = emptyMap()
    }
}

/** One profile's choice for one module replaced; the other modules and profiles are kept. */
internal object ProfileChoices {
    fun put(
        all: Map<String, Map<String, ModuleChoice>>,
        profileId: String,
        module: String,
        choice: ModuleChoice,
    ): Map<String, Map<String, ModuleChoice>> = all + (profileId to (all[profileId].orEmpty() + (module to choice)))
}
