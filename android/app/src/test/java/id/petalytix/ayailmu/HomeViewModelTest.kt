package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.home.DevCheck
import id.petalytix.ayailmu.feature.home.HomeData
import id.petalytix.ayailmu.feature.home.HomeDataSource
import id.petalytix.ayailmu.feature.home.HomeEvent
import id.petalytix.ayailmu.feature.home.HomeViewModel
import id.petalytix.ayailmu.feature.modules.ModuleCard
import id.petalytix.ayailmu.feature.modules.ModuleLanguage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    private class FakeData : HomeDataSource {
        val check = MutableStateFlow(DevCheck(tracks = 2, items = 29))
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        val kid = TestPacks.profile(id = "lrn-kid", kind = ProfileKind.ANAK)
        val created = mutableListOf<Pair<String, Lang>>()
        val switched = mutableListOf<String>()
        var homeLoads = 0
        var failSwitch = false
        var snoozes = 0

        override fun home(): Flow<HomeData> =
            flow {
                homeLoads++
                emit(
                    HomeData(
                        profile = adult,
                        profiles = listOf(adult, kid),
                        modules =
                            listOf(
                                ModuleCard(
                                    subject = Subject.BAHASA,
                                    language = ModuleLanguage.KOREA,
                                    level = Level.MENENGAH,
                                    track = "kor-a-m",
                                    trackTitle = "Bahasa Korea",
                                    resumable = homeLoads > 1,
                                    unreviewed = true,
                                    lockedBy = Product.PACK_BAHASA,
                                ),
                                ModuleCard(Subject.NILAI, null, Level.PEMULA, "nil-a", "Nilai", free = true),
                            ),
                        avatars = mapOf(adult.id to "pic_cat", kid.id to "pic_duck"),
                    ),
                )
            }

        override fun devCheck(): Flow<DevCheck> = check

        override suspend fun switchProfile(id: String) {
            if (failSwitch) error("db closed")
            switched += id
        }

        override suspend fun createTestProfile(
            label: String,
            lang: Lang,
        ) {
            created += label to lang
        }

        override suspend fun snoozeSurvey() {
            snoozes++
        }
    }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `the shelf comes from the data source and refresh reloads it`() =
        runTest {
            val data = FakeData()
            val vm = HomeViewModel(data)
            assertEquals("kor-a-m", vm.state.value.home?.modules?.first()?.track)
            assertFalse(vm.state.value.home!!.modules.first().resumable)
            vm.onEvent(HomeEvent.Refresh)
            assertEquals(2, data.homeLoads)
            assertEquals(true, vm.state.value.home!!.modules.first().resumable)
        }

    @Test
    fun `one card per module with its language, level, pictures and free flag`() =
        runTest {
            val home = HomeViewModel(FakeData()).state.value.home!!
            assertEquals(listOf(Subject.BAHASA, Subject.NILAI), home.modules.map { it.subject })
            val bahasa = home.modules.first()
            assertEquals(ModuleLanguage.KOREA to Level.MENENGAH, bahasa.language to bahasa.level)
            assertEquals(Product.PACK_BAHASA, bahasa.lockedBy)
            val nilai = home.modules.last()
            assertEquals(true, nilai.free)
            assertEquals(null, nilai.lockedBy)
            assertEquals("pic_duck", home.avatars["lrn-kid"])
        }

    @Test
    fun `a failed load keeps Home alive with an empty shelf and the error flag`() =
        runTest {
            val data =
                object : HomeDataSource by FakeData() {
                    override fun home(): Flow<HomeData> = flow { error("db closed") }
                }
            val vm = HomeViewModel(data)
            assertEquals(true, vm.state.value.home?.loadError)
            assertEquals(emptyList<ModuleCard>(), vm.state.value.home?.modules)
        }

    @Test
    fun `switching profile reaches the data layer`() =
        runTest {
            val data = FakeData()
            val vm = HomeViewModel(data)
            vm.onEvent(HomeEvent.SwitchProfile("lrn-kid"))
            assertEquals(listOf("lrn-kid"), data.switched)
            assertFalse(vm.state.value.busy)
        }

    @Test
    fun `developer check and test profile creation reach the data layer`() =
        runTest {
            val data = FakeData()
            val vm = HomeViewModel(data)
            if (BuildConfig.DEVELOPER_DEMO) assertEquals(29, vm.state.value.devCheck?.items)
            vm.onEvent(HomeEvent.CreateTestProfile("Profil uji", Lang.ID))
            assertEquals(listOf("Profil uji" to Lang.ID), data.created)
            assertFalse(vm.state.value.busy)
        }

    @Test
    fun `not now on the survey card reaches the data layer`() =
        runTest {
            val data = FakeData()
            val vm = HomeViewModel(data)
            vm.onEvent(HomeEvent.SnoozeSurvey)
            assertEquals(1, data.snoozes)
            assertFalse(vm.state.value.busy)
        }

    @Test
    fun `a failed profile switch shows a notice instead of crashing`() =
        runTest {
            val data = FakeData().apply { failSwitch = true }
            val vm = HomeViewModel(data)
            vm.onEvent(HomeEvent.SwitchProfile("lrn-kid"))
            assertEquals(true, vm.state.value.actionFailed)
            vm.onEvent(HomeEvent.NoticeShown)
            assertEquals(false, vm.state.value.actionFailed)
        }
}
