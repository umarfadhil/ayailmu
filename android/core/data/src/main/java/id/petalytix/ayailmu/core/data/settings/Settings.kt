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
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import java.io.InputStream
import java.io.OutputStream

/**
 * Device-level settings kept in a typed DataStore file (datastore/app_settings.json, included in Android
 * auto-backup, CR-DAT-6). Per-profile settings live on the profile row. The entitlement cache joins in P5.
 */
@Serializable
data class AppSettings(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    @SerialName("active_profile_id") val activeProfileId: String? = null,
    /** Added in P3b; files written before it decode with the default (reminder off). */
    val reminder: ReminderSetting = ReminderSetting(),
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
