package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.onboarding.OnboardingDataSource
import id.petalytix.ayailmu.feature.onboarding.OnboardingEvent
import id.petalytix.ayailmu.feature.onboarding.OnboardingRules
import id.petalytix.ayailmu.feature.onboarding.OnboardingStep
import id.petalytix.ayailmu.feature.onboarding.OnboardingViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

/** Neutral age screen and the child-profile rule (Play Families policy, CR-DAT-5). */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {
    private data class Created(
        val label: String,
        val kind: ProfileKind,
        val lang: Lang,
        val birthYear: Int,
        val createdBy: String?,
    )

    private class FakeData(
        private val active: Profile?,
    ) : OnboardingDataSource {
        val created = mutableListOf<Created>()

        override suspend fun creator(): Profile? = active

        override suspend fun create(
            label: String,
            kind: ProfileKind,
            lang: Lang,
            birthYear: Int,
            createdBy: String?,
        ) {
            created += Created(label, kind, lang, birthYear, createdBy)
        }

        override fun currentYear(): Int = 2026
    }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `the age rule takes the younger possible age`() {
        assertEquals(ProfileKind.ADULT, OnboardingRules.kindFor(2012, 2026)) // 13 or 14
        assertEquals(ProfileKind.ANAK, OnboardingRules.kindFor(2013, 2026)) // could still be 12
        assertEquals(ProfileKind.ANAK, OnboardingRules.kindFor(2019, 2026))
    }

    @Test
    fun `first run - nothing preselected on the age screen, and an adult profile is created`() {
        val data = FakeData(active = null)
        val vm = OnboardingViewModel(data)
        assertTrue(vm.state.value.firstRun)
        vm.onEvent(OnboardingEvent.PickLang(Lang.EN))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(OnboardingStep.AGE, vm.state.value.step)
        assertNull(vm.state.value.birthYear)
        assertFalse(vm.state.value.canContinue)
        assertEquals(2026, vm.state.value.years.first())
        assertEquals(1926, vm.state.value.years.last())

        vm.onEvent(OnboardingEvent.PickYear(1990))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(OnboardingStep.NAME, vm.state.value.step)
        vm.onEvent(OnboardingEvent.NameChanged("  Umar  "))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(listOf(Created("Umar", ProfileKind.ADULT, Lang.EN, 1990, null)), data.created)
        assertTrue(vm.state.value.done)
    }

    @Test
    fun `first run - a child is sent to a parent instead of getting a profile`() {
        val data = FakeData(active = null)
        val vm = OnboardingViewModel(data)
        vm.onEvent(OnboardingEvent.Next)
        vm.onEvent(OnboardingEvent.PickYear(2017))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(OnboardingStep.GUARDIAN, vm.state.value.step)
        assertFalse(vm.state.value.canContinue)
        vm.onEvent(OnboardingEvent.Back)
        assertEquals(OnboardingStep.AGE, vm.state.value.step)
        assertTrue(data.created.isEmpty())
    }

    @Test
    fun `an adult adds a child profile that records who created it`() {
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        val data = FakeData(active = adult)
        val vm = OnboardingViewModel(data)
        assertFalse(vm.state.value.firstRun)
        vm.onEvent(OnboardingEvent.Next)
        vm.onEvent(OnboardingEvent.PickYear(2017))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(OnboardingStep.NAME, vm.state.value.step)
        assertTrue(vm.state.value.willBeChild)
        vm.onEvent(OnboardingEvent.NameChanged("Sari"))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(Created("Sari", ProfileKind.ANAK, Lang.ID, 2017, "lrn-adult"), data.created.single())
    }

    @Test
    fun `a child profile cannot add another child`() {
        val child = TestPacks.profile(id = "lrn-kid", kind = ProfileKind.ANAK)
        val vm = OnboardingViewModel(FakeData(active = child))
        vm.onEvent(OnboardingEvent.Next)
        vm.onEvent(OnboardingEvent.PickYear(2018))
        vm.onEvent(OnboardingEvent.Next)
        assertEquals(OnboardingStep.GUARDIAN, vm.state.value.step)
    }

    @Test
    fun `nicknames are capped`() {
        val vm = OnboardingViewModel(FakeData(active = null))
        vm.onEvent(OnboardingEvent.NameChanged("x".repeat(60)))
        assertEquals(24, vm.state.value.name.length)
    }
}
