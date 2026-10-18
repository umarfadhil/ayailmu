package id.petalytix.ayailmu.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Home state. One StateFlow in, events out (CR-ARC-2). Navigation (start a track, progress, settings, add a
 * profile) stays in the route; export and delete moved to Settings in P3b (CR-DAT-4).
 */
data class HomeUiState(
    val developerDemo: Boolean = BuildConfig.DEVELOPER_DEMO,
    val home: HomeData? = null,
    val devCheck: DevCheck? = null,
    val busy: Boolean = false,
    val actionFailed: Boolean = false,
)

sealed interface HomeEvent {
    /** Recompute the shelf (e.g. when returning from a session, so "Resume" is current). */
    data object Refresh : HomeEvent

    data class SwitchProfile(
        val id: String,
    ) : HomeEvent

    data class CreateTestProfile(
        val label: String,
        val lang: Lang,
    ) : HomeEvent

    data object NoticeShown : HomeEvent

    /** Developer demo only: show the free tier (locks, store) as prod would. */
    data class SetFreeTier(
        val on: Boolean,
    ) : HomeEvent

    /** "Nanti saja" on the trial survey card. */
    data object SnoozeSurvey : HomeEvent
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        private val data: HomeDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow(HomeUiState())
        val state: StateFlow<HomeUiState> = _state.asStateFlow()

        private val refresh = MutableStateFlow(0)

        init {
            viewModelScope.launch {
                refresh
                    .flatMapLatest {
                        // catch inside, so one failed load does not end the stream and a later Refresh still works.
                        data.home().catch { emit(HomeData(null, emptyList(), emptyList(), loadError = true)) }
                    }.collect { home -> _state.update { it.copy(home = home) } }
            }
            if (_state.value.developerDemo) {
                viewModelScope.launch { data.devCheck().collect { dc -> _state.update { it.copy(devCheck = dc) } } }
            }
        }

        fun onEvent(event: HomeEvent) {
            when (event) {
                HomeEvent.Refresh -> refresh.update { it + 1 }
                is HomeEvent.SwitchProfile -> launchAction { data.switchProfile(event.id) }
                is HomeEvent.CreateTestProfile -> launchAction { data.createTestProfile(event.label, event.lang) }
                HomeEvent.NoticeShown -> _state.update { it.copy(actionFailed = false) }
                is HomeEvent.SetFreeTier -> if (_state.value.developerDemo) launchAction { data.setFreeTier(event.on) }
                HomeEvent.SnoozeSurvey -> launchAction { data.snoozeSurvey() }
            }
        }

        private fun launchAction(block: suspend () -> Unit) {
            if (_state.value.busy) return
            _state.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    block()
                } catch (e: Exception) {
                    _state.update { it.copy(actionFailed = true) }
                } finally {
                    _state.update { it.copy(busy = false) }
                }
            }
        }
    }
