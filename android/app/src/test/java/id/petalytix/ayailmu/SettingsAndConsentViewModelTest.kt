package id.petalytix.ayailmu

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.consent.Consent
import id.petalytix.ayailmu.feature.consent.ConsentDataSource
import id.petalytix.ayailmu.feature.consent.ConsentEvent
import id.petalytix.ayailmu.feature.consent.ConsentViewModel
import id.petalytix.ayailmu.feature.settings.LastAdultException
import id.petalytix.ayailmu.feature.settings.SettingsData
import id.petalytix.ayailmu.feature.settings.SettingsDataSource
import id.petalytix.ayailmu.feature.settings.SettingsEvent
import id.petalytix.ayailmu.feature.settings.SettingsNotice
import id.petalytix.ayailmu.feature.settings.SettingsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsAndConsentViewModelTest {
    private class FakeSettings : SettingsDataSource {
        val data =
            MutableStateFlow<SettingsData?>(
                SettingsData(
                    profile = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT),
                    sessionOptions = listOf(10, 15, 20),
                    showArabicSize = true,
                    reminder = ReminderSetting(),
                    appVersion = "test",
                ),
            )
        val reminders = mutableListOf<ReminderSetting>()
        val calls = mutableListOf<String>()
        var failExport = false

        override fun observe(): Flow<SettingsData?> = data

        override suspend fun setLanguage(lang: Lang) {
            calls += "lang:${lang.tag}"
        }

        override suspend fun setSessionMinutes(minutes: Int?) {
            calls += "minutes:$minutes"
        }

        override suspend fun setArabicScale(scale: Float) {
            calls += "scale:$scale"
        }

        override suspend fun setReminder(value: ReminderSetting) {
            reminders += value
            data.value = data.value?.copy(reminder = value)
        }

        override suspend fun withdrawConsent() {
            calls += "withdraw"
        }

        override suspend fun export(): List<Uri> = if (failExport) error("disk full") else emptyList()

        override suspend fun deleteProfile() {
            calls += "deleteProfile"
        }

        override suspend fun deleteAll() {
            calls += "deleteAll"
        }
    }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `a refused notification permission leaves the reminder off and says why`() {
        val data = FakeSettings()
        val vm = SettingsViewModel(data)
        vm.onEvent(SettingsEvent.ReminderEnabled(enabled = true, permitted = false))
        assertTrue(data.reminders.isEmpty())
        assertEquals(SettingsNotice.NOTIFICATIONS_BLOCKED, vm.state.value.notice)
    }

    @Test
    fun `turning the reminder on and changing its time keeps the other field`() {
        val data = FakeSettings()
        val vm = SettingsViewModel(data)
        vm.onEvent(SettingsEvent.ReminderEnabled(enabled = true))
        vm.onEvent(SettingsEvent.ReminderTime(7, 15))
        assertEquals(ReminderSetting(enabled = true, hour = 7, minute = 15), data.reminders.last())
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun `profile settings, consent withdrawal and deletes reach the data layer`() {
        val data = FakeSettings()
        val vm = SettingsViewModel(data)
        vm.onEvent(SettingsEvent.Language(Lang.EN))
        vm.onEvent(SettingsEvent.SessionMinutes(null))
        vm.onEvent(SettingsEvent.ArabicScale(1.4f))
        vm.onEvent(SettingsEvent.WithdrawConsent)
        vm.onEvent(SettingsEvent.DeleteProfile)
        vm.onEvent(SettingsEvent.DeleteAll)
        assertEquals(listOf("lang:en", "minutes:null", "scale:1.4", "withdraw", "deleteProfile", "deleteAll"), data.calls)
    }

    @Test
    fun `a failed export shows a notice instead of crashing`() {
        val data = FakeSettings().apply { failExport = true }
        val vm = SettingsViewModel(data)
        vm.onEvent(SettingsEvent.Export)
        assertEquals(SettingsNotice.EXPORT_FAILED, vm.state.value.notice)
        vm.onEvent(SettingsEvent.NoticeShown)
        assertNull(vm.state.value.notice)
    }

    private class FakeConsent(
        private val eligible: Boolean = true,
        private val fail: Boolean = false,
    ) : ConsentDataSource {
        val accepted = mutableListOf<String>()

        override suspend fun eligible(): Boolean = eligible

        override suspend fun accept(version: String) {
            if (fail) error("disk full")
            accepted += version
        }
    }

    @Test
    fun `deleting the last adult while children exist is refused with an explanation`() {
        val data =
            object : SettingsDataSource by FakeSettings() {
                override suspend fun deleteProfile(): Unit = throw LastAdultException()
            }
        val vm = SettingsViewModel(data)
        vm.onEvent(SettingsEvent.DeleteProfile)
        assertEquals(SettingsNotice.LAST_ADULT, vm.state.value.notice)
    }

    @Test
    fun `consent needs both boxes and records the current text version`() {
        val fake = FakeConsent()
        val accepted = fake.accepted
        val vm = ConsentViewModel(SavedStateHandle(mapOf("track" to "arab")), fake)
        vm.onEvent(ConsentEvent.Accept)
        assertTrue(accepted.isEmpty())
        vm.onEvent(ConsentEvent.Adult(true))
        vm.onEvent(ConsentEvent.Accept)
        assertTrue(accepted.isEmpty()) // still needs "I agree"
        vm.onEvent(ConsentEvent.Agree(true))
        vm.onEvent(ConsentEvent.Accept)
        assertEquals(listOf(Consent.VERSION), accepted)
        assertTrue(vm.state.value.done)
        assertEquals("arab", vm.state.value.track)
    }

    @Test
    fun `a failed consent write is reported and nothing is marked done`() {
        val vm = ConsentViewModel(SavedStateHandle(mapOf("track" to "arab")), FakeConsent(fail = true))
        vm.onEvent(ConsentEvent.Adult(true))
        vm.onEvent(ConsentEvent.Agree(true))
        vm.onEvent(ConsentEvent.Accept)
        assertTrue(vm.state.value.error)
        assertFalse(vm.state.value.done)
    }

    @Test
    fun `a profile born less than 18 years ago cannot consent`() {
        val fake = FakeConsent(eligible = false)
        val vm = ConsentViewModel(SavedStateHandle(mapOf("track" to "arab")), fake)
        assertTrue(vm.state.value.tooYoung)
        vm.onEvent(ConsentEvent.Adult(true))
        vm.onEvent(ConsentEvent.Agree(true))
        vm.onEvent(ConsentEvent.Accept)
        assertTrue(fake.accepted.isEmpty())
    }
}
