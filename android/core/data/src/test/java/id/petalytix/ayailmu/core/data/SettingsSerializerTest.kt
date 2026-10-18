package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.settings.AppSettings
import id.petalytix.ayailmu.core.data.settings.AppSettingsSerializer
import id.petalytix.ayailmu.core.data.settings.InMemoryDailyPuzzleStore
import id.petalytix.ayailmu.core.data.settings.InMemoryProfileChoiceStore
import id.petalytix.ayailmu.core.data.settings.InMemorySoundSettingsStore
import id.petalytix.ayailmu.core.data.settings.InMemoryTrialStore
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.data.settings.PuzzleMark
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import kotlinx.coroutines.flow.first
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
    fun `a P3b settings file decodes with no puzzle marks and the demo free tier off`() =
        runTest {
            val s = read("""{"schema_version":1,"active_profile_id":"lrn-1","reminder":{"enabled":true,"hour":7,"minute":0,"lang":"id"}}""")
            assertEquals(emptyMap(), s.dailyPuzzles)
            assertEquals(false, s.devFreeTier)
            assertEquals(7, s.reminder.hour)
        }

    @Test
    fun `puzzle marks and the demo switch round-trip`() =
        runTest {
            val original =
                AppSettings(
                    activeProfileId = "lrn-2",
                    dailyPuzzles = mapOf("lrn-2" to PuzzleMark(date = "2026-10-17", itemId = "MAT-K-P-DP-01", outcome = "correct")),
                    devFreeTier = true,
                )
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(original, out)
            val text = out.toByteArray().decodeToString()
            assertEquals(original, read(text))
            // Only the day, the item and an outcome word are kept: nothing the learner typed.
            assertEquals(true, text.contains("\"item_id\":\"MAT-K-P-DP-01\""))
        }

    @Test
    fun `puzzle stores keep one mark per profile and forget on request`() =
        runTest {
            val store = InMemoryDailyPuzzleStore()
            store.mark("a", PuzzleMark("2026-10-16", "X", "wrong"))
            store.mark("a", PuzzleMark("2026-10-17", "Y", "correct"))
            store.mark("b", PuzzleMark("2026-10-17", "Y", "dont_know"))
            assertEquals("Y", store.marks.first().getValue("a").itemId)
            store.forget("a")
            assertEquals(setOf("b"), store.marks.first().keys)
            store.clear()
            assertEquals(emptyMap(), store.marks.first())
        }

    @Test
    fun `a P6 settings file decodes with no tester access and no snoozed survey`() =
        runTest {
            val s = read("""{"schema_version":1,"active_profile_id":"lrn-1","dev_free_tier":true}""")
            assertEquals(false, s.testerUnlock)
            assertEquals(emptyMap(), s.surveySnoozed)
        }

    @Test
    fun `tester access and survey snoozes round-trip and the trial store updates them`() =
        runTest {
            val original = AppSettings(activeProfileId = "lrn-3", testerUnlock = true, surveySnoozed = mapOf("lrn-3" to "2026-10-17"))
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(original, out)
            val text = out.toByteArray().decodeToString()
            assertEquals(original, read(text))
            assertEquals(true, text.contains("\"tester_unlock\":true"))
            val store = InMemoryTrialStore()
            store.setTesterUnlock(true)
            store.snoozeSurvey("a", "2026-10-17")
            store.snoozeSurvey("a", "2026-10-18")
            assertEquals(true, store.testerUnlock.first())
            assertEquals(mapOf("a" to "2026-10-18"), store.surveySnoozed.first())
            store.snoozeSurvey("b", "2026-10-18")
            store.forget("a")
            assertEquals(mapOf("b" to "2026-10-18"), store.surveySnoozed.first())
            store.clear()
            assertEquals(false, store.testerUnlock.first())
            assertEquals(emptyMap(), store.surveySnoozed.first())
        }

    @Test
    fun `a settings file from before follow-up 11 decodes with sound effects on`() =
        runTest {
            val s = read("""{"schema_version":1,"active_profile_id":"lrn-1","tester_unlock":true,"survey_snoozed":{"a":"2026-10-17"}}""")
            assertEquals(true, s.soundEffects)
            assertEquals(true, s.testerUnlock)
        }

    @Test
    fun `sound effects off round-trips and the sound store switches it`() =
        runTest {
            val original = AppSettings(activeProfileId = "lrn-4", soundEffects = false)
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(original, out)
            val text = out.toByteArray().decodeToString()
            assertEquals(true, text.contains("\"sound_effects\":false"))
            assertEquals(original, read(text))
            val store = InMemorySoundSettingsStore()
            assertEquals(true, store.soundEffects.first())
            store.setSoundEffects(false)
            assertEquals(false, store.soundEffects.first())
        }

    @Test
    fun `a settings file from before follow-up 12 decodes with no module choices and no avatars`() =
        runTest {
            val s = read("""{"schema_version":1,"active_profile_id":"lrn-1","sound_effects":false}""")
            assertEquals(emptyMap(), s.moduleChoices)
            assertEquals(emptyMap(), s.avatars)
            assertEquals(false, s.soundEffects)
        }

    @Test
    fun `module choices and avatars round-trip with module codes and level codes`() =
        runTest {
            val original =
                AppSettings(
                    activeProfileId = "lrn-5",
                    moduleChoices = mapOf("lrn-5" to mapOf("BHS" to ModuleChoice("ko", "M"), "MAT" to ModuleChoice(level = "H"))),
                    avatars = mapOf("lrn-5" to "pic_rabbit"),
                )
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(original, out)
            val text = out.toByteArray().decodeToString()
            assertEquals(original, read(text))
            assertEquals(true, text.contains("\"module_choices\""))
            assertEquals(true, text.contains("\"BHS\":{\"language\":\"ko\",\"level\":\"M\"}"))
        }

    @Test
    fun `a choice without a language or a level decodes with nulls`() =
        runTest {
            val s = read("""{"module_choices":{"lrn-1":{"NIL":{}}}}""")
            assertEquals(ModuleChoice(), s.moduleChoices.getValue("lrn-1").getValue("NIL"))
        }

    @Test
    fun `the choice store keeps one choice per module per profile, forgets a profile and clears everything`() =
        runTest {
            val store = InMemoryProfileChoiceStore()
            store.choose("a", "BHS", ModuleChoice("en", "P"))
            store.choose("a", "BHS", ModuleChoice("ko", "M"))
            store.choose("a", "MAT", ModuleChoice(level = "H"))
            store.choose("b", "BHS", ModuleChoice("ja", "P"))
            store.setAvatar("a", "pic_cat")
            store.setAvatar("b", "pic_dog")
            assertEquals(mapOf("BHS" to ModuleChoice("ko", "M"), "MAT" to ModuleChoice(level = "H")), store.choices.first().getValue("a"))
            store.forget("a")
            assertEquals(setOf("b"), store.choices.first().keys)
            assertEquals(mapOf("b" to "pic_dog"), store.avatars.first())
            store.clear()
            assertEquals(emptyMap(), store.choices.first())
            assertEquals(emptyMap(), store.avatars.first())
        }

    @Test
    fun `an impossible reminder time is rejected`() {
        assertFailsWith<IllegalArgumentException> { ReminderSetting(hour = 24) }
    }
}
