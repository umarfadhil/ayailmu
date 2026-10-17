package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.settings.AppSettings
import id.petalytix.ayailmu.core.data.settings.AppSettingsSerializer
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The settings file must survive app updates: files written before a field existed still decode. */
class SettingsSerializerTest {
    private suspend fun read(json: String) = AppSettingsSerializer.readFrom(ByteArrayInputStream(json.encodeToByteArray()))

    @Test
    fun `a P2 settings file without the reminder decodes with the reminder off`() =
        runTest {
            val s = read("""{"schema_version":1,"active_profile_id":"lrn-1"}""")
            assertEquals("lrn-1", s.activeProfileId)
            assertEquals(ReminderSetting(), s.reminder)
            assertEquals(false, s.reminder.enabled)
        }

    @Test
    fun `settings round-trip`() =
        runTest {
            val original = AppSettings(activeProfileId = "lrn-2", reminder = ReminderSetting(enabled = true, hour = 6, minute = 45, lang = "en"))
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(original, out)
            assertEquals(original, read(out.toByteArray().decodeToString()))
        }

    @Test
    fun `an impossible reminder time is rejected`() {
        assertFailsWith<IllegalArgumentException> { ReminderSetting(hour = 24) }
    }
}
