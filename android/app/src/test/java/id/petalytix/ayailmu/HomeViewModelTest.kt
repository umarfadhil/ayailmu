package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.home.DevCheck
import id.petalytix.ayailmu.feature.home.HomeData
import id.petalytix.ayailmu.feature.home.HomeDataSource
import id.petalytix.ayailmu.feature.home.HomeEvent
import id.petalytix.ayailmu.feature.home.HomeViewModel
import id.petalytix.ayailmu.feature.home.TrackCard
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

        override fun home(): Flow<HomeData> =
            flow {
                homeLoads++
                emit(HomeData(adult, listOf(adult, kid), listOf(TrackCard("arab", "Bahasa Arab", 17, resumable = homeLoads > 1, unreviewed = true))))
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
            assertEquals("arab", vm.state.value.home?.tracks?.single()?.track)
            assertFalse(vm.state.value.home!!.tracks.single().resumable)
            vm.onEvent(HomeEvent.Refresh)
            assertEquals(2, data.homeLoads)
            assertEquals(true, vm.state.value.home!!.tracks.single().resumable)
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
