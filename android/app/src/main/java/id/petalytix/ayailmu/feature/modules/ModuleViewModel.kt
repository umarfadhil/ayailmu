package id.petalytix.ayailmu.feature.modules

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.data.settings.ProfileChoiceStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.feature.store.AccessSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The module screen's content for the active profile ([audience] picks the level descriptions). */
data class ModuleScreenData(
    val detail: ModuleDetail,
    val audience: Audience,
)

/** What the module screen needs from the data layer; an interface so the ViewModel is tested with a fake. */
interface ModuleDataSource {
    /** Null when there is no active profile, the code is unknown or the profile has no track in that module. */
    fun observe(code: String): Flow<ModuleScreenData?>

    suspend fun choose(
        code: String,
        choice: ModuleChoice,
    )
}

class DefaultModuleDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val answers: AnswerRepository,
        private val access: AccessSource,
        private val choices: ProfileChoiceStore,
        private val assembler: ModuleAssembler,
        private val clock: Clock,
    ) : ModuleDataSource {
        override fun observe(code: String): Flow<ModuleScreenData?> {
            val subject = moduleOf(code) ?: return flowOf(null)
            return combine(profiles.observeActive(), access.observe(), choices.choices, answers.observeCount()) { profile, ctx, chosen, _ ->
                if (profile == null) return@combine null
                val today = Dates.localDate(clock.now().toEpochMilli(), clock.zone)
                assembler
                    .modules(profile, ctx, chosen[profile.id].orEmpty(), today, only = subject)
                    .firstOrNull()
                    ?.let { ModuleScreenData(it, profile.audience) }
            }
        }

        override suspend fun choose(
            code: String,
            choice: ModuleChoice,
        ) {
            val profile = profiles.activeProfile() ?: return
            choices.choose(profile.id, code, choice)
        }
    }

sealed interface ModuleUiState {
    data object Loading : ModuleUiState

    data object Failed : ModuleUiState

    data class Ready(
        val data: ModuleScreenData,
        /** The last choice could not be saved; the screen still shows the stored one. */
        val saveFailed: Boolean = false,
    ) : ModuleUiState
}

sealed interface ModuleEvent {
    /** A language card (Bahasa); the level stays when the new language has it. */
    data class PickLanguage(
        val language: ModuleLanguage,
    ) : ModuleEvent

    /** A level rung; a «Segera» rung does nothing. */
    data class PickLevel(
        val level: Level,
    ) : ModuleEvent

    /** Back from a session, Units or Progress: recompute (answers, a finished challenge, a purchase). */
    data object Refresh : ModuleEvent
}

/** One module (route argument `code`, e.g. "BHS"): language picker, level ladder and the chosen track's way in. */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ModuleViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: ModuleDataSource,
    ) : ViewModel() {
        private val code = savedStateHandle.get<String>("code").orEmpty()
        private val _state = MutableStateFlow<ModuleUiState>(ModuleUiState.Loading)
        val state: StateFlow<ModuleUiState> = _state.asStateFlow()
        private val refresh = MutableStateFlow(0)

        init {
            viewModelScope.launch {
                refresh
                    .flatMapLatest { data.observe(code).catch { emit(null) } }
                    .collect { d -> _state.value = if (d == null) ModuleUiState.Failed else ModuleUiState.Ready(d) }
            }
        }

        fun onEvent(event: ModuleEvent) {
            if (event == ModuleEvent.Refresh) {
                refresh.update { it + 1 }
                return
            }
            val view = (_state.value as? ModuleUiState.Ready)?.data?.detail?.view ?: return
            val choice =
                when (event) {
                    is ModuleEvent.PickLanguage ->
                        if (event.language == view.language) null else ModuleModel.chooseLanguage(view, event.language)
                    is ModuleEvent.PickLevel -> if (event.level == view.level) null else ModuleModel.chooseLevel(view, event.level)
                    ModuleEvent.Refresh -> null
                } ?: return
            viewModelScope.launch {
                try {
                    data.choose(code, choice)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.update { s -> if (s is ModuleUiState.Ready) s.copy(saveFailed = true) else s }
                }
            }
        }
    }
